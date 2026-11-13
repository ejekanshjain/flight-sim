import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  type DirectionalLight,
  type HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Vector3
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { game, useGame } from '../game/game'
import { CELL, GRID, groundColor, HEIGHTS, WORLD_SIZE } from '../world/island'
import { seededRandom } from '../world/noise'
import { TREES } from '../world/scenery'
import {
  clearSkyUniform,
  fogUniform,
  HAZE_GLSL,
  horizon,
  lightLevel,
  nightUniform,
  SKY_GLSL,
  SUN_DIRECTION,
  sunColor,
  sunGlow,
  zenith
} from './atmosphere'
import { billboardMaterial, makeBillboards } from './billboards'
import { environment } from './environment'
import {
  LOG_DEPTH_FRAGMENT,
  LOG_DEPTH_FRAGMENT_PARS,
  LOG_DEPTH_VERTEX,
  LOG_DEPTH_VERTEX_PARS
} from './logDepth'
import { depthTexture, detailTexture, MAX_DEPTH } from './textures'

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  ${LOG_DEPTH_VERTEX_PARS}
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    ${LOG_DEPTH_VERTEX}
  }
`
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform vec3 sunGlow;
  uniform float night;
  // 1 under a clear sky, 0 in fog, where the sun, moon, and stars cannot be seen
  uniform float clearSky;
  varying vec3 vDirection;
  ${SKY_GLSL}
  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }
  ${LOG_DEPTH_FRAGMENT_PARS}
  void main() {
    ${LOG_DEPTH_FRAGMENT}
    vec3 direction = normalize(vDirection);
    vec3 color = skyColor(direction);
    float sun = max(dot(direction, sunDirection), 0.0);
    float up = max(direction.y, 0.0);
    // Sun disc, a tight glare around it, and a wide glow. At night the disc is the moon.
    float glare = 1.0 - night * 0.9;
    color += clearSky * sunColor * (smoothstep(0.99955, 0.9998, sun) * mix(8.0, 1.6, night) + pow(sun, 260.0) * 0.9 * glare + pow(sun, 9.0) * 0.16 * glare);
    // Sunrise and sunset colour the horizon on the sun's side of the sky
    color += sunGlow * pow(sun, 3.0) * exp(-up * 5.0) * 2.0;
    // Stars: a few sky cells hold a point of light, fainter toward the hazy horizon
    vec3 cell = floor(direction * 260.0);
    float star = step(0.9965, hash(cell));
    float spot = 1.0 - smoothstep(0.08, 0.3, length(fract(direction * 260.0) - 0.5));
    color += clearSky * vec3(0.9, 0.93, 1.0) * star * spot * night * smoothstep(0.02, 0.25, up) * (0.4 + hash(cell + 7.0));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Sky dome with haze at the horizon and a sun, kept centred on the camera. */
export function Sky() {
  const mesh = useRef<Mesh>(null)
  const uniforms = useMemo(
    () => ({
      zenithColor: { value: zenith },
      horizonColor: { value: horizon },
      sunColor: { value: sunColor },
      sunDirection: { value: SUN_DIRECTION },
      sunGlow: { value: sunGlow },
      night: nightUniform,
      clearSky: clearSkyUniform
    }),
    []
  )
  useFrame(({ camera }) => mesh.current?.position.copy(camera.position))
  return (
    <mesh ref={mesh} scale={40_000} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 24]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SKY_VERTEX}
        fragmentShader={SKY_FRAGMENT}
        side={BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

/**
 * Sunlight (or moonlight) and sky light, set by the time of day and the weather.
 * The shadow follows the aircraft so it stays sharp.
 */
export function Lights() {
  const detailed = useGame(state => state.quality === 'high')
  const sun = useRef<DirectionalLight>(null)
  const sky = useRef<HemisphereLight>(null)
  useFrame(() => {
    const light = sun.current
    if (!light) return
    light.position.copy(game.focus).addScaledVector(SUN_DIRECTION, 300)
    light.target.position.copy(game.focus)
    light.target.updateMatrixWorld()
    light.color.copy(sunColor)
    light.intensity = environment.sunIntensity
    if (!sky.current) return
    sky.current.color.copy(environment.sky)
    sky.current.groundColor.copy(environment.ground)
    sky.current.intensity = environment.ambient
  })
  return (
    <>
      <hemisphereLight ref={sky} args={['#c3d8f2', '#6a6450', 1.05]} />
      <directionalLight
        ref={sun}
        // Turning the shadow off on the light makes materials drop their shadow lookups
        castShadow={detailed}
        intensity={3}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
      >
        <orthographicCamera attach="shadow-camera" args={[-22, 22, 22, -22, 1, 900]} />
      </directionalLight>
    </>
  )
}

// The terrain and the forests are each split into this many regions per side
const TERRAIN_REGIONS = 8
const FOREST_REGIONS = 12
// Forests farther than this from the camera are lost in the haze, so they are not drawn
const FOREST_RANGE = 22_000

function buildTerrain() {
  const side = GRID + 1
  const positions = new Float32Array(side * side * 3)
  const colors = new Float32Array(side * side * 3)
  const color = new Color()
  const rgb: [number, number, number] = [0, 0, 0]
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const vertex = j * side + i
      const x = i * CELL - WORLD_SIZE / 2
      const z = j * CELL - WORLD_SIZE / 2
      positions[vertex * 3] = x
      positions[vertex * 3 + 1] = HEIGHTS[vertex]
      positions[vertex * 3 + 2] = z
      groundColor(x, z, rgb)
      color.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace)
      colors[vertex * 3] = color.r
      colors[vertex * 3 + 1] = color.g
      colors[vertex * 3 + 2] = color.b
    }
  }
  // Two triangles per cell, split along the same diagonal that heightAt uses
  const indices = new Uint32Array(GRID * GRID * 6)
  let n = 0
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * side + i
      const b = a + 1
      const c = a + side
      indices[n++] = a
      indices[n++] = c
      indices[n++] = b
      indices[n++] = b
      indices[n++] = c
      indices[n++] = c + 1
    }
  }
  const whole = new BufferGeometry()
  whole.setAttribute('position', new BufferAttribute(positions, 3))
  whole.setAttribute('color', new BufferAttribute(colors, 3))
  whole.setIndex(new BufferAttribute(indices, 1))
  whole.computeVertexNormals()

  // Cut the terrain into square regions that share one set of vertices.
  // The renderer then skips every region that is out of view.
  const cells = GRID / TERRAIN_REGIONS
  const regions: BufferGeometry[] = []
  for (let regionJ = 0; regionJ < TERRAIN_REGIONS; regionJ++) {
    for (let regionI = 0; regionI < TERRAIN_REGIONS; regionI++) {
      const region = new BufferGeometry()
      for (const name of ['position', 'color', 'normal']) {
        region.setAttribute(name, whole.getAttribute(name))
      }
      const picked = new Uint32Array(cells * cells * 6)
      let low = Number.POSITIVE_INFINITY
      let high = Number.NEGATIVE_INFINITY
      let at = 0
      for (let j = regionJ * cells; j < (regionJ + 1) * cells; j++) {
        const first = (j * GRID + regionI * cells) * 6
        picked.set(indices.subarray(first, first + cells * 6), at)
        at += cells * 6
        for (let i = regionI * cells; i <= (regionI + 1) * cells; i++) {
          const height = HEIGHTS[j * side + i]
          low = Math.min(low, height)
          high = Math.max(high, height)
        }
      }
      region.setIndex(new BufferAttribute(picked, 1))
      const width = cells * CELL
      region.boundingSphere = new Sphere(
        new Vector3(
          (regionI + 0.5) * width - WORLD_SIZE / 2,
          (low + high) / 2,
          (regionJ + 0.5) * width - WORLD_SIZE / 2
        ),
        Math.hypot(width * 0.75, (high - low) / 2 + 60)
      )
      regions.push(region)
    }
  }
  return regions
}

const TERRAIN_COLOR = /* glsl */ `
  #include <color_fragment>
  {
    vec2 ground = vGround.xz;
    float fine = texture2D(detailMap, ground * 0.031).b;
    float medium = texture2D(detailMap, ground * 0.0043).a;
    float broad = texture2D(detailMap, ground * 0.00071).b;
    // Mottle the ground at three scales so it never reads as flat paint
    diffuseColor.rgb *= 0.6 + 0.36 * fine + 0.34 * medium + 0.2 * broad;
    // Bare rock shows wherever the slope is too steep to hold soil
    float steep = 1.0 - normalize(vGroundNormal).y;
    float rock = smoothstep(0.09, 0.22, steep + (medium - 0.5) * 0.1) * smoothstep(1.0, 4.0, vGround.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.18, 0.155) * (0.55 + 0.9 * fine), rock * 0.92);
  }
`
const TERRAIN_BUMPS = /* glsl */ `
  #include <normal_fragment_maps>
  {
    vec2 bump = texture2D(detailMap, vGround.xz * 0.011).rg * 2.0 - 1.0;
    bump += (texture2D(detailMap, vGround.xz * 0.083).rg * 2.0 - 1.0) * 0.6;
    normal = normalize(normal + mat3(viewMatrix) * vec3(bump.x, 0.0, bump.y) * 0.3);
  }
`

/** Standard lit material with per-pixel ground detail, rock on steep slopes, and bumps. */
function terrainMaterial() {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })
  material.onBeforeCompile = shader => {
    shader.uniforms.detailMap = { value: detailTexture }
    const varyings = 'varying vec3 vGround;\nvarying vec3 vGroundNormal;'
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${varyings}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = position;\nvGroundNormal = normal;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D detailMap;\n${varyings}`)
      .replace('#include <color_fragment>', TERRAIN_COLOR)
      .replace('#include <normal_fragment_maps>', TERRAIN_BUMPS)
  }
  return material
}

export function Terrain() {
  const material = useMemo(terrainMaterial, [])
  const regions = useMemo(
    () =>
      buildTerrain().map(region => {
        const mesh = new Mesh(region, material)
        mesh.receiveShadow = true
        return mesh
      }),
    [material]
  )
  // Rain soaks the ground: darker, with a little sheen
  const wet = useGame(state => state.weather === 'rain')
  useEffect(() => {
    material.color.setScalar(wet ? 0.72 : 1)
    material.roughness = wet ? 0.7 : 0.96
  }, [material, wet])
  return regions.map(region => <primitive key={region.uuid} object={region} />)
}

const SEA_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  ${LOG_DEPTH_VERTEX_PARS}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    ${LOG_DEPTH_VERTEX}
  }
`
const SEA_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform sampler2D detailMap;
  uniform sampler2D depthMap;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 horizonColor;
  uniform vec3 zenithColor;
  uniform float fogDensity;
  uniform float lightLevel;
  uniform float worldSize;
  uniform float grid;
  uniform float maxDepth;
  varying vec3 vWorld;
  ${SKY_GLSL}
  ${HAZE_GLSL}
  ${LOG_DEPTH_FRAGMENT_PARS}
  void main() {
    ${LOG_DEPTH_FRAGMENT}
    vec3 toCamera = cameraPosition - vWorld;
    float distance = length(toCamera);
    vec3 view = toCamera / distance;
    vec2 p = vWorld.xz;

    // Three layers of ripples drifting in different directions
    vec2 ripple = (texture2D(detailMap, p * 0.0021 + time * vec2(0.004, 0.0025)).rg * 2.0 - 1.0) * 0.55;
    ripple += (texture2D(detailMap, p * 0.011 - time * vec2(0.012, 0.007)).rg * 2.0 - 1.0) * 0.45;
    ripple += (texture2D(detailMap, p * 0.06 + time * vec2(-0.03, 0.045)).rg * 2.0 - 1.0) * 0.3;
    vec3 normal = normalize(vec3(ripple.x * 0.2, 1.0, ripple.y * 0.2));

    // One depth texel per terrain grid corner
    vec2 depthUv = (p / worldSize + 0.5) * (grid / (grid + 1.0)) + 0.5 / (grid + 1.0);
    float stored = texture2D(depthMap, clamp(depthUv, 0.0, 1.0)).r;
    float depth = stored * stored * maxDepth;

    vec3 body = mix(vec3(0.06, 0.3, 0.3), vec3(0.01, 0.065, 0.14), 1.0 - exp(-depth / 6.0)) * lightLevel;
    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
    vec3 reflected = reflect(-view, normal);
    reflected.y = abs(reflected.y);
    vec3 color = mix(body, skyColor(reflected), fresnel);
    color += sunColor * pow(max(dot(reflected, sunDirection), 0.0), 420.0) * 2.2;

    // Surf: a band of foam that surges in and out along the shore
    float surge = sin(time * 0.9 + depth * 2.5 + ripple.x * 3.0) * 0.5 + 0.5;
    float lace = texture2D(detailMap, p * 0.045 + time * 0.01).a;
    float shore = 1.0 - smoothstep(0.0, 2.2, depth);
    float foam = smoothstep(0.55, 0.9, shore * (0.6 + 0.4 * surge) + lace * 0.45 - 0.2);
    color = mix(color, vec3(0.9, 0.93, 0.94) * lightLevel, foam * 0.9);

    // Shallow water is clear enough to show the sand below
    float alpha = max(max(mix(0.25, 1.0, smoothstep(0.0, 5.0, depth)), foam), fresnel);
    gl_FragColor = vec4(applyHaze(color, distance), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Sea with moving ripples, sky reflection, sun glitter, clear shallows, and surf. */
export function Sea() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          detailMap: { value: detailTexture },
          depthMap: { value: depthTexture },
          sunDirection: { value: SUN_DIRECTION },
          sunColor: { value: sunColor },
          horizonColor: { value: horizon },
          zenithColor: { value: zenith },
          fogDensity: fogUniform,
          lightLevel,
          worldSize: { value: WORLD_SIZE },
          grid: { value: GRID },
          maxDepth: { value: MAX_DEPTH }
        },
        vertexShader: SEA_VERTEX,
        fragmentShader: SEA_FRAGMENT,
        transparent: true
      }),
    []
  )
  useFrame(({ clock }) => {
    material.uniforms.time.value = clock.elapsedTime
  })
  return (
    <mesh rotation-x={-Math.PI / 2} material={material} renderOrder={1}>
      <planeGeometry args={[400_000, 400_000]} />
    </mesh>
  )
}

/** Paints every vertex of a geometry one colour, darkening it toward the bottom. */
function tinted(geometry: BufferGeometry, color: Color, shadeFrom = 1) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  const position = flat.getAttribute('position')
  flat.computeBoundingBox()
  const low = flat.boundingBox?.min.y ?? 0
  const high = flat.boundingBox?.max.y ?? 1
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const shade = shadeFrom + (1 - shadeFrom) * ((position.getY(i) - low) / (high - low))
    colors[i * 3] = color.r * shade
    colors[i * 3 + 1] = color.g * shade
    colors[i * 3 + 2] = color.b * shade
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3))
  return flat
}

const BARK = new Color('#4a3a2a')
const LEAF = new Color('#ffffff')

/** Conifer one unit tall: a trunk and two tiers of branches. */
function pineGeometry() {
  return mergeGeometries([
    tinted(new CylinderGeometry(0.035, 0.05, 0.3, 4, 1, true).translate(0, 0.15, 0), BARK),
    tinted(new ConeGeometry(0.24, 0.5, 6, 1, true).translate(0, 0.42, 0), LEAF, 0.55),
    tinted(new ConeGeometry(0.17, 0.48, 6, 1, true).translate(0, 0.76, 0), LEAF, 0.7)
  ])
}

/** Broadleaf tree one unit tall: a trunk and a lumpy round crown. */
function broadleafGeometry() {
  // The plainest round shape: with outward normals it still shades as one smooth crown
  const crown = new IcosahedronGeometry(0.36, 0)
  const position = crown.getAttribute('position')
  const random = seededRandom(5)
  // Icosahedron faces do not share vertices, so jitter by position to keep the surface closed
  const jitter = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`
    let scale = jitter.get(key)
    if (scale === undefined) {
      scale = 0.8 + random() * 0.4
      jitter.set(key, scale)
    }
    position.setXYZ(i, position.getX(i) * scale, position.getY(i) * scale, position.getZ(i) * scale)
  }
  // Normals that point straight out from the centre shade the crown as one rounded mass
  const normal = crown.getAttribute('normal')
  const outward = new Vector3()
  for (let i = 0; i < position.count; i++) {
    outward.fromBufferAttribute(position, i).normalize()
    normal.setXYZ(i, outward.x, outward.y, outward.z)
  }
  return mergeGeometries([
    tinted(new CylinderGeometry(0.04, 0.06, 0.4, 4, 1, true).translate(0, 0.2, 0), BARK),
    tinted(crown.translate(0, 0.64, 0), LEAF, 0.5)
  ])
}

/** Builds the forests as one group of trees per region and kind, so distant regions can be skipped. */
function buildTrees() {
  const random = seededRandom(8)
  const material = new MeshLambertMaterial({ vertexColors: true })
  const shapes = { pine: pineGeometry(), broadleaf: broadleafGeometry() }
  const groups = new Map<string, typeof TREES>()
  for (const tree of TREES) {
    const regionX = Math.floor(((tree.x + WORLD_SIZE / 2) / WORLD_SIZE) * FOREST_REGIONS)
    const regionZ = Math.floor(((tree.z + WORLD_SIZE / 2) / WORLD_SIZE) * FOREST_REGIONS)
    const key = `${tree.broadleaf ? 'broadleaf' : 'pine'} ${regionX} ${regionZ}`
    const group = groups.get(key)
    if (group) group.push(tree)
    else groups.set(key, [tree])
  }
  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const color = new Color()
  return [...groups.values()].map(trees => {
    const broadleaf = trees[0].broadleaf
    const mesh = new InstancedMesh(
      broadleaf ? shapes.broadleaf : shapes.pine,
      material,
      trees.length
    )
    trees.forEach((tree, i) => {
      turn.setFromAxisAngle(up, random() * Math.PI * 2)
      position.set(tree.x, tree.y, tree.z)
      mesh.setMatrixAt(
        i,
        matrix.compose(position, turn, scale.set(tree.wide, tree.tall, tree.wide))
      )
      if (broadleaf)
        color.setHSL(0.24 + random() * 0.07, 0.38 + random() * 0.12, 0.2 + random() * 0.08)
      else color.setHSL(0.3 + random() * 0.06, 0.34 + random() * 0.1, 0.13 + random() * 0.07)
      mesh.setColorAt(i, color)
    })
    mesh.computeBoundingSphere()
    return mesh
  })
}

export function Trees() {
  const forests = useMemo(buildTrees, [])
  const detailed = useGame(state => state.quality === 'high')
  // The faster setting draws every third tree
  useEffect(() => {
    for (const trees of forests) {
      trees.userData.total ??= trees.count
      trees.count = detailed ? trees.userData.total : Math.ceil(trees.userData.total / 3)
    }
  }, [forests, detailed])
  useFrame(({ camera }) => {
    for (const trees of forests) {
      const region = trees.boundingSphere
      if (!region) continue
      trees.visible = region.center.distanceTo(camera.position) < region.radius + FOREST_RANGE
    }
  })
  return forests.map(trees => <primitive key={trees.uuid} object={trees} />)
}

function buildClouds() {
  const random = seededRandom(21)
  const puffs: { x: number; y: number; z: number; size: number; shade: number }[] = []
  for (let cloud = 0; cloud < 340; cloud++) {
    const centerX = (random() - 0.5) * WORLD_SIZE
    const centerZ = (random() - 0.5) * WORLD_SIZE
    const base = 1650 + random() * 800
    const width = 500 + random() * 1000
    const tall = width * (0.28 + random() * 0.2)
    const count = Math.round(14 + width / 55)
    const cloudPuffs = []
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2
      const reach = Math.sqrt(random())
      // Cumulus shape: a flat base with a dome on top
      const dome = 1 - reach * reach
      const lift = random() ** 1.4 * dome
      cloudPuffs.push({
        x: centerX + Math.cos(angle) * reach * width * 0.5,
        y: base + lift * tall,
        z: centerZ + Math.sin(angle) * reach * width * 0.32,
        size: (230 + random() * 260) * (0.6 + 0.4 * dome),
        shade: 0.25 + 0.75 * lift
      })
    }
    // Lower, darker puffs draw first so the bright tops sit on them
    puffs.push(...cloudPuffs.sort((a, b) => a.y - b.y))
  }
  const sprites = makeBillboards(puffs.length, false)
  puffs.forEach((puff, i) => {
    const brightness = 0.52 + 0.6 * puff.shade + random() * 0.06
    sprites.center.setXYZ(i, puff.x, puff.y, puff.z)
    sprites.info.setXYZW(i, puff.size, random() * Math.PI * 2, 0.85, 0)
    sprites.tint.setXYZ(i, brightness * 0.95, brightness * 0.98, brightness * 1.03)
  })
  const mesh = new Mesh(sprites.geometry, billboardMaterial(30, 260))
  mesh.frustumCulled = false
  mesh.renderOrder = 2
  return mesh
}

export function Clouds() {
  const clouds = useMemo(buildClouds, [])
  return <primitive object={clouds} />
}
