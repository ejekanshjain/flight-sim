import {
  AIRPORTS,
  CITIES,
  forestAt,
  fromStrip,
  HOSPITAL_GROUNDS,
  heightAt,
  ISLES,
  isClearZone,
  STRUCTURES,
  slopeAt,
  toStrip,
  WORLD_SIZE
} from './island'
import { seededRandom } from './noise'

// Where the scenery stands and how it moves. The renderer draws it and the game
// checks the aircraft against it, so both must read the same data.

export type Tree = {
  x: number
  y: number
  z: number
  tall: number
  wide: number
  broadleaf: boolean
}

/** Upright cylinder the aircraft cannot fly through. */
export type Obstacle = {
  x: number
  z: number
  base: number
  top: number
  radius: number
  kind: 'tree' | 'building' | 'boat'
  /** Stays solid when a bomb flattens the city around it, as the hospital does. */
  bombproof?: boolean
  /**
   * A box instead of a cylinder: half its size along its own X and Z axes, and its turn
   * around the vertical in radians. `radius` then reaches its corners, for the lookup.
   */
  box?: { halfWidth: number; halfDepth: number; turn: number }
}

export type House = {
  x: number
  y: number
  z: number
  /** Rotation around the vertical axis in radians. */
  turn: number
  width: number
  depth: number
  wallHeight: number
  roofHeight: number
}

/** One block of a city building. Skyscrapers stack several, each standing on the last. */
export type Tower = {
  x: number
  y: number
  z: number
  turn: number
  width: number
  depth: number
  height: number
  /** Glass curtain wall instead of concrete with windows. */
  glass: boolean
  /** A cylinder `width` across instead of a box. */
  round: boolean
  /** Index into the facade or glass colours. 6 is plain roof plant grey. */
  tint: number
}

/** A point that circles a centre: boats at sea, balloons over a valley, birds in a flock. */
export type Orbit = {
  centerX: number
  centerZ: number
  radius: number
  height: number
  /** Starting angle in radians and angular speed in rad/s. Negative speeds circle the other way. */
  angle: number
  rate: number
}

const VILLAGE_SITES = [
  [-4300, -4300],
  [-2200, 4400],
  [5300, -300],
  [-600, 7700],
  [14_300, -1900],
  [-9900, 11_500],
  [3700, -6400],
  // The outer islands each get a village 1.4 km from the runway, on the side away from the terminal
  ...AIRPORTS.slice(6).map(airport => {
    const runway = airport.runways[0]
    const side = Math.sign(toStrip(runway, airport.grounds.x, airport.grounds.z).across)
    const spot = fromStrip(runway, 0, -side * 1400)
    return [spot.x, spot.z]
  })
]

function buildHouses() {
  const pick = seededRandom(404)
  const houses: House[] = []
  for (const [siteX, siteZ] of VILLAGE_SITES) {
    if (heightAt(siteX, siteZ) < 5) continue
    const first = houses.length
    const wanted = 28 + Math.floor(pick() * 22)
    for (let attempt = 0; attempt < 400 && houses.length - first < wanted; attempt++) {
      const angle = pick() * Math.PI * 2
      const reach = Math.sqrt(pick()) * 300
      const x = siteX + Math.cos(angle) * reach
      const z = siteZ + Math.sin(angle) * reach
      const y = heightAt(x, z)
      if (y < 5 || slopeAt(x, z) > 0.2 || isClearZone(x, z)) continue
      if (houses.slice(first).some(other => Math.hypot(other.x - x, other.z - z) < 20)) continue
      // The first building of each village is its church tower
      const tower = houses.length === first
      houses.push({
        x,
        y: y - 0.5,
        z,
        turn: pick() * Math.PI,
        width: tower ? 5.5 : 7 + pick() * 4,
        depth: tower ? 5.5 : 9 + pick() * 6,
        wallHeight: tower ? 15 : 3.2 + pick() * 3,
        roofHeight: tower ? 7 : 2 + pick() * 1.4
      })
    }
  }
  return houses
}

/** Streets between city blocks, and the wider avenue after every fourth block. */
export const STREET = 16
export const AVENUE = 28

export type CityBlock = {
  /** Centre of the block in the city's own axes, as for `fromStrip`. */
  along: number
  across: number
  length: number
  width: number
  use: 'buildings' | 'houses' | 'park' | 'plaza' | 'hospital' | 'gateway'
}

/**
 * Each city's look: the facade and glass tints it builds with, as indexes into the
 * renderer's colours, how often a building is glass, and how often a skyscraper takes
 * each shape. Shapes left over are plain blocks.
 */
type CityStyle = {
  facades: number[]
  glazing: number[]
  glass: number
  shapes: { setback: number; round: number; tapered: number; diamond: number }
}

const CITY_STYLES: Record<string, CityStyle> = {
  // A glassy financial district by the sea
  'Coral Bay': {
    facades: [0, 3, 4],
    glazing: [0, 4, 5, 10],
    glass: 0.8,
    shapes: { setback: 0.2, round: 0.15, tapered: 0.2, diamond: 0.15 }
  },
  // White stone and pale glass
  'Port Azure': {
    facades: [3, 0, 10],
    glazing: [1, 5, 7],
    glass: 0.45,
    shapes: { setback: 0.4, round: 0.1, tapered: 0.15, diamond: 0 }
  },
  // Old brick warehouses and bronze glass
  Eastmark: {
    facades: [7, 8, 2],
    glazing: [2, 8],
    glass: 0.3,
    shapes: { setback: 0.45, round: 0.05, tapered: 0.1, diamond: 0.05 }
  },
  // Dark modern towers
  Northgate: {
    facades: [9, 4, 1],
    glazing: [9, 4, 3],
    glass: 0.7,
    shapes: { setback: 0.1, round: 0.2, tapered: 0.15, diamond: 0.25 }
  },
  // Warm sandstone and green glass
  Verity: {
    facades: [5, 2, 10],
    glazing: [7, 1],
    glass: 0.5,
    shapes: { setback: 0.3, round: 0.15, tapered: 0.25, diamond: 0.05 }
  }
}

/** An upright slot a mission flies through on its side, between two towers. */
export type Slot = {
  x: number
  y: number
  z: number
  /** Direction to fly through, in radians clockwise from north. */
  heading: number
  width: number
  height: number
}

type Shape = 'block' | 'setback' | 'round' | 'tapered' | 'diamond'

/** A skyscraper shape for a draw from 0 to 1, by the city's share of each. */
function pickShape(style: CityStyle, draw: number): Shape {
  let left = draw
  for (const shape of ['setback', 'round', 'tapered', 'diamond'] as const) {
    left -= style.shapes[shape]
    if (left < 0) return shape
  }
  return 'block'
}

// Downtown reaches this far out from the city's heart, as a share of its half size
const DOWNTOWN = 0.45
// The city run's gate towers: how far they stand back from the avenue, and their footprint
// across and along it. The slot hangs between them, tall and narrow so it reads as one to fly
// on the side, and starts this high above the street.
const GATE_SETBACK = 4
// Blocks along the city run's avenue step back this far, making it a wide boulevard
const BOULEVARD = 15
const GATE_WIDTH = 24
const GATE_DEPTH = 34
const SLOT_FLOOR = 20
const SLOT_HEIGHT = 60
const SLOT_WIDTH = 36

/** Pointed cap on a skyscraper, or a mast on its roof. */
export type Spire = { x: number; y: number; z: number; height: number; radius: number }
export type Crown = Tower

/** Tree in a city park. */
export type ParkTree = { x: number; y: number; z: number; size: number }

/** Block extents along one side of a city, with streets of random-sized blocks between them. */
function blockSpans(span: number, pick: () => number) {
  const spans: [number, number][] = []
  let at = -span / 2 + 12
  for (let block = 1; ; block++) {
    const size = 70 + Math.floor(pick() * 4) * 20
    if (at + size > span / 2 - 12) break
    spans.push([at, at + size])
    at += size + (block % 4 === 0 ? AVENUE : STREET)
  }
  // Centre the grid in the city
  const shift = -(spans[0][0] + spans[spans.length - 1][1]) / 2
  return spans.map(([from, to]): [number, number] => [from + shift, to + shift])
}

/**
 * Highest a building may reach at a point, in metres above sea level. The limit rises
 * gently away from each runway and stays low under its approach and climb-out paths.
 */
function buildingCeiling(x: number, z: number) {
  let ceiling = Number.POSITIVE_INFINITY
  for (const airport of AIRPORTS) {
    if (Math.hypot(x - airport.x, z - airport.z) > airport.reach + 9000) continue
    for (const runway of airport.runways) {
      const { along, across } = toStrip(runway, x, z)
      const overrun = Math.max(Math.abs(along) - runway.length / 2, 0)
      const aside = Math.max(Math.abs(across) - 150, 0)
      let limit = 45 + Math.max(Math.hypot(overrun, aside) - 300, 0) * 0.15
      if (overrun > 0 && Math.abs(across) < 600 + overrun * 0.15) {
        limit = Math.min(limit, overrun * 0.025)
      }
      ceiling = Math.min(ceiling, airport.elevation + limit)
    }
  }
  return ceiling
}

/** Lowest ground under a footprint, so buildings at the edge of a city never float. */
function baseHeight(x: number, z: number, radius: number) {
  let base = heightAt(x, z)
  for (const [dx, dz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ]) {
    base = Math.min(base, heightAt(x + dx * radius, z + dz * radius))
  }
  return base - 0.5
}

/**
 * Lays out every city: a downtown of skyscrapers on the side away from the airport,
 * a ring of mid-rise offices and flats, then low-rise streets and houses at the edge.
 */
function buildCities() {
  const pick = seededRandom(707)
  const between = (min: number, max: number) => min + pick() * (max - min)
  const plans: { city: (typeof CITIES)[number]; blocks: CityBlock[] }[] = []
  const towers: Tower[] = []
  const spires: Spire[] = []
  const crowns: Crown[] = []
  const trees: ParkTree[] = []
  const houses: House[] = []
  let slots: Slot[] = []

  for (const city of CITIES) {
    const style = CITY_STYLES[city.name] ?? CITY_STYLES['Coral Bay']
    const facade = () => style.facades[Math.floor(pick() * style.facades.length)]
    const glazing = () => style.glazing[Math.floor(pick() * style.glazing.length)]
    const turn = (-city.heading * Math.PI) / 180
    const runway = AIRPORTS.find(airport => airport.code === city.home)?.runways[0]
    const runwaySide = runway ? Math.sign(toStrip(city, runway.x, runway.z).across) : 1
    const core = {
      along: between(-0.15, 0.15) * city.length,
      across: -runwaySide * city.width * 0.18
    }
    const blocks: CityBlock[] = []
    // One grid for the whole city, so its streets and avenues run straight across it
    const acrossSpans = blockSpans(city.width, pick)
    for (const [alongFrom, alongTo] of blockSpans(city.length, pick)) {
      for (const [acrossFrom, acrossTo] of acrossSpans) {
        blocks.push({
          along: (alongFrom + alongTo) / 2,
          across: (acrossFrom + acrossTo) / 2,
          length: alongTo - alongFrom,
          width: acrossTo - acrossFrom,
          use: 'buildings'
        })
      }
    }
    // How far a block is from downtown, 0 at its heart and about 1 at the city edge
    const reach = (block: CityBlock) =>
      Math.hypot(
        (block.along - core.along) / (city.length * 0.5),
        (block.across - core.across) / (city.width * 0.5)
      )
    const heart = blocks.reduce((best, block) => (reach(block) < reach(best) ? block : best))
    for (const block of blocks) {
      const r = reach(block)
      if (block === heart) block.use = 'plaza'
      else if (pick() < (r < 0.3 ? 0.03 : 0.08)) block.use = 'park'
      else if (r > 0.78 && pick() < 0.55) block.use = 'houses'
    }
    // Coral Bay's city run: at three points along the avenue nearest downtown, a slim tower
    // stands on each side of it, with a slot to fly through between them
    const grounds = toStrip(city, HOSPITAL_GROUNDS.x, HOSPITAL_GROUNDS.z)
    const underHospital = (block: CityBlock) =>
      Math.abs(block.along - grounds.along) * 2 < block.length + HOSPITAL_GROUNDS.length + 40 &&
      Math.abs(block.across - grounds.across) * 2 < block.width + HOSPITAL_GROUNDS.width + 40
    let avenue = 0
    if (city === CITIES[0]) {
      let nearest = Number.POSITIVE_INFINITY
      let sides: number[] = []
      for (let i = 1; i < acrossSpans.length; i++) {
        const [, leftEdge] = acrossSpans[i - 1]
        const [rightEdge] = acrossSpans[i]
        const middle = (leftEdge + rightEdge) / 2
        if (rightEdge - leftEdge < AVENUE - 1 || Math.abs(middle - core.across) >= nearest) continue
        nearest = Math.abs(middle - core.across)
        avenue = middle
        sides = [i - 1, i].map(k => (acrossSpans[k][0] + acrossSpans[k][1]) / 2)
      }
      // Widen the avenue into a boulevard by trimming the blocks on each side of it
      for (const block of blocks) {
        if (!sides.includes(block.across)) continue
        const toward = Math.sign(avenue - block.across)
        block.width -= BOULEVARD
        block.across -= (toward * BOULEVARD) / 2
      }
      sides = sides.map(across => across - (Math.sign(avenue - across) * BOULEVARD) / 2)
      const rows = [...new Set(blocks.map(block => block.along))].sort((a, b) => a - b)
      for (const offset of [-800, 0, 800]) {
        const wanted = core.along + offset
        const fits = rows.filter(row => {
          const pair = blocks.filter(block => block.along === row && sides.includes(block.across))
          return pair.length === 2 && pair.every(block => block !== heart && !underHospital(block))
        })
        const row = fits.reduce(
          (best, along) => (Math.abs(along - wanted) < Math.abs(best - wanted) ? along : best),
          fits[0]
        )
        for (const block of blocks) {
          if (block.along === row && sides.includes(block.across)) block.use = 'gateway'
        }
      }
    }
    plans.push({ city, blocks })
    // The three building blocks closest to the plaza get the city's landmark skyscrapers
    const landmarks = blocks
      .filter(block => block.use === 'buildings')
      .sort((a, b) => reach(a) - reach(b))
      .slice(0, 3)

    /** Adds one building part on the city grid. Returns its top, in metres above sea level. */
    const place = (
      along: number,
      across: number,
      part: Omit<Tower, 'x' | 'y' | 'z' | 'turn'>,
      base?: number,
      twist = 0
    ) => {
      const spot = fromStrip(city, along, across)
      const y = base ?? baseHeight(spot.x, spot.z, Math.max(part.width, part.depth) / 2)
      towers.push({ ...part, x: spot.x, y, z: spot.z, turn: turn + twist })
      return y + part.height
    }

    /**
     * A skyscraper in one of the city's shapes, topped off: a plain block, a stack of
     * setbacks, a glass cylinder, a tapering stack, or a block turned 45° to the street.
     * `look` picks the shape and the roof (0 to 1) instead of leaving them to chance.
     */
    const tower = (
      along: number,
      across: number,
      size: number,
      height: number,
      base: number,
      look?: [shape: Shape, finish: number]
    ) => {
      const shape = look?.[0] ?? pickShape(style, pick())
      const glass = pick() < style.glass
      const tint = glass ? glazing() : facade()
      let top = base
      let topSize = size
      const round = shape === 'round'
      const turned = shape === 'diamond'
      const twist = turned ? Math.PI / 4 : 0
      if (shape === 'setback') {
        // Setbacks: each tier narrower than the one below
        const shares = [0.5, 0.3, 0.2]
        shares.forEach((share, tier) => {
          topSize = size * (1 - tier * 0.2)
          top = place(
            along,
            across,
            {
              width: topSize,
              depth: topSize * 1.15,
              height: height * share,
              glass,
              round: false,
              tint
            },
            top
          )
        })
      } else if (round) {
        top = place(
          along,
          across,
          { width: size, depth: size, height, glass: true, round: true, tint: glazing() },
          top
        )
      } else if (shape === 'tapered') {
        // Six even tiers, each a little slimmer, so the tower narrows toward the sky
        for (let tier = 0; tier < 6; tier++) {
          topSize = size * 0.9 ** tier
          top = place(
            along,
            across,
            { width: topSize, depth: topSize, height: height / 6, glass, round: false, tint },
            top
          )
        }
      } else {
        // A block turned 45° must shrink to stay inside its lot
        const depth = turned ? size : size * between(0.8, 1.5)
        const width = turned ? size * Math.SQRT1_2 : size
        top = place(
          along,
          across,
          { width, depth: turned ? width : depth, height, glass, round: false, tint },
          top,
          twist
        )
        topSize = width
      }
      const spot = fromStrip(city, along, across)
      const finish = look?.[1] ?? pick()
      if (finish < 0.3) {
        spires.push({
          ...spot,
          y: top,
          height: height * between(0.12, 0.25),
          radius: between(1, 2)
        })
      } else if (finish < 0.5 && !round) {
        crowns.push({
          ...spot,
          y: top,
          turn: turn + twist,
          width: topSize,
          depth: topSize,
          height: height * between(0.06, 0.12),
          glass,
          round: false,
          tint
        })
      } else {
        // Plant room and a mast
        const plant = place(
          along,
          across,
          {
            width: topSize * 0.45,
            depth: topSize * 0.45,
            height: 6,
            glass: false,
            round: false,
            tint: 6
          },
          top,
          twist
        )
        if (pick() < 0.5) spires.push({ ...spot, y: plant, height: between(8, 20), radius: 0.4 })
      }
    }

    // How many of each part there were as each block began, to empty the hospital's block later
    const parts = [towers, spires, crowns, trees, houses]
    const starts: number[][] = []
    for (const block of blocks) {
      starts.push(parts.map(part => part.length))
      const r = reach(block)
      const center = fromStrip(city, block.along, block.across)
      const ceiling = buildingCeiling(center.x, center.z)
      const ground = baseHeight(center.x, center.z, Math.max(block.length, block.width) / 2)
      const room = ceiling - ground

      if (block.use === 'gateway') {
        // A slim glass tower at the block's avenue edge, and open paving behind it
        const toward = Math.sign(avenue - block.across)
        const edge = block.across + (toward * block.width) / 2
        const across = edge - toward * (GATE_SETBACK + GATE_WIDTH / 2)
        const height = Math.min(between(180, 230), room - 12)
        const top = place(
          block.along,
          across,
          {
            width: GATE_WIDTH,
            depth: GATE_DEPTH,
            height,
            glass: true,
            round: false,
            tint: glazing()
          },
          ground
        )
        const spot = fromStrip(city, block.along, across)
        spires.push({ ...spot, y: top, height: 24, radius: 1.2 })
        // The left tower of each pair sets the slot over the avenue
        if (toward > 0) {
          const middle = fromStrip(city, block.along, avenue)
          slots.push({
            x: middle.x,
            y: ground + SLOT_FLOOR + SLOT_HEIGHT / 2,
            z: middle.z,
            heading: (city.heading * Math.PI) / 180,
            width: SLOT_WIDTH,
            height: SLOT_HEIGHT
          })
        }
        continue
      }

      if (block.use === 'park' || block.use === 'plaza') {
        const spacing = block.use === 'park' ? 13 : 24
        for (let a = -block.length / 2 + 8; a < block.length / 2 - 6; a += spacing) {
          for (let c = -block.width / 2 + 8; c < block.width / 2 - 6; c += spacing) {
            // The plaza keeps its middle open, the park leaves a few clearings
            if (block.use === 'plaza' && Math.abs(a) < block.length / 2 - 14) {
              if (Math.abs(c) < block.width / 2 - 14) continue
            }
            if (block.use === 'park' && pick() < 0.25) continue
            const spot = fromStrip(city, block.along + a + between(-3, 3), block.across + c)
            trees.push({ x: spot.x, y: heightAt(spot.x, spot.z), z: spot.z, size: between(3, 5.5) })
          }
        }
        continue
      }

      if (block.use === 'houses') {
        // Two rows of houses facing the streets on the long sides of the block
        for (const edge of [-1, 1]) {
          for (let a = -block.length / 2 + 9; a < block.length / 2 - 8; a += between(17, 22)) {
            const spot = fromStrip(
              city,
              block.along + a,
              block.across + edge * (block.width / 2 - 13)
            )
            houses.push({
              x: spot.x,
              y: baseHeight(spot.x, spot.z, 6),
              z: spot.z,
              turn: turn + (pick() < 0.5 ? 0 : Math.PI / 2),
              width: between(8, 11),
              depth: between(9, 13),
              wallHeight: between(3.2, 6.4),
              roofHeight: between(2, 3.2)
            })
          }
        }
        continue
      }

      if (r < DOWNTOWN && room > 70) {
        // Downtown: towers on podiums, tallest near the heart of the city
        const landmark = landmarks.indexOf(block)
        const pair = block.length > 100 && landmark < 0 ? 2 : 1
        // Big blocks near the heart take a second row of towers across them
        const rows = block.width > 100 && landmark < 0 && r < DOWNTOWN * 0.7 ? 2 : 1
        if (pick() < 0.6) {
          place(block.along, block.across, {
            width: block.width - 10,
            depth: block.length - 10,
            height: between(10, 18),
            glass: false,
            round: false,
            tint: facade()
          })
        }
        for (let k = 0; k < pair * rows; k++) {
          const along = block.along + (pair === 2 ? ((k % 2) - 0.5) * block.length * 0.5 : 0)
          const across =
            block.across + (rows === 2 ? (Math.floor(k / pair) - 0.5) * block.width * 0.5 : 0)
          if (landmark >= 0) {
            // A stepped tower with a spire, a glass cylinder, and a block with a pointed crown
            const size = Math.min(block.width - 16, block.length - 16, between(46, 58))
            const height = Math.min([400, 350, 310][landmark] * between(0.92, 1.05), room - 12)
            const looks: [Shape, number][] = [
              ['setback', 0.1],
              ['round', 0.9],
              ['tapered', 0.4]
            ]
            tower(along, across, size, height, ground, looks[landmark])
            continue
          }
          const size = Math.min(
            block.width / rows - 18,
            block.length / pair - 14,
            between(28, rows === 2 ? 40 : 52)
          )
          const wanted = (330 - (r / DOWNTOWN) * 200) * between(0.5, 1.05)
          const height = Math.min(wanted, room - 12)
          if (height < 45) continue
          tower(along, across, size, height, ground)
        }
        continue
      }

      // Mid-rise ring and low-rise edge: the block is split into lots
      const mid = r < 0.7
      const lotsAlong = block.length > 95 ? (mid ? 2 : 3) : mid ? 1 : 2
      const lotsAcross = block.width > 95 ? 2 : 1
      const lotLength = block.length / lotsAlong
      const lotWidth = block.width / lotsAcross
      for (let i = 0; i < lotsAlong; i++) {
        for (let j = 0; j < lotsAcross; j++) {
          if (pick() < 0.08) continue
          const along = block.along + (i - (lotsAlong - 1) / 2) * lotLength
          const across = block.across + (j - (lotsAcross - 1) / 2) * lotWidth
          const fade = mid ? 1 - (r - 0.38) / 0.32 : 0
          let height = mid ? between(16, 30) + fade * between(0, 45) : between(7, 17)
          // Now and then an apartment or office tower rises out of the mid-rise ring
          if (mid && pick() < 0.08) height = between(70, 120)
          height = Math.min(height, room - 8)
          if (height < 6) continue
          const glass = mid && height > 40 ? pick() < 0.5 : pick() < 0.12
          const top = place(along, across, {
            width: lotWidth - between(6, 14),
            depth: lotLength - between(6, 14),
            height,
            glass,
            round: false,
            tint: glass ? glazing() : facade()
          })
          // Plant on the roofs of bigger buildings
          if (height > 20 && pick() < 0.5) {
            place(
              along + between(-4, 4),
              across + between(-4, 4),
              {
                width: between(5, 9),
                depth: between(5, 12),
                height: between(2.5, 4.5),
                glass: false,
                round: false,
                tint: 6
              },
              top
            )
          }
        }
      }
    }
    // The hospital takes over the blocks under its grounds. They are laid out as usual and then
    // emptied, so every other block keeps the same buildings.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i]
      if (
        Math.abs(block.along - grounds.along) * 2 >= block.length + HOSPITAL_GROUNDS.length ||
        Math.abs(block.across - grounds.across) * 2 >= block.width + HOSPITAL_GROUNDS.width
      ) {
        continue
      }
      block.use = 'hospital'
      const ends = starts[i + 1] ?? parts.map(part => part.length)
      parts.forEach((part, k) => {
        part.splice(starts[i][k], ends[k] - starts[i][k])
      })
    }

    // Suburbs: rows of houses on the gentle ground around the city, thinning out with distance
    const SUBURB = 420
    const SPACING = 32
    for (let a = -city.length / 2 - SUBURB; a <= city.length / 2 + SUBURB; a += SPACING) {
      for (let c = -city.width / 2 - SUBURB; c <= city.width / 2 + SUBURB; c += SPACING) {
        const away = Math.hypot(
          Math.max(Math.abs(a) - city.length / 2, 0),
          Math.max(Math.abs(c) - city.width / 2, 0)
        )
        if (away < 70 || pick() > 0.8 * (1 - away / SUBURB)) continue
        const spot = fromStrip(city, a + between(-5, 5), c + between(-5, 5))
        if (heightAt(spot.x, spot.z) < 4 || slopeAt(spot.x, spot.z) > 0.15) continue
        if (isClearZone(spot.x, spot.z)) continue
        houses.push({
          x: spot.x,
          y: baseHeight(spot.x, spot.z, 6),
          z: spot.z,
          turn: turn + (pick() < 0.5 ? 0 : Math.PI / 2) + between(-0.1, 0.1),
          width: between(8, 11),
          depth: between(9, 13),
          wallHeight: between(3.2, 6.4),
          roofHeight: between(2, 3.2)
        })
      }
    }
  }
  slots = slots.sort(
    (a, b) => toStrip(CITIES[0], a.x, a.z).along - toStrip(CITIES[0], b.x, b.z).along
  )
  return { plans, towers, spires, crowns, trees, houses, slots }
}

/** Walks inland along a compass bearing and returns the first point at least `minHeight` high. */
function coastPoint(bearing: number, minHeight: number) {
  for (let reach = WORLD_SIZE / 2; reach > 0; reach -= 20) {
    const x = Math.sin(bearing) * reach
    const z = -Math.cos(bearing) * reach
    if (heightAt(x, z) >= minHeight) return { x, y: heightAt(x, z), z, reach }
  }
  return { x: 0, y: heightAt(0, 0), z: 0, reach: 0 }
}

/** The headland of the main island that reaches farthest west gets the lighthouse. */
function findHeadland() {
  let best = coastPoint(Math.PI * 1.25, 8)
  for (let step = 0; step < 24; step++) {
    const point = coastPoint(Math.PI * (1.25 + step / 48), 8)
    if (point.reach > best.reach) best = point
  }
  return best
}

const random = seededRandom(505)
const between = (min: number, max: number) => min + random() * (max - min)
const eitherWay = () => (random() < 0.5 ? -1 : 1)

/** Finds circular routes that stay over deep water all the way round. */
function seaRoutes(count: number, minRadius: number, maxRadius: number, speed: [number, number]) {
  const routes: Orbit[] = []
  for (let attempt = 0; attempt < 4000 && routes.length < count; attempt++) {
    const centerX = between(-WORLD_SIZE * 0.42, WORLD_SIZE * 0.42)
    const centerZ = between(-WORLD_SIZE * 0.42, WORLD_SIZE * 0.42)
    const radius = between(minRadius, maxRadius)
    let clear = true
    for (let i = 0; i < 48 && clear; i++) {
      const angle = (i / 48) * Math.PI * 2
      clear = heightAt(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius) < -22
    }
    if (!clear) continue
    routes.push({
      centerX,
      centerZ,
      radius,
      height: 0,
      angle: between(0, Math.PI * 2),
      rate: (eitherWay() * between(speed[0], speed[1])) / radius
    })
  }
  return routes
}

const CITY = buildCities()
export const CITY_PLANS = CITY.plans
export const TOWERS = CITY.towers
export const SPIRES = CITY.spires
export const CROWNS = CITY.crowns
export const PARK_TREES = CITY.trees
/** Coral Bay's city run slots, in order along its avenue. */
export const CITY_SLOTS = CITY.slots
export const HOUSES = [...buildHouses(), ...CITY.houses]
export const LIGHTHOUSE = findHeadland()
export const SAILBOATS = seaRoutes(36, 700, 2600, [2, 4.5])
export const SHIP = seaRoutes(1, 3000, 4200, [6, 6])[0] ?? SAILBOATS[0]

/** Hot-air balloons drift in wide circles over the villages. */
export const BALLOONS: Orbit[] = VILLAGE_SITES.slice(0, 5).map(([x, z]) => ({
  centerX: x + between(-600, 600),
  centerZ: z + between(-600, 600),
  radius: between(500, 1100),
  height: Math.max(heightAt(x, z), 0) + between(260, 620),
  angle: between(0, Math.PI * 2),
  rate: (eitherWay() * between(1.5, 3)) / 800
}))

/** Each flock circles a spot on the shoreline. */
export const FLOCKS: Orbit[][] = Array.from({ length: 8 }, (_, flock) => {
  const coast = coastPoint(((flock + 0.4) / 8) * Math.PI * 2, 1)
  const height = between(45, 140)
  const way = eitherWay()
  return Array.from({ length: 14 }, () => ({
    centerX: coast.x + between(-40, 40),
    centerZ: coast.z + between(-40, 40),
    radius: between(90, 240),
    height: coast.y + height + between(-15, 15),
    angle: between(0, Math.PI * 2),
    rate: (way * between(9, 13)) / 160
  }))
})

function buildTrees() {
  const pick = seededRandom(7)
  const trees: Tree[] = []
  let pines = 0
  let broadleaves = 0
  // Bigger islands get more of the tries, in proportion to their area
  const area = ISLES.reduce((sum, isle) => sum + isle.radius ** 2, 0)
  for (let attempt = 0; attempt < 3_000_000 && trees.length < 90_000; attempt++) {
    let share = pick() * area
    const isle = ISLES.find(candidate => {
      share -= candidate.radius ** 2
      return share <= 0
    })
    if (!isle) continue
    const x = isle.x + (pick() - 0.5) * isle.radius * 2.6
    const z = isle.z + (pick() - 0.5) * isle.radius * 2.6
    const height = heightAt(x, z)
    if (height < 4 || height > 640) continue
    // Trees thin out toward open grassland
    if (pick() > Math.min(1, Math.max(0.03, (forestAt(x, z) - 0.38) * 5))) continue
    if (slopeAt(x, z) > 0.6 || isClearZone(x, z)) continue
    // Broadleaf woods in the lowlands give way to conifers higher up
    const broadleaf = pick() > (height - 20) / 160
    if (broadleaf ? broadleaves >= 24_000 : pines >= 66_000) continue
    const tall = broadleaf ? 9 + pick() * 7 : 12 + pick() * 12
    const wide = tall * (broadleaf ? 0.95 + pick() * 0.3 : 0.85 + pick() * 0.3)
    trees.push({ x, y: height - 0.3, z, tall, wide, broadleaf })
    if (broadleaf) broadleaves++
    else pines++
  }
  return trees
}

export const TREES = buildTrees()

/**
 * Roads as lists of waypoints: from each city to its airport terminal and to the nearest village.
 * They follow the ground between waypoints.
 */
export const ROADS: [number, number][][] = CITIES.flatMap(city => {
  const airport = AIRPORTS.find(candidate => candidate.code === city.home) ?? AIRPORTS[0]
  const terminal = airport.buildings[0]
  // Arrive on the landside of the terminal, away from the apron
  const landside = fromStrip(terminal, 0, -60)
  const village = VILLAGE_SITES.reduce((nearest, site) =>
    Math.hypot(site[0] - city.x, site[1] - city.z) <
    Math.hypot(nearest[0] - city.x, nearest[1] - city.z)
      ? site
      : nearest
  )
  return [
    [
      [city.x, city.z],
      [(city.x + landside.x) / 2, (city.z + landside.z) / 2],
      [landside.x, landside.z]
    ],
    [
      [city.x, city.z],
      [village[0], village[1]]
    ]
  ] as [number, number][][]
})

/** Every fixed thing the aircraft can hit. */
export const OBSTACLES: Obstacle[] = [
  // The crown is the widest part of a tree, and narrower on a conifer
  ...TREES.map(
    (tree): Obstacle => ({
      x: tree.x,
      z: tree.z,
      base: tree.y,
      top: tree.y + tree.tall * 0.95,
      radius: tree.wide * (tree.broadleaf ? 0.3 : 0.18),
      kind: 'tree'
    })
  ),
  ...HOUSES.map(
    (house): Obstacle => ({
      x: house.x,
      z: house.z,
      base: house.y,
      top: house.y + house.wallHeight + house.roofHeight * 0.7,
      radius: Math.max(house.width, house.depth) * 0.5,
      kind: 'building'
    })
  ),
  // Big blocks become a grid of boxes, small enough for the collision lookup
  ...TOWERS.flatMap(tower => {
    if (tower.round) {
      const { x, z, y, height, width } = tower
      return [{ x, z, base: y, top: y + height, radius: width / 2, kind: 'building' } as Obstacle]
    }
    const across = Math.ceil(tower.width / 50)
    const along = Math.ceil(tower.depth / 50)
    const cellWidth = tower.width / across
    const cellDepth = tower.depth / along
    const circles: Obstacle[] = []
    for (let i = 0; i < across; i++) {
      for (let j = 0; j < along; j++) {
        // Width runs along the building's local X axis and depth along its local Z axis
        const localX = (i - (across - 1) / 2) * cellWidth
        const localZ = (j - (along - 1) / 2) * cellDepth
        circles.push({
          x: tower.x + Math.cos(tower.turn) * localX + Math.sin(tower.turn) * localZ,
          z: tower.z - Math.sin(tower.turn) * localX + Math.cos(tower.turn) * localZ,
          base: tower.y,
          top: tower.y + tower.height,
          radius: Math.hypot(cellWidth, cellDepth) / 2,
          kind: 'building',
          box: { halfWidth: cellWidth / 2, halfDepth: cellDepth / 2, turn: tower.turn }
        })
      }
    }
    return circles
  }),
  ...SPIRES.map(
    (spire): Obstacle => ({
      x: spire.x,
      z: spire.z,
      base: spire.y,
      top: spire.y + spire.height,
      radius: spire.radius,
      kind: 'building'
    })
  ),
  ...CROWNS.map(
    (crown): Obstacle => ({
      x: crown.x,
      z: crown.z,
      base: crown.y,
      top: crown.y + crown.height * 0.6,
      radius: crown.width * 0.4,
      kind: 'building'
    })
  ),
  ...PARK_TREES.map(
    (tree): Obstacle => ({
      x: tree.x,
      z: tree.z,
      base: tree.y,
      top: tree.y + tree.size * 2.6,
      radius: tree.size * 0.6,
      kind: 'tree'
    })
  ),
  // Decks stop 1 m short of their tops, so wheels pressed into a deck do not touch them
  ...STRUCTURES.flatMap(structure => {
    const kind = structure.kind === 'ship' ? 'boat' : 'building'
    const circles: Obstacle[] = structure.posts.map(post => ({ ...post, kind, bombproof: true }))
    for (const deck of structure.decks) {
      const along = Math.ceil(deck.length / 12)
      const across = Math.ceil(deck.width / 12)
      const cellLength = deck.length / along
      const cellWidth = deck.width / across
      for (let i = 0; i < along; i++) {
        for (let j = 0; j < across; j++) {
          circles.push({
            ...fromStrip(
              deck,
              (i - (along - 1) / 2) * cellLength,
              (j - (across - 1) / 2) * cellWidth
            ),
            base: deck.base,
            top: deck.top - 1,
            radius: Math.hypot(cellLength, cellWidth) * 0.5,
            kind,
            bombproof: true
          })
        }
      }
    }
    return circles
  }),
  {
    x: LIGHTHOUSE.x,
    z: LIGHTHOUSE.z,
    base: LIGHTHOUSE.y,
    top: LIGHTHOUSE.y + 33.5,
    radius: 4,
    kind: 'building'
  },
  // Long buildings become a row of circles, one for every stretch as long as they are deep
  ...AIRPORTS.flatMap(airport =>
    airport.buildings.flatMap(building => {
      const circles = Math.max(1, Math.round(building.length / building.width))
      return Array.from({ length: circles }, (_, i): Obstacle => {
        const along = ((i + 0.5) / circles - 0.5) * building.length
        return {
          ...fromStrip(building, along, 0),
          base: airport.elevation,
          top: airport.elevation + building.height,
          radius: building.width * 0.55,
          kind: 'building'
        }
      })
    })
  )
]

/** Height of the tallest obstacle above its base, in metres. */
export const TALLEST_OBSTACLE = OBSTACLES.reduce(
  (tallest, obstacle) => Math.max(tallest, obstacle.top - obstacle.base),
  0
)

type Point = { x: number; y: number; z: number }

/** Writes the position on an orbit at `time` seconds into `out` and returns the orbit angle. */
export function orbitPosition(orbit: Orbit, time: number, out: Point) {
  const angle = orbit.angle + orbit.rate * time
  out.x = orbit.centerX + Math.cos(angle) * orbit.radius
  out.y = orbit.height
  out.z = orbit.centerZ + Math.sin(angle) * orbit.radius
  return angle
}

/** Centre of a balloon's envelope at `time`. Balloons also rise and sink a little. */
export function balloonPosition(index: number, time: number, out: Point) {
  orbitPosition(BALLOONS[index], time, out)
  out.y += Math.sin(time * 0.15 + index * 1.7) * 14
}
