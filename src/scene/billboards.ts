import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector2
} from 'three'
import { cloudLight, fogUniform, HAZE_GLSL, horizon } from './atmosphere'
import { puffTexture } from './textures'

const VERTEX = /* glsl */ `
  attribute vec3 center;
  // size in metres, rotation in radians, opacity, 1 for glowing sprites
  attribute vec4 info;
  attribute vec3 tint;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vGlow;
  varying float vDistance;
  void main() {
    vec4 eye = viewMatrix * vec4(center, 1.0);
    float c = cos(info.y);
    float s = sin(info.y);
    eye.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * info.x;
    vUv = position.xy + 0.5;
    vTint = tint;
    vAlpha = info.z;
    vGlow = info.w;
    vDistance = -eye.z;
    gl_Position = projectionMatrix * eye;
  }
`

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 horizonColor;
  uniform float fogDensity;
  uniform vec3 daylight;
  uniform vec2 nearFade;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vAlpha;
  varying float vGlow;
  varying float vDistance;
  ${HAZE_GLSL}
  void main() {
    float alpha = texture2D(map, vUv).a * vAlpha * smoothstep(nearFade.x, nearFade.y, vDistance);
    if (alpha < 0.004) discard;
    // Clouds and smoke take the colour of the daylight; fire and flashes make their own
    vec3 lit = vTint * daylight;
    gl_FragColor = vec4(mix(applyHaze(lit, vDistance), vTint, vGlow), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Premultiplied output: glowing sprites add light and only half hide what is behind them
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha * (1.0 - 0.3 * vGlow));
  }
`

/** Per-sprite data for a set of camera-facing sprites. Fill the arrays, then flag them. */
export type Billboards = {
  geometry: InstancedBufferGeometry
  /** x, y, z per sprite. */
  center: InstancedBufferAttribute
  /** size, rotation, opacity, glow per sprite. */
  info: InstancedBufferAttribute
  /** Linear r, g, b per sprite. */
  tint: InstancedBufferAttribute
}

/** Creates buffers for up to `capacity` soft sprites that always face the camera. */
export function makeBillboards(capacity: number, dynamic: boolean): Billboards {
  const geometry = new InstancedBufferGeometry()
  const corners = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0])
  geometry.setAttribute('position', new BufferAttribute(corners, 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  const center = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  const info = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const tint = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
  if (dynamic) for (const attribute of [center, info, tint]) attribute.setUsage(DynamicDrawUsage)
  geometry.setAttribute('center', center)
  geometry.setAttribute('info', info)
  geometry.setAttribute('tint', tint)
  geometry.instanceCount = dynamic ? 0 : capacity
  return { geometry, center, info, tint }
}

/** Material for billboards. Sprites fade out between `fadeFrom` and `fadeTo` metres from the camera. */
export function billboardMaterial(fadeFrom: number, fadeTo: number) {
  return new ShaderMaterial({
    uniforms: {
      map: { value: puffTexture() },
      horizonColor: { value: horizon },
      fogDensity: fogUniform,
      daylight: cloudLight,
      nearFade: { value: new Vector2(fadeFrom, fadeTo) }
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false
  })
}
