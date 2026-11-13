import { Vector3 } from 'three'
import { GRAVITY, SEA_LEVEL_DENSITY } from '../sim/aircraft'
import { airDensity, type FlightSim, type Ground } from '../sim/flight-sim'

/** A target on the bombing range. A bomb landing within `radius` metres destroys it. */
export type Target = { x: number; z: number; radius: number; label: string }

/** Where a bomb landed, and how far it fell from the nearest target still standing. */
export type Impact = { at: Vector3; water: boolean; hit: number | null; miss: number }

// A 500 lb bomb: drag per metre of flight at sea level, so it falls at up to 500 m/s
const DRAG = 4e-5
// Released from the bomb bay, this far below the aircraft's centre in body axes
const BAY = new Vector3(0, -1.4, 0.5)
// Seconds per step of a falling bomb, and of the aiming prediction
const STEP = 1 / 60
const PREDICT_STEP = 0.1
const PREDICT_LIMIT = 200
// A guided bomb released with the aiming cross this close to a target steers onto it, with
// up to this much sideways acceleration in m/s²
export const GUIDED_REACH = 900
const GUIDED_ACCELERATION = 25
// Release armed with the cross lined up and up to this far short of a target waits for it
const ARM_REACH = 3000

/** Where the aiming cross lies from a target: `long` ahead along the track, `side` to the right. */
type Offset = { long: number; side: number }

const air = new Vector3()

/** Moves a bomb one step: gravity, and drag that grows with speed and thicker air. */
function fall(position: Vector3, velocity: Vector3, dt: number) {
  const speed = velocity.length()
  const drag = DRAG * (airDensity(position.y) / SEA_LEVEL_DENSITY) * speed
  velocity.addScaledVector(air.copy(velocity), -drag * dt)
  velocity.y -= GRAVITY * dt
  position.addScaledVector(velocity, dt)
}

const groundUnder = (ground: Ground, position: Vector3) =>
  Math.max(ground.heightAt(position.x, position.z), 0)

/**
 * The bomb bay: bombs loaded for a mission, the ones falling, the targets they are for, and
 * where a bomb released now would land. Call `update` every frame.
 */
export class Bombs {
  /** Bombs left in the bay. */
  loaded = 0
  /** Bombs on their way down: `target` is what a guided bomb steers for, `aimedAt` what the
   * cross lay on at release. Each is a target index, or -1. */
  readonly falling: { position: Vector3; velocity: Vector3; target: number; aimedAt: number }[] = []
  targets: Target[] = []
  /** GPS-guided bombs steer themselves onto a target from the launch zone around it. */
  guided = false
  destroyed: boolean[] = []
  /** Where a bomb released now would land, while bombs are loaded and the aircraft flies. */
  readonly aim = new Vector3()
  aiming = false
  /** The target a release is armed for: the bomb drops as the cross reaches it. */
  armed = -1

  /** Fills the bay and sets up the targets for a mission. */
  load(count: number, targets: Target[], guided = false) {
    this.loaded = count
    this.guided = guided
    this.falling.length = 0
    this.targets = targets
    this.destroyed = targets.map(() => false)
    this.aiming = false
    this.armed = -1
  }

  clear() {
    this.load(0, [])
  }

  get hits() {
    return this.destroyed.filter(Boolean).length
  }

  /**
   * Index of the nearest target to a point that still stands with no bomb on its way to it,
   * or -1 when there is none.
   */
  nearestStanding(x: number, z: number) {
    let best = -1
    let distance = Number.POSITIVE_INFINITY
    this.targets.forEach((target, i) => {
      if (this.destroyed[i] || this.falling.some(bomb => bomb.aimedAt === i)) return
      const away = Math.hypot(target.x - x, target.z - z)
      if (away < distance) {
        distance = away
        best = i
      }
    })
    return best
  }

  /** How far the aiming cross lies short of a target, and how far to its side. */
  offset(sim: FlightSim, index: number): Offset {
    const target = this.targets[index]
    // Ground track, and the target relative to the aiming cross along it
    const track = Math.atan2(sim.velocity.x, -sim.velocity.z)
    const x = target.x - this.aim.x
    const z = target.z - this.aim.z
    return {
      long: x * Math.sin(track) - z * Math.cos(track),
      side: x * Math.cos(track) + z * Math.sin(track)
    }
  }

  /** Whether the cross will pass over a target if the course holds, and is close enough to wait for it. */
  linedUp(sim: FlightSim, index: number) {
    const { long, side } = this.offset(sim, index)
    return long > 0 && long < ARM_REACH && Math.abs(side) <= this.targets[index].radius * 0.8
  }

  /**
   * The bomb release key. With the cross lined up short of a target, it arms the release and
   * the bomb drops as the cross reaches the target. Otherwise, or pressed again, it drops now.
   */
  release(sim: FlightSim) {
    if (this.loaded <= 0 || sim.onGround || !this.aiming) return
    const index = this.nearestStanding(this.aim.x, this.aim.z)
    if (this.armed < 0 && !this.guided && index >= 0 && this.linedUp(sim, index)) {
      this.armed = index
      return
    }
    this.drop(sim)
  }

  /** Releases a bomb from the bay. Returns false with none left, or on the ground. */
  drop(sim: FlightSim) {
    this.armed = -1
    if (this.loaded <= 0 || sim.onGround) return false
    this.loaded--
    const position = BAY.clone().applyQuaternion(sim.orientation).add(sim.position)
    // A guided bomb locks onto the target nearest the aiming cross, if it is in reach
    const nearest = this.aiming ? this.nearestStanding(this.aim.x, this.aim.z) : -1
    const spot = this.targets[nearest]
    const away = spot
      ? Math.hypot(spot.x - this.aim.x, spot.z - this.aim.z)
      : Number.POSITIVE_INFINITY
    const target = this.guided && away <= GUIDED_REACH ? nearest : -1
    const aimedAt = away <= (this.guided ? GUIDED_REACH : (spot?.radius ?? 0)) ? nearest : -1
    this.falling.push({ position, velocity: sim.velocity.clone(), target, aimedAt })
    return true
  }

  /**
   * Moves the falling bombs and updates the aiming point. Returns each bomb that landed this
   * frame, after marking the targets it destroyed.
   */
  update(dt: number, sim: FlightSim, ground: Ground): Impact[] {
    const impacts: Impact[] = []
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const bomb = this.falling[i]
      for (let t = 0; t < dt; t += STEP) {
        const step = Math.min(STEP, dt - t)
        if (bomb.target >= 0) this.steer(bomb, ground, step)
        fall(bomb.position, bomb.velocity, step)
        if (bomb.position.y <= groundUnder(ground, bomb.position)) break
      }
      const floor = groundUnder(ground, bomb.position)
      if (bomb.position.y > floor) continue
      bomb.position.y = floor
      impacts.push(this.land(bomb.position, ground.heightAt(bomb.position.x, bomb.position.z) < 0))
      this.falling.splice(i, 1)
    }
    this.predict(sim, ground)
    // An armed release drops once the cross reaches the target, and gives up if the course
    // carries the cross well wide of it
    if (this.armed >= 0) {
      const { long, side } = this.offset(sim, this.armed)
      if (!this.aiming || Math.abs(side) > this.targets[this.armed].radius * 3) this.armed = -1
      else if (long <= 0) this.drop(sim)
    }
    return impacts
  }

  /**
   * Guidance: turns the bomb's sideways motion toward what reaches its target by the time it
   * lands, within the fins' limit.
   */
  private steer(bomb: Bombs['falling'][number], ground: Ground, dt: number) {
    const target = this.targets[bomb.target]
    const { position, velocity } = bomb
    const drop = position.y - groundUnder(ground, position)
    const seconds = Math.max(0.5, drop / Math.max(1, -velocity.y))
    const wantX = (target.x - position.x) / seconds
    const wantZ = (target.z - position.z) / seconds
    const change = Math.hypot(wantX - velocity.x, wantZ - velocity.z)
    const limit = GUIDED_ACCELERATION * dt
    const share = change > limit ? limit / change : 1
    velocity.x += (wantX - velocity.x) * share
    velocity.z += (wantZ - velocity.z) * share
  }

  /** Marks the targets a bomb landing here destroys. */
  private land(at: Vector3, water: boolean): Impact {
    let hit: number | null = null
    this.targets.forEach((target, i) => {
      if (this.destroyed[i]) return
      if (Math.hypot(target.x - at.x, target.z - at.z) <= target.radius) {
        this.destroyed[i] = true
        hit ??= i
      }
    })
    const nearest = this.targets.reduce(
      (best, target) => Math.min(best, Math.hypot(target.x - at.x, target.z - at.z)),
      Number.POSITIVE_INFINITY
    )
    return { at: at.clone(), water, hit, miss: nearest }
  }

  /** Follows a bomb released now down to the ground, for the aiming cross. */
  private predict(sim: FlightSim, ground: Ground) {
    this.aiming = this.loaded > 0 && !sim.onGround
    if (!this.aiming) return
    const position = this.aim.copy(BAY).applyQuaternion(sim.orientation).add(sim.position)
    const velocity = air.copy(sim.velocity)
    const step = new Vector3()
    for (let t = 0; t < PREDICT_LIMIT; t += PREDICT_STEP) {
      // A copy of the velocity, as `fall` uses the shared vector for its drag
      step.copy(velocity)
      fall(position, step, PREDICT_STEP)
      velocity.copy(step)
      if (position.y <= groundUnder(ground, position)) break
    }
    position.y = groundUnder(ground, position)
  }
}

/**
 * Aiming advice for the nearest standing target: how to steer toward it, or how far the
 * aiming cross lies short, long, and to the side. Keys sit in square brackets.
 */
export function bombAdvice(bombs: Bombs, sim: FlightSim): string | null {
  if (!bombs.aiming) return null
  if (bombs.armed >= 0) {
    return `Release armed: hold your course. The bomb drops as the cross reaches the ${bombs.targets[bombs.armed].label}.`
  }
  const index = bombs.nearestStanding(bombs.aim.x, bombs.aim.z)
  if (index < 0) return bombs.falling.length > 0 ? 'Bomb away. Watch the target.' : null
  const target = bombs.targets[index]
  const label = target.label
  const { long, side } = bombs.offset(sim, index)
  // Guided bombs only need the cross inside the launch zone
  if (bombs.guided && Math.hypot(long, side) <= GUIDED_REACH) {
    return `In the launch zone: press [Enter]. The bomb steers itself onto the ${label}.`
  }
  if (!bombs.guided && Math.hypot(long, side) <= target.radius) {
    return `On target: press [Enter] to drop on the ${label}.`
  }
  if (!bombs.guided && bombs.linedUp(sim, index)) {
    return `Lined up, ${Math.round(long)} m to go: press [Enter] and the bomb drops on the ${label}.`
  }
  // The target relative to the aircraft's track
  const track = Math.atan2(sim.velocity.x, -sim.velocity.z)
  const x = target.x - sim.position.x
  const z = target.z - sim.position.z
  const turn = Math.atan2(
    x * Math.cos(track) + z * Math.sin(track),
    x * Math.sin(track) - z * Math.cos(track)
  )
  const degrees = turn * (180 / Math.PI)
  const zone = bombs.guided ? GUIDED_REACH : target.radius
  // Far off to the side or behind: steer first
  if (Math.abs(degrees) > 20) {
    const way = degrees > 0 ? 'right' : 'left'
    const km = (Math.hypot(x, z) / 1000).toFixed(1)
    return `Steer ${Math.round(Math.abs(degrees))}° ${way} for the ${label}, ${km} km away.`
  }
  // Still ahead of the aircraft, but the cross is already beyond it
  if (long < 0) return `The cross is past the ${label}. Fly on, turn around, and make another run.`
  const steer = ` Steer a little ${side > 0 ? 'right' : 'left'}.`
  const what = bombs.guided ? `the launch zone around the ${label}` : `the ${label}`
  const short = Math.round(bombs.guided ? long - zone : long)
  return Math.abs(side) > zone * 0.6
    ? `The cross passes ${Math.round(Math.abs(side))} m to the ${side > 0 ? 'left' : 'right'} of ${what}.${steer}`
    : `The cross falls ${short} m short of ${what}. Hold your course.`
}
