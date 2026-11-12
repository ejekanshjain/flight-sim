import type { Controls, FlightSim } from '../sim/flight-sim'
import { APPROACHES } from '../world/approaches'
import { AIRPORTS, type Airport, heightAt, isPaved, outside } from '../world/island'
import type { TimeOfDay, Weather, WindLevel } from './game'
import type { Navigator } from './navigation'
import type { Pilot } from './pilot'

export type MissionCategory = 'Tutorial' | 'Speed Run' | 'Airline' | 'Challenge'
export const MISSION_CATEGORIES: MissionCategory[] = [
  'Tutorial',
  'Speed Run',
  'Airline',
  'Challenge'
]

/** A ring to fly through, in order. Heading is in radians. */
export type Gate = { x: number; y: number; z: number; heading: number; radius: number }

/** What a mission can see while it runs. */
export type MissionContext = {
  sim: FlightSim
  controls: Controls
  pilot: Pilot
  nav: Navigator
  /** Seconds since the mission started. */
  time: number
  /** Gates flown through so far. */
  gates: number
  /** The latest touchdown: sink rate in m/s, and whether it was on a runway or taxiway. */
  touchdown: { rate: number; paved: boolean } | null
  /** The airport the aircraft is parked at, engines off and brake set, if any. */
  parkedAt: Airport | null
}

/** One step. Text marks keys in square brackets, such as [W]. */
export type Objective = {
  text: string
  done: (context: MissionContext) => boolean
  /** Seconds the condition must hold before the step counts. */
  hold?: number
}

/** Where the mission begins. Headings are in degrees, speeds in knots, altitudes in metres. */
export type MissionStart =
  | { kind: 'stand' | 'runway'; airport: string }
  | { kind: 'air'; x: number; z: number; altitude: number; heading: number; speed: number }
  | {
      kind: 'approach'
      approach: string
      distance: number
      speed: number
      flapNotch?: number
      gearDown?: boolean
      /** Level flight at the start instead of descending along the glide path. */
      level?: boolean
    }

export type Mission = {
  id: string
  title: string
  category: MissionCategory
  aircraft: string
  /** One line for the mission list. */
  summary: string
  /** A short paragraph for the briefing. */
  briefing: string
  start: MissionStart
  weather?: Weather
  time?: TimeOfDay
  wind?: WindLevel
  /** Airport code for a flight plan, and an approach to tune in. */
  destination?: string
  approach?: string
  gates?: Gate[]
  /** Seconds allowed, or none. */
  timeLimit?: number
  objectives: Objective[]
  /** Ways to fail. The reason can read the context, to quote a figure such as the sink rate. */
  failures?: {
    reason: string | ((context: MissionContext) => string)
    failed: (context: MissionContext) => boolean
  }[]
  /** Runs every frame, for scripted events such as an engine failure. */
  script?: (context: MissionContext) => void
}

const FEET = 0.3048
const FPM = 0.00508
const DEGREES = Math.PI / 180

const airport = (code: string) => {
  const found = AIRPORTS.find(candidate => candidate.code === code)
  if (!found) throw new Error(`Mission airport ${code} does not exist`)
  return found
}

/** True on the ground on one of an airport's runways. */
const onRunwayOf = (code: string) => (context: MissionContext) => {
  const { sim } = context
  const { x, z } = sim.position
  return sim.onGround && airport(code).runways.some(runway => outside(runway, x, z) === 0)
}

const stopped = (context: MissionContext) => context.sim.onGround && context.sim.groundSpeed < 1.5

/** True once the wheels are below `feet` above the tuned runway, or the ground beneath. */
const below = (feet: number) => (context: MissionContext) => {
  const { sim, nav } = context
  const runway = nav.approach ? sim.position.y - nav.approach.end.elevation : sim.altitudeAgl
  return Math.min(runway, sim.altitudeAgl) - sim.spec.restHeight < feet * FEET
}

const airborne = (height: number) => (context: MissionContext) =>
  !context.sim.onGround && context.sim.altitudeAgl > height

/** Lined up on a runway at the airport, pointing along it either way. */
const linedUp = (code: string) => (context: MissionContext) => {
  const { sim } = context
  const { x, z } = sim.position
  return airport(code).runways.some(runway => {
    if (outside(runway, x, z) > 0) return false
    const off = Math.abs(Math.cos(sim.heading - runway.heading * DEGREES))
    return off > Math.cos(15 * DEGREES)
  })
}

/** Highest ground within `reach` metres of a point. */
function highestNear(x: number, z: number, reach: number) {
  let highest = 0
  for (let dx = -reach; dx <= reach; dx += reach / 2) {
    for (let dz = -reach; dz <= reach; dz += reach / 2) {
      highest = Math.max(highest, heightAt(x + dx, z + dz))
    }
  }
  return highest
}

/** Gates through a list of points, each set `clearance` metres above the ground around it. */
function gatesThrough(points: [number, number][], clearance: number, radius: number): Gate[] {
  return points.map(([x, z], i) => {
    const [nextX, nextZ] = points[Math.min(i + 1, points.length - 1)]
    const [lastX, lastZ] = points[Math.max(i - 1, 0)]
    const toX = i + 1 < points.length ? nextX - x : x - lastX
    const toZ = i + 1 < points.length ? nextZ - z : z - lastZ
    return {
      x,
      z,
      y: highestNear(x, z, 600) + clearance,
      heading: Math.atan2(toX, -toZ),
      radius
    }
  })
}

/** Points on a circle, starting due north and going clockwise. */
const circle = (x: number, z: number, radius: number, count: number): [number, number][] =>
  Array.from({ length: count + 1 }, (_, i) => {
    const angle = (i / count) * Math.PI * 2
    return [x + Math.sin(angle) * radius, z - Math.cos(angle) * radius]
  })

/** Points along a straight line, not counting the start. */
const line = (from: Airport, to: Airport, count: number): [number, number][] =>
  Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / count
    return [from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t]
  })

/** Feet per minute, rounded to the nearest 10, from m/s. */
const fpm = (rate: number) => Math.round(rate / FPM / 10) * 10

const tooHard = (limit: number) => ({
  reason: (context: MissionContext) =>
    `The touchdown was too hard at ${fpm(context.touchdown?.rate ?? 0)} ft/min. Keep it under ${fpm(limit)} ft/min: hold Shift and ↓ to raise the nose gently in the last few feet.`,
  failed: (context: MissionContext) => (context.touchdown?.rate ?? 0) > limit
})

const offRunway = {
  reason: 'The aircraft touched down off the runway.',
  failed: (context: MissionContext) => context.touchdown !== null && !context.touchdown.paved
}

/** Passengers notice steep banks and hard pulls. */
const comfort = {
  reason: 'The passengers were frightened: keep the bank under 35° and the pull gentle.',
  failed: (context: MissionContext) =>
    !context.sim.onGround &&
    (Math.abs(context.sim.bank) > 40 * DEGREES ||
      context.sim.gLoad > 1.8 ||
      context.sim.gLoad < 0.3)
}

const startup = (engines: number): Objective[] => [
  { text: 'Press [O] for battery power.', done: c => c.controls.battery },
  { text: 'Press [U] for the fuel pumps.', done: c => c.controls.fuelPumps },
  {
    text:
      engines > 1
        ? `Press [I] to start all ${engines} engines. They start one after another.`
        : 'Press [I] to start the engine.',
    done: c => c.sim.enginesRunning === c.sim.engines.length
  }
]

const ISLAND_RING = gatesThrough(circle(500, 500, 12_500, 8), 140, 90)
const NORTH_TO_EAST = gatesThrough(line(airport('NGT'), airport('EMK'), 6), 180, 110)

export const MISSIONS: Mission[] = [
  {
    id: 'basics',
    title: 'Flying Basics',
    category: 'Tutorial',
    aircraft: 'c172',
    summary: 'Learn the stick, the throttle, the rudder, and the trim.',
    briefing:
      'You start in the air over the sea in a Cessna 172. Each step teaches one control. Watch the bank arc at the top of the screen and the climb figure in the top bar.',
    start: { kind: 'air', x: -4000, z: -16_000, altitude: 700, heading: 90, speed: 95 },
    objectives: [
      {
        text: 'Hold [↓] to raise the nose until you climb at 500 ft/min.',
        done: c => c.sim.verticalSpeed > 500 * FPM && c.controls.pitch > 0.05,
        hold: 1
      },
      {
        text: 'Hold [↑] to lower the nose until you descend at 500 ft/min.',
        done: c => c.sim.verticalSpeed < -500 * FPM && c.controls.pitch < -0.02,
        hold: 1
      },
      {
        text: 'Level off: keep the climb within 200 ft/min of zero.',
        done: c => Math.abs(c.sim.verticalSpeed) < 200 * FPM,
        hold: 3
      },
      {
        text: 'Hold [←] to bank left to 20°. The arc at the top shows the bank.',
        done: c => c.sim.bank < -18 * DEGREES && c.controls.roll < -0.05,
        hold: 1
      },
      {
        text: 'Hold [→] to bank right to 20°.',
        done: c => c.sim.bank > 18 * DEGREES && c.controls.roll > 0.05,
        hold: 1
      },
      {
        text: 'Level the wings and keep them level.',
        done: c => Math.abs(c.sim.bank) < 3 * DEGREES,
        hold: 3
      },
      {
        text: 'Turn to heading 180, due south, then roll the wings level.',
        done: c =>
          Math.abs(Math.cos(c.sim.heading - Math.PI)) > Math.cos(8 * DEGREES) &&
          Math.sin(c.sim.heading - Math.PI) < 0.2 &&
          Math.abs(c.sim.bank) < 8 * DEGREES,
        hold: 2
      },
      { text: 'Hold [S] to bring the throttle below 50%.', done: c => c.controls.throttle < 0.5 },
      { text: 'Hold [W] for full throttle.', done: c => c.controls.throttle > 0.97 },
      {
        text: 'Hold [A] or [D] to press the rudder and swing the nose.',
        done: c => Math.abs(c.controls.yaw) > 0.8,
        hold: 0.5
      },
      {
        text: 'Tap [E] or [Q] to trim, so the nose holds up or down by itself.',
        done: c => Math.abs(c.controls.trim) > 0.05
      }
    ],
    failures: [
      {
        reason: 'The aircraft got too close to the water. Keep above 300 ft.',
        failed: c => c.sim.altitudeAgl < 90
      }
    ]
  },
  {
    id: 'takeoff',
    title: 'Takeoff',
    category: 'Tutorial',
    aircraft: 'c172',
    summary: 'Start the engine, roll down the runway, and climb away.',
    briefing:
      'You are lined up on the main runway at Coral Bay with the battery and fuel on. Start the engine, run up to full power, lift off at 55 knots, and climb.',
    start: { kind: 'runway', airport: 'CBI' },
    objectives: [
      { text: 'Press [I] to start the engine.', done: c => c.sim.enginesRunning === 1 },
      { text: 'Press [P] to release the parking brake.', done: c => !c.controls.parkingBrake },
      { text: 'Hold [W] for full throttle.', done: c => c.controls.throttle > 0.95 },
      {
        text: 'Keep straight with [A] and [D]. At 55 knots, hold [↓] until the wheels lift.',
        done: airborne(8)
      },
      {
        text: 'Climb at about 75 knots to 1,000 ft above the ground.',
        done: airborne(1000 * FEET)
      }
    ]
  },
  {
    id: 'landing',
    title: 'Landing',
    category: 'Tutorial',
    aircraft: 'c172',
    summary: 'Follow the glide path down and touch down gently.',
    briefing:
      'You are 3 NM out on the approach to runway 09 at Coral Bay. The flaps are down and the trim holds 70 knots, so the aircraft descends on its own. The coach under the steps tells you which key to press, and how, all the way to a stop.',
    start: { kind: 'approach', approach: 'ILS 09 CBI', distance: 5500, speed: 70, flapNotch: 3 },
    approach: 'ILS 09 CBI',
    objectives: [
      {
        text: 'Let go of the keys. The aircraft follows the glide path by itself.',
        done: c => c.time > 6
      },
      {
        text: 'Fly through the magenta rings. Tap [←] or [→] to stay lined up with the runway.',
        done: below(500)
      },
      {
        text: 'The throttle sets the descent. Tap [W] if you sink below the rings, [S] if you float above.',
        done: below(200)
      },
      {
        text: 'Aim at the runway numbers. Two white and two red lights beside the runway mean you are on the glide path.',
        done: below(20)
      },
      {
        text: 'Close the throttle with [S]. Hold [Shift] and [↓] to raise the nose gently until the wheels touch.',
        done: c => c.sim.onGround
      },
      {
        text: 'Let it slow, then hold [Space] and [↓] to brake to a stop.',
        done: stopped
      }
    ],
    failures: [tooHard(600 * FPM), offRunway]
  },
  {
    id: 'airliner-start',
    title: 'Airliner Startup and Taxi',
    category: 'Tutorial',
    aircraft: 'a320',
    summary: 'Bring an A320 to life at the gate, taxi out, and take off.',
    briefing:
      'Your A320 is cold and dark at a Coral Bay gate. Power it up, start both engines, push back, follow the yellow lines to the runway, and take off.',
    start: { kind: 'stand', airport: 'CBI' },
    objectives: [
      ...startup(2),
      { text: 'Press [F] twice for takeoff flaps.', done: c => c.controls.flapNotch >= 2 },
      { text: 'Press [P] to release the parking brake.', done: c => !c.controls.parkingBrake },
      {
        text: 'Press [R] and add a little throttle with [W] to push back. Press [R] again when clear.',
        done: c => !c.controls.reverse && movedFromStart(c) > 40
      },
      {
        text: 'Taxi along the yellow lines with [A] and [D], and line up on the runway.',
        done: linedUp('CBI')
      },
      {
        text: 'Hold [W] for full throttle. At 144 knots, hold [↓] to lift off, then press [G].',
        done: c => airborne(150)(c) && !c.controls.gearDown
      }
    ]
  },
  {
    id: 'autopilot-ils',
    title: 'Autopilot and ILS',
    category: 'Tutorial',
    aircraft: 'a320',
    summary: 'Let the autopilot fly an instrument approach and land.',
    briefing:
      'Your A320 is south-west of Northgate with the ILS for runway 05 tuned in. Engage the autopilot and let it fly the approach. You set the gear and flaps, and the autopilot lands the aircraft. The coach under the steps says what to do next.',
    start: { kind: 'approach', approach: 'ILS 05 NGT', distance: 24_000, speed: 220, level: true },
    approach: 'ILS 05 NGT',
    objectives: [
      { text: 'Press [Z] to engage the autopilot.', done: c => c.pilot.autopilot.on },
      {
        text: 'Press [X] for the autothrottle. It slows down by itself.',
        done: c => c.pilot.autothrottle.on
      },
      {
        text: 'Press [T]: the autopilot flies the approach course and glide path, then lands.',
        done: c => c.pilot.flyingApproach
      },
      {
        text: 'Press [G] for gear down and [F] until the flaps are full.',
        done: c => c.controls.gearDown && c.controls.flapNotch >= 4
      },
      {
        text: 'Watch the autopilot flare and touch down. Press [Z] at any time to land by hand instead.',
        done: c => c.sim.onGround
      },
      {
        text: 'The autopilot brakes and steers down to 30 knots. Then hold [Space] to stop.',
        done: stopped
      }
    ],
    failures: [tooHard(600 * FPM), offRunway]
  },
  {
    id: 'island-ring',
    title: 'Island Ring',
    category: 'Speed Run',
    aircraft: 'f16',
    summary: `Race an F-16 through ${ISLAND_RING.length} gates around the main island.`,
    briefing:
      'Fly through every gate in order around Coral Bay island, low over the coast. Full throttle lights the afterburner. You have 4 minutes.',
    start: {
      kind: 'air',
      x: 500 - 3000,
      z: 500 - 12_500,
      altitude: ISLAND_RING[0].y,
      heading: 90,
      speed: 420
    },
    gates: ISLAND_RING,
    timeLimit: 240,
    objectives: [
      {
        text: `Fly through all ${ISLAND_RING.length} gates in order. The next one glows green.`,
        done: c => c.gates >= ISLAND_RING.length
      }
    ]
  },
  {
    id: 'northern-dash',
    title: 'Northern Dash',
    category: 'Speed Run',
    aircraft: 'f35',
    summary: 'Cross the whole map from Northgate to Eastmark in an F-35.',
    briefing:
      'Take off from Northgate and race 40 nautical miles to Eastmark through six gates. Use the afterburner, but watch the hills. You have 6 minutes.',
    start: { kind: 'runway', airport: 'NGT' },
    gates: NORTH_TO_EAST,
    timeLimit: 360,
    objectives: [
      {
        text: 'Press [I] to start the engine, then [P] to release the brake.',
        done: c => c.sim.engineRunning && !c.controls.parkingBrake
      },
      {
        text: 'Take off with full throttle and raise the gear with [G].',
        done: c => airborne(30)(c) && !c.controls.gearDown
      },
      {
        text: `Fly through all ${NORTH_TO_EAST.length} gates to Eastmark.`,
        done: c => c.gates >= NORTH_TO_EAST.length
      }
    ]
  },
  {
    id: 'morning-shuttle',
    title: 'Morning Shuttle',
    category: 'Airline',
    aircraft: 'a320',
    summary: 'Fly passengers from Coral Bay to Eastmark, gate to gate.',
    briefing:
      'A full A320 waits at a Coral Bay gate with a flight plan to Eastmark loaded. Start up, take off, let the autopilot follow the route, land gently, and park at an Eastmark gate.',
    start: { kind: 'stand', airport: 'CBI' },
    destination: 'EMK',
    objectives: [
      ...startup(2),
      { text: 'Push back, taxi out, and take off.', done: airborne(150) },
      {
        text: 'Press [J] and [X]: the autopilot flies the route and the approach.',
        done: c => c.nav.plan !== null && !c.nav.enroute
      },
      {
        text: 'The autopilot lands at Eastmark and brakes to 30 knots. Then hold [Space] to slow down.',
        done: c => onRunwayOf('EMK')(c) && c.sim.groundSpeed < 25
      },
      {
        text: 'Taxi to a gate, set the parking brake with [P], and stop the engines with [I].',
        done: c => c.parkedAt?.code === 'EMK'
      }
    ],
    failures: [tooHard(600 * FPM), offRunway, comfort]
  },
  {
    id: 'island-hopper',
    title: 'Island Hopper',
    category: 'Airline',
    aircraft: 'b737',
    summary: 'A short 737 hop from Northgate to Port Azure.',
    briefing:
      'Your 737 MAX is at a Northgate gate with a flight plan to Port Azure. The 737 has no flight envelope protection, so fly it smoothly. Land softly and park at a gate.',
    start: { kind: 'stand', airport: 'NGT' },
    destination: 'PAZ',
    objectives: [
      ...startup(2),
      { text: 'Push back, taxi out, and take off.', done: airborne(150) },
      {
        text: 'Press [J] and [X]: the autopilot flies the route and the approach.',
        done: c => c.nav.plan !== null && !c.nav.enroute
      },
      {
        text: 'The autopilot lands at Port Azure and brakes to 30 knots. Then hold [Space] to slow down.',
        done: c => onRunwayOf('PAZ')(c) && c.sim.groundSpeed < 25
      },
      {
        text: 'Taxi to a gate, set the parking brake with [P], and stop the engines with [I].',
        done: c => c.parkedAt?.code === 'PAZ'
      }
    ],
    failures: [tooHard(600 * FPM), offRunway, comfort]
  },
  {
    id: 'engine-out',
    title: 'Engine Failure',
    category: 'Challenge',
    aircraft: 'b737',
    summary: 'Lose an engine on approach and land anyway.',
    briefing:
      'You are on the ILS to runway 33 at Eastmark in a 737 MAX, gear and flaps down. Something is about to go wrong. Keep the aircraft straight with the rudder and land it.',
    start: {
      kind: 'approach',
      approach: 'ILS 33 EMK',
      distance: 12_000,
      speed: 150,
      flapNotch: 4,
      gearDown: true
    },
    approach: 'ILS 33 EMK',
    script: c => {
      if (c.time > 8 && !c.sim.engines[0].failed) c.sim.engines[0].failed = true
    },
    objectives: [
      {
        text: 'Engine 1 is about to fail. Be ready with [D] rudder to keep the nose straight.',
        done: c => c.sim.engines[0].failed && c.time > 14
      },
      {
        text: 'Keep holding [D] while the slip ball is off centre, and add power with [W] to stay on the glide path.',
        done: below(1000)
      },
      {
        text: 'Follow the coach down the glide path, or press [T] for the autopilot, and land on runway 33.',
        done: c => onRunwayOf('EMK')(c)
      },
      { text: 'Hold [Space] to stop on the runway.', done: stopped }
    ],
    failures: [tooHard(700 * FPM), offRunway]
  },
  {
    id: 'night-fog',
    title: 'Night Fog',
    category: 'Challenge',
    aircraft: 'a320',
    summary: 'Land at night in thick fog with the ILS.',
    briefing:
      'Visibility is under 1 km at Northgate and it is dark. Fly the ILS to runway 23 by the needles, by hand or with the autopilot. The runway lights appear late.',
    start: { kind: 'approach', approach: 'ILS 23 NGT', distance: 14_000, speed: 180, flapNotch: 2 },
    approach: 'ILS 23 NGT',
    weather: 'fog',
    time: 'night',
    objectives: [
      {
        text: 'Lower the gear [G] and set full flaps [F]. Press [L] for the landing light.',
        done: c => c.controls.gearDown && c.controls.flapNotch >= 4 && c.pilot.landingLights
      },
      {
        text: 'Press [T] and the autopilot lands in the fog, or follow the coach by hand. Land on runway 23.',
        done: onRunwayOf('NGT')
      },
      {
        text: 'Hold [Space] to stop on the runway once the autopilot hands back at 30 knots.',
        done: stopped
      }
    ],
    failures: [tooHard(600 * FPM), offRunway]
  },
  {
    id: 'short-strip',
    title: 'Short Strip',
    category: 'Challenge',
    aircraft: 'c172',
    summary: 'Land a Cessna on the 1,100 m strip at Lantern Rock and stop on it.',
    briefing:
      'Lantern Rock has one short, narrow runway and a crosswind. You are on final at 68 knots with full flaps. Touch down near the start of the strip and brake firmly with the stick held back.',
    start: { kind: 'approach', approach: 'RNAV 14 LRK', distance: 5000, speed: 68, flapNotch: 3 },
    approach: 'RNAV 14 LRK',
    wind: 'light',
    objectives: [
      {
        text: 'Follow the coach down. The crosswind pushes you sideways, so keep turning back to the line.',
        done: below(50)
      },
      { text: 'Touch down on the strip.', done: onRunwayOf('LRK') },
      {
        text: 'Hold [Space] and [↓] together, and stop before the end.',
        done: stopped
      }
    ],
    failures: [
      tooHard(500 * FPM),
      offRunway,
      {
        reason: 'The aircraft ran off the strip.',
        failed: c =>
          c.sim.onGround && c.touchdown !== null && !isPaved(c.sim.position.x, c.sim.position.z)
      }
    ]
  },
  {
    id: 'supersonic',
    title: 'Supersonic Dash',
    category: 'Challenge',
    aircraft: 'concorde',
    summary: 'Take Concorde through the sound barrier to Mach 1.7.',
    briefing:
      'Concorde waits on the runway at Coral Bay with power on. Take off with the afterburners and climb high before going fast: low down, the air is too thick and the airframe overspeeds. You have 15 minutes.',
    start: { kind: 'runway', airport: 'CBI' },
    timeLimit: 900,
    objectives: [
      ...startup(4).slice(2),
      {
        text: 'Press [F] once to droop the nose to 5° for takeoff.',
        done: c => c.controls.flapNotch >= 1
      },
      {
        text: 'Release the brake [P], full throttle [W], and lift off at 195 knots.',
        done: airborne(30)
      },
      {
        text: 'Raise the gear [G] and the nose [V] before 250 knots.',
        done: c => !c.controls.gearDown && c.controls.flapNotch === 0
      },
      {
        text: 'Climb at full throttle. Keep the speed below the red-and-black band on the speed scale.',
        done: c => c.sim.position.y > 20_000 * FEET
      },
      { text: 'Break the sound barrier: pass Mach 1.', done: c => c.sim.trueAirspeed > 340 },
      { text: 'Climb above 50,000 ft.', done: c => c.sim.position.y > 50_000 * FEET },
      { text: 'Accelerate past Mach 1.7.', done: c => c.sim.trueAirspeed > 340 * 1.7 }
    ]
  }
]

/** Metres from where the mission started, for steps such as pushing back. */
let origin = { x: 0, z: 0 }
function movedFromStart(context: MissionContext) {
  const { x, z } = context.sim.position
  return Math.hypot(x - origin.x, z - origin.z)
}

/** Every mission's approach and destination must exist, or the list fails to load. */
for (const mission of MISSIONS) {
  if (mission.approach && !APPROACHES.some(approach => approach.id === mission.approach)) {
    throw new Error(
      `Mission ${mission.id} needs approach ${mission.approach}, which does not exist`
    )
  }
  if (mission.destination) airport(mission.destination)
}

/** Pass or fail. A pass that ended with a landing notes the touchdown sink rate in ft/min. */
export type MissionResult = { passed: true; touchdown?: number } | { passed: false; reason: string }

/** Steps a mission's objectives in order, counts its gates, and decides pass or fail. */
export class MissionRunner {
  mission: Mission | null = null
  /** Index of the objective being worked on; equals the count once all are done. */
  step = 0
  time = 0
  gates = 0
  private held = 0
  private touchdown: MissionContext['touchdown'] = null
  private wasOnGround = true
  private lastSink = 0

  start(mission: Mission, sim: FlightSim) {
    this.mission = mission
    this.step = 0
    this.time = 0
    this.gates = 0
    this.held = 0
    this.touchdown = null
    this.wasOnGround = sim.onGround || sim.altitudeAgl < 3
    this.lastSink = 0
    origin = { x: sim.position.x, z: sim.position.z }
  }

  stop() {
    this.mission = null
  }

  private pass(): MissionResult {
    return this.touchdown ? { passed: true, touchdown: fpm(this.touchdown.rate) } : { passed: true }
  }

  /** Advances by `dt` seconds. Returns the result once the mission is decided. */
  update(
    dt: number,
    context: Omit<MissionContext, 'time' | 'gates' | 'touchdown'>
  ): MissionResult | null {
    const { mission } = this
    if (!mission) return null
    this.time += dt
    const { sim } = context
    // Note each touchdown: how hard, and on what surface
    if (sim.onGround && !this.wasOnGround) {
      this.touchdown = { rate: this.lastSink, paved: isPaved(sim.position.x, sim.position.z) }
    }
    this.wasOnGround = sim.onGround
    if (!sim.onGround) this.lastSink = Math.max(0, -sim.verticalSpeed)
    const gate = mission.gates?.[this.gates]
    if (gate) {
      const distance = Math.hypot(
        sim.position.x - gate.x,
        sim.position.y - gate.y,
        sim.position.z - gate.z
      )
      if (distance < gate.radius) this.gates++
    }
    const full: MissionContext = {
      ...context,
      time: this.time,
      gates: this.gates,
      touchdown: this.touchdown
    }
    mission.script?.(full)
    for (const failure of mission.failures ?? []) {
      if (failure.failed(full)) {
        const { reason } = failure
        return { passed: false, reason: typeof reason === 'string' ? reason : reason(full) }
      }
    }
    if (mission.timeLimit && this.time > mission.timeLimit) {
      return { passed: false, reason: 'Time ran out.' }
    }
    const objective = mission.objectives[this.step]
    if (!objective) return this.pass()
    this.held = objective.done(full) ? this.held + dt : 0
    if (this.held >= (objective.hold ?? 0) && this.held > 0) {
      this.step++
      this.held = 0
      if (this.step >= mission.objectives.length) return this.pass()
    }
    return null
  }
}

const STORAGE_KEY = 'island-flyer-missions-passed'

/** Ids of the missions passed in this browser. Storage can be blocked, so failures read as none. */
export function passedMissions(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function rememberPassed(id: string) {
  try {
    const passed = passedMissions()
    passed.add(id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...passed]))
  } catch {
    // Without storage the result simply is not remembered
  }
}
