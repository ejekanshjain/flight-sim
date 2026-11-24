import type { FlightSim } from '../sim/flight-sim'
import { CHARGE_MARKS, type Spot, SUPPLY_TRUCK } from '../world/demolition'
import { DEMOLITION_GROUNDS } from '../world/island'

// Seconds of steady hover to hook a charge on at the truck, and to lower one onto its mark
export const HOOK_SECONDS = 4
export const LOWER_SECONDS = 5
// The hover the sling allows: within SLING_REACH metres sideways of the spot, wheels between
// SLING_LOW and SLING_HIGH metres above it, and drifting slower than SLING_DRIFT m/s
export const SLING_REACH = 12
export const SLING_LOW = 6
export const SLING_HIGH = 30
export const SLING_DRIFT = 3
/** Seconds from the last charge going down to the blast. */
export const FUSE_SECONDS = 30
/** Metres from the tower the helicopter must be when it blows. */
export const SAFE_DISTANCE = 500

/** What keeps a hover from working the sling over a spot. */
export type HoverFault = 'far' | 'high' | 'low' | 'drifting' | 'landed'

/** Why the helicopter's hover cannot work the sling over a spot, or null when it can. */
export function hoverFault(sim: FlightSim, spot: Spot): HoverFault | null {
  if (sim.onGround) return 'landed'
  if (Math.hypot(sim.position.x - spot.x, sim.position.z - spot.z) > SLING_REACH) return 'far'
  const wheels = sim.position.y - sim.spec.restHeight - spot.y
  if (wheels > SLING_HIGH) return 'high'
  if (wheels < SLING_LOW) return 'low'
  return sim.groundSpeed > SLING_DRIFT ? 'drifting' : null
}

/** Metres from the middle of the tower, sideways. */
export const fromTower = (sim: FlightSim) =>
  Math.hypot(sim.position.x - DEMOLITION_GROUNDS.x, sim.position.z - DEMOLITION_GROUNDS.z)

/** Something that happened this frame, for its sound and effects. */
export type DemolitionEvent = 'hooked' | 'planted' | 'blast'

/**
 * One demolition job. The crew hooks one charge at a time onto the helicopter at the supply
 * truck, and the cable lowers it onto the next mark on the tower. Both need a steady hover
 * and pause while it drifts. The last charge lights the fuse. Call `update` every frame.
 */
export class Demolition {
  /** Charges set on the tower. */
  planted = 0
  /** True with a charge hanging from the cargo hook. */
  carrying = false
  /** Share done of hooking on the next charge, or of lowering the one carried. */
  progress = 0
  /** Seconds left until the blast once the fuse is lit, else null. */
  fuse: number | null = null
  /** Metres from the tower at the moment it blew, or null while it stands. */
  blastDistance: number | null = null

  get blown() {
    return this.blastDistance !== null
  }

  /** Where to hover next: the truck, the next mark, or null once every charge is set. */
  get target(): Spot | null {
    if (this.planted >= CHARGE_MARKS.length) return null
    return this.carrying ? CHARGE_MARKS[this.planted] : SUPPLY_TRUCK
  }

  /** Advances by `dt` seconds. Returns what happened, if anything. */
  update(dt: number, sim: FlightSim): DemolitionEvent | null {
    if (this.blown) return null
    if (this.fuse !== null) {
      this.fuse -= dt
      if (this.fuse > 0) return null
      this.blastDistance = fromTower(sim)
      return 'blast'
    }
    const { target } = this
    if (!target || hoverFault(sim, target)) return null
    this.progress += dt / (this.carrying ? LOWER_SECONDS : HOOK_SECONDS)
    if (this.progress < 1) return null
    this.progress = 0
    if (!this.carrying) {
      this.carrying = true
      return 'hooked'
    }
    this.carrying = false
    this.planted++
    if (this.planted >= CHARGE_MARKS.length) this.fuse = FUSE_SECONDS
    return 'planted'
  }
}
