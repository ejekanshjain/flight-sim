import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import {
  BoxGeometry,
  type BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from 'three'
import { game } from '../game/game'
import { type City, fromStrip } from '../world/island'
import { seededRandom } from '../world/noise'
import { CITY_PLANS, SPIRES, TOWERS } from '../world/scenery'
import { nightUniform } from './atmosphere'
import { type Light, lightMaterial, pointsGeometry } from './lightPoints'

// Metres between cars in a lane, and their speed range in m/s
const CAR_SPACING = 150
const CAR_SPEED: [number, number] = [8, 15]
const CAR_SIZE = new Vector3(1.8, 1.5, 4.4)
// Cars stop moving beyond this distance from the camera, where they are too small to see
const CAR_RANGE = 7000
const CAR_COLORS = ['#c9cdd2', '#2b2f36', '#a61e22', '#f2f2ee', '#2d4f8a', '#7c8189', '#d9b23a']
// Towers this tall or taller carry a red beacon, which flashes on for ON_SECONDS every PERIOD
const BEACON_HEIGHT = 90
const BEACON_PERIOD = 1.5
const BEACON_ON = 0.4

/** One lane of a street, in a city's own axes: a line along or across it, and its direction. */
type Lane = { city: City; across: boolean; at: number; from: number; to: number; way: number }

/** Every street between a city's blocks, as a lane each way. */
function lanes(): Lane[] {
  const all: Lane[] = []
  for (const { city, blocks } of CITY_PLANS) {
    const spans = (key: 'along' | 'across', size: 'length' | 'width') =>
      [...new Map(blocks.map(block => [block[key], block[size]])).entries()]
        .map(([middle, extent]) => [middle - extent / 2, middle + extent / 2])
        .sort((a, b) => a[0] - b[0])
    const streets = (edges: number[][]) =>
      edges
        .slice(1)
        .map((span, i) => ({ middle: (span[0] + edges[i][1]) / 2, gap: span[0] - edges[i][1] }))
    // Streets that run the length of the city lie between the columns of blocks, and the
    // other way between the rows
    for (const [across, edges, extent] of [
      [false, spans('across', 'width'), city.length],
      [true, spans('along', 'length'), city.width]
    ] as const) {
      for (const { middle, gap } of streets(edges)) {
        if (gap < 10) continue
        for (const way of [-1, 1]) {
          all.push({
            city,
            across,
            at: middle + (way * gap) / 4,
            from: -extent / 2,
            to: extent / 2,
            way
          })
        }
      }
    }
  }
  return all
}

type Car = { lane: Lane; start: number; speed: number }

function cars(all: Lane[]) {
  const random = seededRandom(1212)
  const list: Car[] = []
  for (const lane of all) {
    const length = lane.to - lane.from
    for (let at = random() * CAR_SPACING; at < length; at += CAR_SPACING * (0.6 + random() * 0.8)) {
      list.push({ lane, start: at, speed: CAR_SPEED[0] + random() * (CAR_SPEED[1] - CAR_SPEED[0]) })
    }
  }
  return list
}

const spot = new Vector3()
const turn = new Quaternion()
const matrix = new Matrix4()
const UP = new Vector3(0, 1, 0)

/** Where a car is at `time` seconds: its position, heading in its city, and lane. */
function carAt(car: Car, time: number, out: Vector3) {
  const { lane } = car
  const length = lane.to - lane.from
  // Each car loops along its lane, coming back in at the far end
  const travelled = (car.start + car.speed * time) % length
  const position = lane.way > 0 ? lane.from + travelled : lane.to - travelled
  const point = lane.across
    ? fromStrip(lane.city, lane.at, position)
    : fromStrip(lane.city, position, lane.at)
  out.set(point.x, lane.city.elevation + 0.3, point.z)
  return out
}

/** Heading of a car, as a turn around the vertical in the renderer's sense. */
function carTurn(car: Car) {
  const { lane } = car
  const heading = (lane.city.heading * Math.PI) / 180 + (lane.across ? Math.PI / 2 : 0)
  // The box's front is its -Z face, which a turn of -heading points along the heading
  return -heading + (lane.way > 0 ? 0 : Math.PI)
}

/** The highest point of every tower at least BEACON_HEIGHT tall, for its red beacon. */
function beacons(): Light[] {
  const tops = new Map<string, { x: number; z: number; base: number; top: number }>()
  const key = (x: number, z: number) => `${Math.round(x)} ${Math.round(z)}`
  for (const tower of TOWERS) {
    const id = key(tower.x, tower.z)
    const known = tops.get(id)
    const top = tower.y + tower.height
    if (!known) tops.set(id, { x: tower.x, z: tower.z, base: tower.y, top })
    else {
      known.base = Math.min(known.base, tower.y)
      known.top = Math.max(known.top, top)
    }
  }
  for (const spire of SPIRES) {
    const known = tops.get(key(spire.x, spire.z))
    if (known) known.top = Math.max(known.top, spire.y + spire.height)
  }
  return [...tops.values()]
    .filter(tower => tower.top - tower.base >= BEACON_HEIGHT)
    .map((tower): Light => ({ x: tower.x, y: tower.top + 1, z: tower.z, color: [1, 0.08, 0.05] }))
}

/**
 * City street life: cars driving both ways along every street, with headlights and red tail
 * lights after dark, and the red beacons that flash on top of tall towers at night.
 */
export function CityStreets() {
  const scene = useMemo(() => {
    const list = cars(lanes())
    const mesh = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }),
      list.length
    )
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled = false
    const random = seededRandom(1313)
    const color = new Color()
    list.forEach((_, i) => {
      mesh.setColorAt(i, color.set(CAR_COLORS[Math.floor(random() * CAR_COLORS.length)]))
    })
    // A headlight and a tail light per car, moved with it
    const lights = pointsGeometry(
      list.flatMap((): Light[] => [
        { x: 0, y: 0, z: 0, color: [1, 0.95, 0.8] },
        { x: 0, y: 0, z: 0, color: [1, 0.1, 0.06] }
      ])
    )
    ;(lights.getAttribute('position') as BufferAttribute).setUsage(DynamicDrawUsage)
    const beaconGeometry = pointsGeometry(beacons())
    return {
      list,
      mesh,
      lights,
      lightMaterial: lightMaterial(0.45, true),
      beaconGeometry,
      beaconMaterial: lightMaterial(2.2, true)
    }
  }, [])

  useFrame(({ camera }) => {
    const { list, mesh, lights, lightMaterial: lamps, beaconMaterial } = scene
    const time = game.sceneryTime
    const night = nightUniform.value > 0.01
    lamps.visible = night
    beaconMaterial.visible = night && time % BEACON_PERIOD < BEACON_ON
    const positions = lights.getAttribute('position') as BufferAttribute
    const near = CAR_RANGE * CAR_RANGE
    for (let i = 0; i < list.length; i++) {
      const car = list[i]
      carAt(car, time, spot)
      if (spot.distanceToSquared(camera.position) > near) continue
      const angle = carTurn(car)
      turn.setFromAxisAngle(UP, angle)
      mesh.setMatrixAt(i, matrix.compose(spot, turn, CAR_SIZE))
      if (!night) continue
      // Forward is -Z in the car's own axes
      const forwardX = -Math.sin(angle)
      const forwardZ = -Math.cos(angle)
      const half = CAR_SIZE.z / 2
      positions.setXYZ(i * 2, spot.x + forwardX * half, spot.y + 0.7, spot.z + forwardZ * half)
      positions.setXYZ(i * 2 + 1, spot.x - forwardX * half, spot.y + 0.8, spot.z - forwardZ * half)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (night) positions.needsUpdate = true
  })

  return (
    <>
      <primitive object={scene.mesh} />
      <points geometry={scene.lights} material={scene.lightMaterial} frustumCulled={false} />
      <points
        geometry={scene.beaconGeometry}
        material={scene.beaconMaterial}
        frustumCulled={false}
      />
    </>
  )
}
