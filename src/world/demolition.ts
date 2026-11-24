import { CONDEMNED, CONDEMNED_BLOCKS, DEMOLITION_GROUNDS, fromStrip, heightAt } from './island'

/** A spot to hover over: `y` is the height of the surface under it above sea level. */
export type Spot = { name: string; x: number; y: number; z: number }

const site = DEMOLITION_GROUNDS
/** Height of the tower's ground floor, and of its roof, above sea level. */
export const TOWER_FOOT = CONDEMNED.decks[0].base
export const TOWER_TOP = CONDEMNED.decks[CONDEMNED.decks.length - 1].top

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west'
]
/** The compass point an offset in metres points to. */
const compass = (dx: number, dz: number) =>
  COMPASS[(Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) + 8) % 8]

/** A mark on a terrace, 6 m in from both its outer edges, at the corner the signs pick. */
function terraceMark(level: number, alongSign: number, acrossSign: number): Spot {
  const [half, , top] = CONDEMNED_BLOCKS[level]
  const { x, z } = fromStrip(site, alongSign * (half - 6), acrossSign * (half - 6))
  const name = `${compass(x - site.x, z - site.z)} corner of the ${level === 0 ? 'lower' : 'upper'} terrace`
  return { name, x, y: TOWER_FOOT + top, z }
}

/**
 * Where the charges go, in order: opposite corners of the lower terrace, a corner of the
 * upper one, and the middle of the roof. Each corner mark is 14 m from the block above it, so
 * a rotor 16 m across clears the wall with the helicopter right over the mark.
 */
export const CHARGE_MARKS: Spot[] = [
  terraceMark(0, 1, 1),
  terraceMark(0, -1, -1),
  terraceMark(1, 1, -1),
  { name: 'roof', x: site.x, y: TOWER_TOP, z: site.z }
]

/**
 * The flatbed truck the charges are hooked on from, parked inside the fence north of the
 * tower. `heading` is in radians, and `y` is the top of the crates on its bed.
 */
export const SUPPLY_TRUCK = (() => {
  const { x, z } = fromStrip(site, 90, 30)
  return {
    name: 'Supply truck',
    x,
    z,
    y: heightAt(x, z) + 2.4,
    heading: ((site.heading + 90) * Math.PI) / 180
  }
})()

/**
 * The tower crane left on the site, 22 m out from the tower's west face. Its jib points away
 * from the tower, and its short counter-jib reaches back toward it. Lengths are in metres
 * along the jib, heights above sea level, and `heading` in radians points along the jib.
 */
export const SITE_CRANE = (() => {
  const { x, z } = fromStrip(site, 0, -64)
  const ground = heightAt(x, z)
  return {
    x,
    z,
    base: ground,
    jib: ground + 116,
    top: ground + 124,
    ahead: 50,
    behind: 15,
    heading: ((site.heading - 90) * Math.PI) / 180
  }
})()
