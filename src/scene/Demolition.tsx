import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  type Group,
  InstancedMesh,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3
} from 'three'
import { game, useGame } from '../game/game'
import { GRAVITY } from '../sim/aircraft'
import { CHARGE_MARKS, SITE_CRANE, SUPPLY_TRUCK, TOWER_FOOT, TOWER_TOP } from '../world/demolition'
import { CONDEMNED_BLOCKS, DEMOLITION_GROUNDS, fromStrip, heightAt } from '../world/island'
import { seededRandom } from '../world/noise'
import { useDisposal } from './dispose'

// One facade tile is 4 bays of 4 m across and 4 storeys of 3 m up
const TILE_WIDTH = 16
const TILE_HEIGHT = 12
// Seconds from the charges going off to the tower starting to fall, the seconds it takes to
// sink into its own dust, and how far it leans as it goes, in radians
const COLLAPSE_DELAY = 0.6
const COLLAPSE_SECONDS = 7
const LEAN = 0.14
// Seconds between bursts of dust around the foot while it falls
const DUST_GAP = 0.15
// Cargo hook under the belly in body axes, and the sling's length in metres
const HOOK = new Vector3(0, -1.2, 0)
const SLING = 4.5
// Each frame keeps this share of the hanging charge's swing
const SWING_DAMPING = 0.985
// Fence panels are this long, and leave one gap on the north side for the gate
const PANEL = 20
// Where the charges stand on the truck's bed, in its own axes, with the front toward -Z
const CRATES = [-1.2, 0.2, 1.6, 3].map(z => new Vector3(0, 1.95, z))

const UP = new Vector3(0, 1, 0)
const site = DEMOLITION_GROUNDS
const turn = -(site.heading * Math.PI) / 180
const hook = new Vector3()
const shown = new Vector3()
const offset = new Vector3()
const step = new Vector3()
const dust = new Vector3()
const lean = new Quaternion()

/**
 * Bare concrete frame, never finished: floor slabs and columns around empty openings, some
 * boarded up with plywood and a few bricked in.
 */
function facadeTexture() {
  const bay = 32
  const storey = 24
  const canvas = document.createElement('canvas')
  canvas.width = bay * 4
  canvas.height = storey * 4
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The condemned tower needs a 2D canvas, which this browser refused')
  ctx.fillStyle = '#8f8b84'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const random = seededRandom(4242)
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 4; column++) {
      const roll = random()
      ctx.fillStyle = roll < 0.78 ? '#191a1c' : roll < 0.9 ? '#5e4d38' : '#7a746b'
      // A column on the left of each bay and a slab along the bottom of each storey
      ctx.fillRect(column * bay + 4, row * storey, bay - 4, storey - 6)
    }
  }
  // Rust streaks run down from the slabs
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = 'rgba(110, 70, 40, 0.25)'
    ctx.fillRect(random() * canvas.width, random() * canvas.height, 1.5, 10 + random() * 30)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 8
  return texture
}

/** Yellow lattice for the crane's mast: see-through between its struts. */
function latticeTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The site crane needs a 2D canvas, which this browser refused')
  ctx.strokeStyle = '#e8b520'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 0, size - 6, size)
  ctx.beginPath()
  ctx.moveTo(3, 0)
  ctx.lineTo(size - 3, size)
  ctx.stroke()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  return texture
}

/** The tower's three blocks, each with its facade tiled to whole storeys and bays. */
function towerBlocks(facade: CanvasTexture, roof: MeshStandardMaterial) {
  return CONDEMNED_BLOCKS.map(([half, base, top]) => {
    const map = facade.clone()
    map.repeat.set((half * 2) / TILE_WIDTH, (top - base) / TILE_HEIGHT)
    const wall = new MeshStandardMaterial({ map, roughness: 0.95 })
    return {
      geometry: new BoxGeometry(half * 2, top - base, half * 2),
      // Box faces run +X, -X, +Y, -Y, +Z, -Z
      materials: [wall, wall, roof, roof, wall, wall],
      y: (base + top) / 2
    }
  })
}

/** Panels of hoarding around the site, each on the ground beneath its middle. */
function fence(material: MeshStandardMaterial) {
  const half = site.length / 2
  const count = Math.round(site.length / PANEL)
  const spots: { x: number; z: number; turn: number }[] = []
  for (let i = 0; i < count; i++) {
    const middle = -half + (i + 0.5) * PANEL
    // The gate faces north, where the truck came in
    if (i !== Math.floor(count / 2)) spots.push({ ...fromStrip(site, half, middle), turn })
    spots.push({ ...fromStrip(site, -half, middle), turn })
    spots.push({ ...fromStrip(site, middle, half), turn: turn + Math.PI / 2 })
    spots.push({ ...fromStrip(site, middle, -half), turn: turn + Math.PI / 2 })
  }
  const mesh = new InstancedMesh(new BoxGeometry(PANEL, 2.4, 0.2), material, spots.length)
  const place = new Object3D()
  spots.forEach((spot, i) => {
    place.position.set(spot.x, heightAt(spot.x, spot.z) + 1, spot.z)
    place.rotation.set(0, spot.turn, 0)
    place.updateMatrix()
    mesh.setMatrixAt(i, place.matrix)
  })
  mesh.castShadow = true
  return mesh
}

/** Puts a cable between two points: a unit cylinder, stretched and turned to fit. */
function stretch(cable: Mesh, from: Vector3, to: Vector3) {
  offset.subVectors(from, to)
  const length = offset.length()
  cable.position.copy(to).addScaledVector(offset, 0.5)
  cable.quaternion.setFromUnitVectors(UP, offset.normalize())
  cable.scale.set(1, length, 1)
}

/**
 * The demolition site past the north end of Port Azure: the condemned tower, the crane
 * beside it, the hoarding around the lot, and the supply truck with its charges. On the
 * demolition mission it also shows the marks, the charges set on them, the one hanging from
 * the helicopter, and the tower coming down.
 */
export function DemolitionSite() {
  const job = useGame(state => state.mission?.demolition ?? false)
  const paint = useMemo(() => {
    const roof = new MeshStandardMaterial({ color: '#77736c', roughness: 1 })
    const facade = facadeTexture()
    const lattice = latticeTexture()
    lattice.repeat.set(1, (SITE_CRANE.jib - SITE_CRANE.base) / 2.2)
    const yellow = new MeshStandardMaterial({ color: '#e8b520', roughness: 0.6 })
    const hoarding = new MeshStandardMaterial({ color: '#4f6f8c', roughness: 0.8 })
    return {
      roof,
      facade,
      blocks: towerBlocks(facade, roof),
      mast: new MeshStandardMaterial({ map: lattice, alphaTest: 0.5, side: DoubleSide }),
      yellow,
      hoarding,
      fence: fence(hoarding),
      steel: new MeshStandardMaterial({ color: '#3a3d42', roughness: 0.5, metalness: 0.6 }),
      cab: new MeshStandardMaterial({ color: '#d0d4d6', roughness: 0.6 }),
      truck: new MeshStandardMaterial({ color: '#2d6a4f', roughness: 0.6 }),
      charge: new MeshStandardMaterial({ color: '#c8401c', roughness: 0.6 }),
      blink: new MeshBasicMaterial({ color: '#ff2a1a' }),
      mark: new MeshBasicMaterial({
        color: '#3dff7a',
        transparent: true,
        depthWrite: false,
        side: DoubleSide
      }),
      rubble: new MeshStandardMaterial({ color: '#7c776f', roughness: 1, flatShading: true })
    }
  }, [])
  useDisposal(paint)
  const truck = SUPPLY_TRUCK
  const truckGround = heightAt(truck.x, truck.z)
  const crane = SITE_CRANE
  const jib = crane.jib - crane.base

  const tower = useRef<Group>(null)
  const rubble = useRef<Mesh>(null)
  const crates = useRef<(Mesh | null)[]>([])
  const marks = useRef<(Mesh | null)[]>([])
  const charges = useRef<(Group | null)[]>([])
  const lights = useRef<(Mesh | null)[]>([])
  const cable = useRef<Mesh>(null)
  const load = useRef<Mesh>(null)
  // The hanging charge's swing, and the scenery clock when the tower blew
  const swing = useRef({ ready: false, at: new Vector3(), last: new Vector3() })
  const collapse = useRef({ job: null as unknown, blewAt: -1, dust: 0 })

  useFrame((_, delta) => {
    const { sim, missions, effects } = game
    const current = missions.demolition
    const dt = Math.min(delta, 0.05)
    const fall = collapse.current
    if (fall.job !== current) Object.assign(fall, { job: current, blewAt: -1, dust: 0 })
    if (current?.blown && fall.blewAt < 0) fall.blewAt = game.sceneryTime
    // The game's clock, so the fall keeps pace with the replay however slow the frames
    const since = fall.blewAt < 0 ? 0 : game.sceneryTime - fall.blewAt
    const planted = current?.planted ?? 0
    const carrying = current?.carrying ?? false
    // Charges still on the truck: all of them away from the mission
    const left = current ? CHARGE_MARKS.length - planted - (carrying ? 1 : 0) : CRATES.length
    crates.current.forEach((crate, i) => {
      if (crate) crate.visible = i < left
    })
    const pulse = 0.55 + 0.35 * Math.sin(game.sceneryTime * 5)
    marks.current.forEach((mark, i) => {
      if (mark) mark.visible = current !== null && !current.blown && i === planted
    })
    paint.mark.opacity = pulse
    charges.current.forEach((charge, i) => {
      if (charge) charge.visible = current !== null && !current.blown && i < planted
    })
    const blinking = game.sceneryTime % 1 < 0.5
    for (const light of lights.current) if (light) light.visible = blinking

    // The tower sinks into its dust, leaning as it goes, and leaves a mound of rubble
    const t = Math.min(1, Math.max(0, (since - COLLAPSE_DELAY) / COLLAPSE_SECONDS))
    if (tower.current) {
      tower.current.position.y = TOWER_FOOT - t * t * (TOWER_TOP - TOWER_FOOT + 4)
      tower.current.quaternion
        .setFromAxisAngle(UP, turn)
        .multiply(lean.setFromAxisAngle(offset.set(1, 0, 0.4).normalize(), LEAN * t))
      tower.current.visible = t < 1
    }
    if (rubble.current) {
      rubble.current.visible = t > 0
      rubble.current.scale.set(1, Math.max(0.05, t), 1)
    }
    if (t > 0 && t < 1) {
      fall.dust -= dt
      while (fall.dust <= 0) {
        fall.dust += DUST_GAP
        const [[foot]] = CONDEMNED_BLOCKS
        const along = (Math.random() * 2 - 1) * foot
        const across = (Math.random() < 0.5 ? -1 : 1) * foot
        const swap = Math.random() < 0.5
        const spot = fromStrip(site, swap ? across : along, swap ? along : across)
        effects.collapse(dust.set(spot.x, TOWER_FOOT, spot.z))
      }
    }

    // The sling: a charge swinging under the helicopter, or the cable down to the truck
    const ride = swing.current
    const hanging = current !== null && carrying && !current.blown && !sim.crash
    const hooking = current !== null && !carrying && current.progress > 0 && left > 0
    if (cable.current) cable.current.visible = hanging || hooking
    if (load.current) load.current.visible = hanging
    if (!hanging) ride.ready = false
    if (!(hanging || hooking) || !cable.current || !load.current || !current) return
    hook.copy(HOOK).applyQuaternion(sim.orientation).add(sim.position)
    if (hooking) {
      shown.copy(CRATES[left - 1]).applyAxisAngle(UP, -truck.heading)
      shown.x += truck.x
      shown.y += truckGround + 0.5
      shown.z += truck.z
      stretch(cable.current, hook, shown)
      return
    }
    if (!ride.ready) {
      ride.at.copy(hook).setY(hook.y - SLING)
      ride.last.copy(ride.at)
      ride.ready = true
    }
    // Verlet: carry on with last frame's motion, fall, and stay within the sling's reach
    step.subVectors(ride.at, ride.last).multiplyScalar(SWING_DAMPING)
    ride.last.copy(ride.at)
    ride.at.add(step)
    ride.at.y -= GRAVITY * dt * dt
    offset.subVectors(ride.at, hook)
    if (offset.length() > SLING) ride.at.copy(hook).addScaledVector(offset.normalize(), SLING)
    // Lowering carries the charge down onto its mark
    const mark = CHARGE_MARKS[planted]
    shown.copy(ride.at).lerp(offset.set(mark.x, mark.y + 0.45, mark.z), current.progress)
    load.current.position.copy(shown)
    stretch(cable.current, hook, shown.setY(shown.y + 0.45))
  })

  return (
    <group>
      <group ref={tower} position={[site.x, TOWER_FOOT, site.z]} rotation={[0, turn, 0]}>
        {paint.blocks.map(block => (
          <mesh
            key={block.y}
            geometry={block.geometry}
            material={block.materials}
            position={[0, block.y, 0]}
            castShadow
            receiveShadow
          />
        ))}
        {/* Columns left standing on the roof, never built on */}
        {[-1, 0, 1].flatMap(i =>
          [-1, 1].map(j => (
            <mesh
              key={`${i} ${j}`}
              material={paint.roof}
              position={[i * 9.5, TOWER_TOP - TOWER_FOOT + 1.5, j * 9.5]}
            >
              <boxGeometry args={[0.6, 3, 0.6]} />
            </mesh>
          ))
        )}
      </group>
      <mesh
        ref={rubble}
        material={paint.rubble}
        position={[site.x, TOWER_FOOT, site.z]}
        visible={false}
      >
        <coneGeometry args={[50, 16, 9, 2]} />
      </mesh>

      <group position={[crane.x, crane.base, crane.z]} rotation={[0, -crane.heading, 0]}>
        <mesh material={paint.mast} position={[0, jib / 2, 0]}>
          <boxGeometry args={[2.2, jib, 2.2]} />
        </mesh>
        <mesh material={paint.cab} position={[1.6, jib - 2.5, -1]}>
          <boxGeometry args={[1.8, 2.2, 2.2]} />
        </mesh>
        <mesh material={paint.yellow} position={[0, (jib + crane.top - crane.base) / 2, 0]}>
          <boxGeometry args={[1, crane.top - crane.jib, 1]} />
        </mesh>
        <mesh material={paint.yellow} position={[0, jib, -crane.ahead / 2]} castShadow>
          <boxGeometry args={[1.4, 1.6, crane.ahead]} />
        </mesh>
        <mesh material={paint.yellow} position={[0, jib, crane.behind / 2]}>
          <boxGeometry args={[1.4, 1.2, crane.behind]} />
        </mesh>
        <mesh material={paint.roof} position={[0, jib - 1.8, crane.behind - 2.5]} castShadow>
          <boxGeometry args={[3, 2.6, 4]} />
        </mesh>
        <mesh material={paint.steel} position={[0, jib - 15, -crane.ahead * 0.6]}>
          <cylinderGeometry args={[0.05, 0.05, 30, 4]} />
        </mesh>
        <mesh material={paint.steel} position={[0, jib - 30.5, -crane.ahead * 0.6]}>
          <boxGeometry args={[0.8, 1, 0.8]} />
        </mesh>
      </group>

      <primitive object={paint.fence} />
      {[-60, -75].map(across => {
        const spot = fromStrip(site, 100, across)
        return (
          <mesh
            key={across}
            material={paint.cab}
            position={[spot.x, heightAt(spot.x, spot.z) + 1.4, spot.z]}
            rotation={[0, turn, 0]}
            castShadow
          >
            <boxGeometry args={[3, 2.8, 9]} />
          </mesh>
        )
      })}

      <group position={[truck.x, truckGround, truck.z]} rotation={[0, -truck.heading, 0]}>
        <mesh material={paint.steel} position={[0, 0.7, 0]} castShadow>
          <boxGeometry args={[2.4, 0.5, 10]} />
        </mesh>
        <mesh material={paint.truck} position={[0, 2, -4]} castShadow>
          <boxGeometry args={[2.5, 2.4, 2.2]} />
        </mesh>
        <mesh material={paint.steel} position={[0, 1.3, 1]}>
          <boxGeometry args={[2.5, 0.3, 7.6]} />
        </mesh>
        {CRATES.map((crate, i) => (
          <mesh
            key={crate.z}
            ref={mesh => {
              crates.current[i] = mesh
            }}
            material={paint.charge}
            position={crate}
            castShadow
          >
            <boxGeometry args={[1.4, 1, 1]} />
          </mesh>
        ))}
      </group>

      {job &&
        CHARGE_MARKS.map((mark, i) => (
          <group key={mark.name}>
            <mesh
              ref={mesh => {
                marks.current[i] = mesh
              }}
              material={paint.mark}
              position={[mark.x, mark.y + 0.15, mark.z]}
              rotation={[-Math.PI / 2, 0, 0]}
              visible={false}
            >
              <ringGeometry args={[2.4, 3.4, 32]} />
            </mesh>
            <group
              ref={group => {
                charges.current[i] = group
              }}
              position={[mark.x, mark.y, mark.z]}
              rotation={[0, turn, 0]}
              visible={false}
            >
              <mesh material={paint.charge} position={[0, 0.45, 0]} castShadow>
                <boxGeometry args={[1.4, 0.9, 0.9]} />
              </mesh>
              <mesh
                ref={mesh => {
                  lights.current[i] = mesh
                }}
                material={paint.blink}
                position={[0, 1, 0]}
              >
                <sphereGeometry args={[0.15, 8, 6]} />
              </mesh>
            </group>
          </group>
        ))}
      {job && (
        <>
          <mesh ref={cable} material={paint.steel} visible={false}>
            <cylinderGeometry args={[0.04, 0.04, 1, 5]} />
          </mesh>
          <mesh ref={load} material={paint.charge} visible={false} castShadow>
            <boxGeometry args={[1.4, 0.9, 0.9]} />
          </mesh>
        </>
      )}
    </group>
  )
}
