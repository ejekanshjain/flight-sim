import { Vector3 } from 'three'

export const GRAVITY = 9.81
export const SEA_LEVEL_DENSITY = 1.225
export const SPEED_OF_SOUND = 340
export const KNOT = 0.5144

/** Rolling resistance of a free wheel on each surface. */
export const ROLLING_FRICTION = { runway: 0.02, grass: 0.06, water: 0.06 } as const

export type ContactPoint = {
  position: Vector3
  stiffness: number
  damping: number
  /** Retracts with the landing gear and breaks on a hard touchdown. */
  gear: boolean
  braked: boolean
  steered: boolean
  /** Extra drag friction for parts that scrape instead of roll. */
  scrape: number
}

export type PistonEngine = {
  type: 'piston'
  /** Shaft power in watts. */
  shaftPower: number
  propEfficiency: number
  /** Thrust stops rising below this airspeed (m/s), which caps static thrust. */
  staticThrustSpeed: number
  idlePower: number
  /** Yaw arm in metres: the propeller pulls the nose left at low speed and high power. */
  propYawArm: number
  propYawFadeSpeed: number
  idleRpm: number
  maxRpm: number
}

export type JetEngine = {
  type: 'jet'
  /** Total thrust in newtons at idle, at full dry power, and with afterburners lit. */
  idleThrust: number
  militaryThrust: number
  afterburnerThrust: number
  /** Throttle position from 0 to 1 where the afterburner lights. 1 for engines without one. */
  afterburnerFrom: number
  /** Share of thrust lost by Mach 1. Airliner turbofans lose about half, fighter engines little. */
  speedLapse: number
}

/** Ranges and coloured arcs for the cockpit dials, in the units the dials show. */
export type GaugeSpec = {
  airspeed: {
    min: number
    max: number
    labelEvery: number
    tickEvery: number
    flapRange: [number, number] | null
    normalRange: [number, number]
    cautionRange: [number, number]
  }
  /** Full-scale climb rate in feet per minute. */
  climb: number
  power: {
    caption: string
    max: number
    labelEvery: number
    tickEvery: number
    /** Divides the reading for the printed labels, such as 100 for RPM × 100. */
    labelScale: number
    normalRange: [number, number]
    redline: number
  }
}

export type AirlinerShape = {
  type: 'airliner'
  /** Concorde keeps the airliner proportions for gates and maps, with its own model. */
  variant?: 'concorde'
  /** Fuselage radius, and how much taller than wide it is (above 1 for a double-decker). */
  radius: number
  tall: number
  noseZ: number
  tailZ: number
  decks: 1 | 2
  wing: {
    y: number
    dihedral: number
    /** Distance from the centreline to the wingtip. */
    halfSpan: number
    /** Leading edge at the root and at the tip, measured along the body. */
    rootZ: number
    tipZ: number
    rootChord: number
    tipChord: number
    tip: 'sharklet' | 'split' | 'raked' | 'fence'
  }
  /** Right-hand engines as [distance from centreline, front of the nacelle]. Mirrored on the left. */
  engines: [number, number][]
  engineRadius: number
  engineLength: number
  engineY: number
  tailSpan: number
  finHeight: number
  paint: string
  accent: string
}

/** Proportions of the visible model. Positions are in body axes. */
export type Shape =
  | {
      type: 'propeller'
      noseZ: number
      tailZ: number
      cabinRadius: number
      /** Height of the wing on the fuselage, and its upward tilt in radians. */
      wingY: number
      dihedral: number
      highWing: boolean
      tailSpan: number
      finHeight: number
      propRadius: number
      paint: string
      accent: string
    }
  | { type: 'fighter'; variant: 'f16' | 'f35'; paint: string; accent: string }
  | AirlinerShape

/**
 * Everything that makes one aircraft type fly, look, and read differently.
 * SI units and radians unless a field says otherwise.
 * Body axes: -Z points out the nose, +X out the right wing, +Y up.
 */
export type AircraftSpec = {
  id: string
  name: string
  /** Short name for tight spaces, such as A320. */
  label: string
  role: string
  description: string
  /** Headline numbers for the aircraft picker. Speeds in knots, climb in feet per minute. */
  stats: { power: string; topSpeed: number; stallSpeed: number; climb: number }

  /** Kilograms with a typical landing fuel load, 30% of the tanks. Fuel adds to it or takes away. */
  mass: number
  inertiaPitch: number
  inertiaYaw: number
  inertiaRoll: number
  wingArea: number
  wingSpan: number
  chord: number

  // Lift
  cl0: number
  clAlpha: number
  flapLift: number
  stallAlpha: number
  negativeStallAlpha: number
  /** Change in stall angle with full flap. Negative where slats let the wing fly at steeper angles. */
  flapStallShift: number
  stallSharpness: number
  /** Once stalled, the wing stays stalled until the angle of attack drops this far below the stall. */
  stallHysteresis: number
  /** The stall horn sounds this far below the stall angle. */
  stallWarningMargin: number

  // Drag
  cd0: number
  gearDrag: number
  flapDrag: number
  inducedDrag: number
  sideDrag: number
  sideForce: number
  /** Extra drag near and above the speed of sound. */
  waveDrag: number
  speedBrakeDrag: number
  /** Share of wing lift the open airbrake or spoilers destroy. */
  liftDump: number

  // Pitch moment
  cm0: number
  cmAlpha: number
  cmPitchRate: number
  cmElevator: number
  cmTrim: number
  cmStall: number

  // Roll moment
  clBeta: number
  clRollRate: number
  clYawRate: number
  clAileron: number
  /** Roll moment that drops the left wing at the stall, as engine torque does. */
  stallRollBias: number

  // Yaw moment
  cnBeta: number
  cnYawRate: number
  cnRollRate: number
  cnRudder: number
  cnAileron: number

  engine: PistonEngine | JetEngine
  engineCount: number
  /** Seconds for the engines to follow the throttle, and for each one to start. */
  spoolSeconds: number
  starterSeconds: number
  /** Fuel in kg, and burn in kg/s at idle and at full power. */
  fuelCapacity: number
  /** True for aircraft that can pump fuel overboard to land lighter. */
  fuelDump: boolean
  fuelBurnIdle: number
  fuelBurnFull: number
  /** Unit shown on the fuel gauge, and how many of them make one kilogram. */
  fuelUnit: { label: string; perKg: number }

  /** Names of the flap lever positions, starting with flaps up. One entry means no flaps. */
  flapLabels: string[]
  /** What the flap lever moves: the flaps, or Concorde's drooping nose. */
  flapName: 'Flaps' | 'Nose'
  /**
   * Highest indicated airspeed in knots for each flap position after Up, and with the gear
   * down (null for fixed gear). Flying faster for long damages the flaps or gear.
   */
  flapSpeeds: number[]
  gearSpeed: number | null
  flapSecondsPerNotch: number
  retractableGear: boolean
  gearSeconds: number
  /** Share of forward thrust available in reverse. */
  reverseThrust: number
  /**
   * Fly-by-wire: the computers trim for level flight, stop the wing short of the stall by
   * `alphaMargin` radians, and stop the bank at `maxBank` radians.
   */
  flyByWire: { alphaMargin: number; maxBank: number } | null
  /** Spoilers and brakes come on by themselves after touchdown. */
  autobrake: boolean

  /** Indicated airspeed in m/s where a full pull reaches the stall and the g limit together. */
  maneuverSpeed: number
  /** Indicated airspeed in m/s the airframe must never exceed. It breaks up 12% above this. */
  neverExceedSpeed: number
  maxTouchdownSink: number
  gearTravel: number
  brakeFriction: number
  sideFriction: number
  maxSteerAngle: number

  /** Nose wheel, left main, right main, then the tail skid. */
  contactPoints: ContactPoint[]
  /** Touching the ground with any of these ends the flight. */
  hullPoints: { position: Vector3; underside: boolean }[]
  /** Height of the centre of gravity above the ground when parked. */
  restHeight: number
  wingtips: [Vector3, Vector3]
  /** Centres of the five parts the aircraft breaks into: fuselage, nose, left wing, right wing, tail. */
  breakup: { rest: Vector3; radius: number }[]

  /** Speeds in knots for the checklists, and in m/s for a start in the air. */
  rotateSpeed: number
  climbSpeed: number
  approachSpeed: number
  cruiseSpeed: number
  /** Shortest runway in metres this aircraft can use with a margin. */
  runwayNeeded: number
  gauges: GaugeSpec
  /** Instrument style: round dials, an airliner's flight display, or a fighter's head-up display. */
  panel: 'dials' | 'glass' | 'hud'
  camera: { distance: number; height: number; eye: Vector3 }
  shape: Shape
}

const wheel = (
  x: number,
  y: number,
  z: number,
  stiffness: number,
  damping: number,
  role: 'nose' | 'main'
): ContactPoint => ({
  position: new Vector3(x, y, z),
  stiffness,
  damping,
  gear: true,
  braked: role === 'main',
  steered: role === 'nose',
  scrape: 0
})

/** Tail skid: survives a tail strike on rotation. */
const skid = (y: number, z: number, stiffness: number): ContactPoint => ({
  position: new Vector3(0, y, z),
  stiffness,
  damping: stiffness / 10,
  gear: false,
  braked: false,
  steered: false,
  scrape: 0.4
})

const hull = (x: number, y: number, z: number, underside = false) => ({
  position: new Vector3(x, y, z),
  underside
})

/**
 * Nose-up pitch in radians, with the main wheels on the ground, at which the first part of
 * the airframe behind them touches the runway: the tail, or the engine pods.
 */
export function tailStrikePitch(spec: AircraftSpec) {
  const main = spec.contactPoints.find(point => point.braked)
  if (!main) return Math.PI / 4
  let lowest = Math.PI / 4
  for (const { position } of spec.hullPoints) {
    const behind = position.z - main.position.z
    if (behind <= 0) continue
    lowest = Math.min(lowest, Math.atan2(position.y - main.position.y, behind))
  }
  return lowest
}

const part = (x: number, y: number, z: number, radius: number) => ({
  rest: new Vector3(x, y, z),
  radius
})

const CESSNA: AircraftSpec = {
  id: 'c172',
  name: 'Cessna 172 Skyhawk',
  label: 'Cessna 172',
  role: 'Four-seat piston single',
  description:
    'The aircraft most pilots learn on. Slow and steady, with cables to the controls and nothing to save you from a stall.',
  stats: { power: '160 hp', topSpeed: 111, stallSpeed: 50, climb: 760 },

  mass: 1100,
  inertiaPitch: 1825,
  inertiaYaw: 2667,
  inertiaRoll: 1285,
  wingArea: 16.2,
  wingSpan: 11,
  chord: 1.5,

  cl0: 0.3,
  clAlpha: 5.1,
  flapLift: 0.55,
  stallAlpha: 0.279,
  negativeStallAlpha: 0.21,
  flapStallShift: 0.035,
  stallSharpness: 50,
  stallHysteresis: 0.09,
  stallWarningMargin: 0.07,

  cd0: 0.033,
  gearDrag: 0,
  flapDrag: 0.05,
  inducedDrag: 0.0533,
  sideDrag: 0.6,
  sideForce: -0.5,
  waveDrag: 0,
  speedBrakeDrag: 0,
  liftDump: 0,

  cm0: 0.05,
  cmAlpha: -0.89,
  cmPitchRate: -12,
  cmElevator: 0.28,
  cmTrim: 0.14,
  cmStall: -0.06,

  clBeta: -0.08,
  clRollRate: -0.47,
  clYawRate: 0.05,
  clAileron: 0.05,
  stallRollBias: 0.016,

  cnBeta: 0.12,
  cnYawRate: -0.12,
  cnRollRate: -0.02,
  cnRudder: 0.024,
  cnAileron: -0.008,

  engine: {
    type: 'piston',
    shaftPower: 120_000,
    propEfficiency: 0.8,
    staticThrustSpeed: 35,
    idlePower: 0.05,
    propYawArm: 0.04,
    propYawFadeSpeed: 50,
    idleRpm: 600,
    maxRpm: 2700
  },
  engineCount: 1,
  spoolSeconds: 0.4,
  starterSeconds: 2,
  fuelCapacity: 150,
  fuelDump: false,
  fuelBurnIdle: 0.0012,
  fuelBurnFull: 0.008,
  fuelUnit: { label: 'L', perKg: 1 / 0.72 },

  flapLabels: ['Up', '10°', '20°', '30°'],
  flapName: 'Flaps',
  flapSpeeds: [110, 85, 85],
  gearSpeed: null,
  flapSecondsPerNotch: 1.5,
  retractableGear: false,
  gearSeconds: 3,
  reverseThrust: 0.45,
  flyByWire: null,
  autobrake: false,

  maneuverSpeed: 50,
  neverExceedSpeed: 163 * KNOT,
  maxTouchdownSink: 5,
  gearTravel: 0.45,
  brakeFriction: 0.6,
  sideFriction: 0.8,
  maxSteerAngle: 0.45,

  contactPoints: [
    wheel(0, -1.25, -1.45, 90_000, 6000, 'nose'),
    wheel(-1.25, -1.25, 0.4, 60_000, 6000, 'main'),
    wheel(1.25, -1.25, 0.4, 60_000, 6000, 'main'),
    skid(-0.3, 5, 40_000)
  ],
  hullPoints: [
    hull(0, -0.95, -2.45, true),
    hull(0, -0.7, 0, true),
    hull(-5.55, 0.8, 0.1),
    hull(5.55, 0.8, 0.1),
    hull(0, 1.75, 5),
    hull(0, 1.1, -0.2)
  ],
  restHeight: 1.19,
  wingtips: [new Vector3(-5.5, 0.82, 0.4), new Vector3(5.5, 0.82, 0.4)],
  breakup: [
    part(0, 0, 0.4, 0.75),
    part(0, 0, -2.4, 0.35),
    part(-2.9, 0.8, 0.1, 0.3),
    part(2.9, 0.8, 0.1, 0.3),
    part(0, 0.45, 4.7, 0.5)
  ],

  rotateSpeed: 55,
  climbSpeed: 75,
  approachSpeed: 65,
  cruiseSpeed: 48,
  runwayNeeded: 500,
  gauges: {
    airspeed: {
      min: 20,
      max: 180,
      labelEvery: 20,
      tickEvery: 10,
      flapRange: [44, 85],
      normalRange: [50, 129],
      cautionRange: [129, 163]
    },
    climb: 2000,
    power: {
      caption: 'RPM × 100',
      max: 3000,
      labelEvery: 500,
      tickEvery: 100,
      labelScale: 100,
      normalRange: [2100, 2700],
      redline: 2700
    }
  },
  panel: 'dials',
  camera: { distance: 16, height: 4.8, eye: new Vector3(-0.25, 0.55, -0.5) },
  shape: {
    type: 'propeller',
    noseZ: -2.45,
    tailZ: 5.2,
    cabinRadius: 0.62,
    wingY: 0.8,
    dihedral: 0.03,
    highWing: true,
    tailSpan: 3.4,
    finHeight: 1.4,
    propRadius: 0.95,
    paint: '#f3f2ee',
    accent: '#1f4f8f'
  }
}

/** The numbers that differ between airliners. Everything else is derived or shared. */
type AirlinerPlan = {
  id: string
  name: string
  label: string
  role: string
  description: string
  mass: number
  /** Thrust in newtons per engine. */
  thrust: number
  thrustLabel: string
  wingArea: number
  chord: number
  inertia: [pitch: number, yaw: number, roll: number]
  flyByWire: boolean
  fuelDump: boolean
  flapLabels: string[]
  flapSpeeds: number[]
  gearSpeed: number
  fuelCapacity: number
  /** Height of the wheels below the centreline, and where the gear legs stand. */
  gear: { y: number; noseZ: number; mainX: number; mainZ: number }
  stallSpeed: number
  climb: number
  shape: AirlinerShape
}

/** Builds a jet airliner. They share one wing design scaled to each airframe. */
function airliner(plan: AirlinerPlan): AircraftSpec {
  const { shape, gear } = plan
  const weight = plan.mass * GRAVITY
  const engines = shape.engines.length * 2
  const { halfSpan } = shape.wing
  const tipY = shape.wing.y + halfSpan * Math.sin(shape.wing.dihedral)
  // Share of the weight on the nose wheel when parked
  const noseShare = gear.mainZ / (gear.mainZ - gear.noseZ)
  const spring = (load: number, sag: number) => {
    const stiffness = load / sag
    return [stiffness, 1.1 * Math.sqrt((stiffness * load) / GRAVITY)] as const
  }
  // The nose strut is stiff enough to take the extra load of full braking and the nose
  // coming down after touchdown
  const [noseSpring, noseDamper] = spring(weight * noseShare, 0.08)
  const [mainSpring, mainDamper] = spring((weight * (1 - noseShare)) / 2, 0.22)
  const top = shape.radius * shape.tall
  const length = shape.tailZ - shape.noseZ
  return {
    id: plan.id,
    name: plan.name,
    label: plan.label,
    role: plan.role,
    description: plan.description,
    stats: {
      power: plan.thrustLabel,
      topSpeed: 350,
      stallSpeed: plan.stallSpeed,
      climb: plan.climb
    },

    mass: plan.mass,
    inertiaPitch: plan.inertia[0],
    inertiaYaw: plan.inertia[1],
    inertiaRoll: plan.inertia[2],
    wingArea: plan.wingArea,
    wingSpan: halfSpan * 2,
    chord: plan.chord,

    cl0: 0.2,
    clAlpha: 5.2,
    flapLift: 1.35,
    stallAlpha: 0.25,
    negativeStallAlpha: 0.2,
    flapStallShift: -0.06,
    stallSharpness: 40,
    stallHysteresis: 0.07,
    stallWarningMargin: 0.06,

    cd0: 0.019,
    gearDrag: 0.018,
    flapDrag: 0.075,
    inducedDrag: 0.042,
    sideDrag: 0.5,
    sideForce: -0.7,
    waveDrag: 0.03,
    speedBrakeDrag: 0.05,
    liftDump: 0.45,

    cm0: plan.flyByWire ? 0.03 : 0.07,
    cmAlpha: -1.2,
    cmPitchRate: -28,
    cmElevator: 0.45,
    cmTrim: 0.3,
    cmStall: -0.1,

    clBeta: -0.08,
    clRollRate: -0.5,
    clYawRate: 0.06,
    clAileron: 0.035,
    stallRollBias: 0.01,

    cnBeta: 0.15,
    cnYawRate: -0.35,
    cnRollRate: -0.01,
    cnRudder: 0.04,
    cnAileron: -0.002,

    engine: {
      type: 'jet',
      idleThrust: plan.thrust * engines * 0.05,
      militaryThrust: plan.thrust * engines,
      afterburnerThrust: plan.thrust * engines,
      afterburnerFrom: 1,
      speedLapse: 0.45
    },
    engineCount: engines,
    spoolSeconds: 3.5,
    starterSeconds: 5,
    fuelCapacity: plan.fuelCapacity,
    fuelDump: plan.fuelDump,
    fuelBurnIdle: (plan.thrust * engines) / 1_000_000,
    fuelBurnFull: (plan.thrust * engines) / 92_000,
    fuelUnit: { label: 'kg', perKg: 1 },

    flapLabels: plan.flapLabels,
    flapName: 'Flaps',
    flapSpeeds: plan.flapSpeeds,
    gearSpeed: plan.gearSpeed,
    flapSecondsPerNotch: 2.5,
    retractableGear: true,
    gearSeconds: 6,
    reverseThrust: 0.4,
    flyByWire: plan.flyByWire ? { alphaMargin: 0.07, maxBank: 1.15 } : null,
    autobrake: true,

    maneuverSpeed: plan.stallSpeed * 1.48 * KNOT * 1.58,
    neverExceedSpeed: 350 * KNOT,
    maxTouchdownSink: 5,
    gearTravel: 0.5,
    brakeFriction: 0.5,
    sideFriction: 0.8,
    maxSteerAngle: 0.6,

    contactPoints: [
      wheel(0, -gear.y, gear.noseZ, noseSpring, noseDamper, 'nose'),
      wheel(-gear.mainX, -gear.y, gear.mainZ, mainSpring, mainDamper, 'main'),
      wheel(gear.mainX, -gear.y, gear.mainZ, mainSpring, mainDamper, 'main'),
      skid(-shape.radius * 0.35, shape.tailZ - length * 0.12, mainSpring)
    ],
    hullPoints: [
      hull(0, -shape.radius * 0.6, shape.noseZ + 1, true),
      hull(0, -shape.radius, 0, true),
      hull(-halfSpan, tipY, shape.wing.tipZ + 1),
      hull(halfSpan, tipY, shape.wing.tipZ + 1),
      hull(0, top + shape.finHeight, shape.tailZ - 2),
      hull(0, top, shape.noseZ + length * 0.12),
      // Engine pods hang low enough to scrape in a steep bank near the ground
      ...shape.engines.flatMap(([x, z]) => [
        hull(-x, shape.engineY - shape.engineRadius * 0.85, z + 1, true),
        hull(x, shape.engineY - shape.engineRadius * 0.85, z + 1, true)
      ])
    ],
    restHeight: gear.y - 0.2,
    wingtips: [
      new Vector3(-halfSpan, tipY, shape.wing.tipZ + 1),
      new Vector3(halfSpan, tipY, shape.wing.tipZ + 1)
    ],
    breakup: [
      part(0, 0, length * 0.08, shape.radius),
      part(0, 0, shape.noseZ + length * 0.14, shape.radius),
      part(-halfSpan * 0.5, shape.wing.y, (shape.wing.rootZ + shape.wing.tipZ) / 2 + 2, 0.8),
      part(halfSpan * 0.5, shape.wing.y, (shape.wing.rootZ + shape.wing.tipZ) / 2 + 2, 0.8),
      part(0, top * 0.6, shape.tailZ - length * 0.08, shape.radius * 0.7)
    ],

    rotateSpeed: Math.round(plan.stallSpeed * 1.38),
    climbSpeed: 250,
    approachSpeed: Math.round(plan.stallSpeed * 1.33),
    cruiseSpeed: 115,
    runwayNeeded: plan.mass > 300_000 ? 2800 : plan.mass > 120_000 ? 2600 : 1700,
    gauges: {
      airspeed: {
        min: 0,
        max: 400,
        labelEvery: 50,
        tickEvery: 10,
        flapRange: [plan.stallSpeed, 215],
        normalRange: [Math.round(plan.stallSpeed * 1.45), 320],
        cautionRange: [320, 350]
      },
      climb: 6000,
      power: {
        caption: 'N1 %',
        max: 110,
        labelEvery: 20,
        tickEvery: 5,
        labelScale: 1,
        normalRange: [20, 100],
        redline: 104
      }
    },
    panel: 'glass',
    camera: {
      distance: length * 1.75,
      height: length * 0.42,
      eye: new Vector3(-0.55, shape.radius * 0.38, shape.noseZ + length * 0.07)
    },
    shape
  }
}

const A320 = airliner({
  id: 'a320',
  name: 'Airbus A320',
  label: 'A320',
  role: 'Short-haul airliner',
  description:
    'Fly-by-wire: the computers trim for you, stop the bank at 66°, and refuse to stall. The friendliest jet here.',
  mass: 62_000,
  thrust: 120_000,
  thrustLabel: '2 × 27,000 lbf',
  wingArea: 122.6,
  chord: 4.19,
  inertia: [3_800_000, 4_900_000, 1_280_000],
  flyByWire: true,
  flapLabels: ['0', '1', '2', '3', 'FULL'],
  fuelCapacity: 15_000,
  fuelDump: false,
  gear: { y: 3.7, noseZ: -11.5, mainX: 3.8, mainZ: 1.1 },
  stallSpeed: 104,
  flapSpeeds: [230, 200, 185, 177],
  gearSpeed: 280,
  climb: 2500,
  shape: {
    type: 'airliner',
    radius: 1.98,
    tall: 1,
    noseZ: -16.6,
    tailZ: 21,
    decks: 1,
    wing: {
      halfSpan: 17.9,
      y: -1.1,
      dihedral: 0.09,
      rootZ: -3.6,
      tipZ: 3.9,
      rootChord: 7,
      tipChord: 1.6,
      tip: 'sharklet'
    },
    engines: [[5.75, -5.2]],
    engineRadius: 1.1,
    engineLength: 4.4,
    engineY: -2.2,
    tailSpan: 12.45,
    finHeight: 6,
    paint: '#f4f4f2',
    accent: '#1c3f7a'
  }
})

const B737 = airliner({
  id: 'b737',
  name: 'Boeing 737 MAX 8',
  label: '737 MAX 8',
  role: 'Short-haul airliner',
  description:
    'Cables and hydraulics, no computer between you and the wing. It will stall if you let it, and the engines sit close to the ground.',
  mass: 66_000,
  thrust: 130_000,
  thrustLabel: '2 × 29,000 lbf',
  wingArea: 127,
  chord: 4.1,
  inertia: [4_100_000, 5_300_000, 1_350_000],
  flyByWire: false,
  flapLabels: ['Up', '5', '15', '30', '40'],
  fuelCapacity: 16_000,
  fuelDump: false,
  gear: { y: 3.1, noseZ: -14.2, mainX: 2.86, mainZ: 1.2 },
  stallSpeed: 106,
  flapSpeeds: [250, 200, 175, 162],
  gearSpeed: 270,
  climb: 2500,
  shape: {
    type: 'airliner',
    radius: 1.88,
    tall: 1,
    noseZ: -17.4,
    tailZ: 22.1,
    decks: 1,
    wing: {
      halfSpan: 17.95,
      y: -1,
      dihedral: 0.1,
      rootZ: -4,
      tipZ: 4,
      rootChord: 7.3,
      tipChord: 1.5,
      tip: 'split'
    },
    engines: [[4.85, -6]],
    engineRadius: 1.05,
    engineLength: 4.2,
    engineY: -1.7,
    tailSpan: 14.3,
    finHeight: 6.4,
    paint: '#f4f4f2',
    accent: '#0b6e75'
  }
})

const B787 = airliner({
  id: 'b787',
  name: 'Boeing 787-9 Dreamliner',
  label: '787-9',
  role: 'Long-haul airliner',
  description:
    'A long, flexible wing and two huge engines. Fly-by-wire with protections, and far more momentum than the narrow-bodies.',
  mass: 180_000,
  thrust: 320_000,
  thrustLabel: '2 × 72,000 lbf',
  wingArea: 360.5,
  chord: 6.27,
  inertia: [32_000_000, 44_000_000, 14_000_000],
  flyByWire: true,
  flapLabels: ['Up', '5', '15', '20', '30'],
  fuelCapacity: 60_000,
  fuelDump: true,
  gear: { y: 5, noseZ: -24, mainX: 4.9, mainZ: 1.6 },
  stallSpeed: 103,
  flapSpeeds: [250, 210, 200, 180],
  gearSpeed: 270,
  climb: 2700,
  shape: {
    type: 'airliner',
    radius: 2.95,
    tall: 1,
    noseZ: -27.5,
    tailZ: 35.3,
    decks: 1,
    wing: {
      halfSpan: 30,
      y: -1.6,
      dihedral: 0.12,
      rootZ: -6.5,
      tipZ: 10.5,
      rootChord: 11.5,
      tipChord: 2.2,
      tip: 'raked'
    },
    engines: [[9.7, -9.5]],
    engineRadius: 1.75,
    engineLength: 6.5,
    engineY: -2.6,
    tailSpan: 19,
    finHeight: 9,
    paint: '#f4f4f2',
    accent: '#1d3a8f'
  }
})

const A380 = airliner({
  id: 'a380',
  name: 'Airbus A380',
  label: 'A380',
  role: 'Double-deck airliner',
  description:
    'Four engines and 390 tonnes on an 80-metre wing. Everything takes time: plan your turns and your stop well ahead.',
  mass: 390_000,
  thrust: 311_000,
  thrustLabel: '4 × 70,000 lbf',
  wingArea: 845,
  chord: 11,
  inertia: [130_000_000, 200_000_000, 80_000_000],
  flyByWire: true,
  flapLabels: ['0', '1', '2', '3', 'FULL'],
  fuelCapacity: 150_000,
  fuelDump: true,
  gear: { y: 6.6, noseZ: -28, mainX: 6.2, mainZ: 2 },
  stallSpeed: 100,
  flapSpeeds: [263, 220, 196, 182],
  gearSpeed: 250,
  climb: 2000,
  shape: {
    type: 'airliner',
    radius: 3.57,
    tall: 1.18,
    noseZ: -31,
    tailZ: 41.7,
    decks: 2,
    wing: {
      halfSpan: 39.9,
      y: -2.2,
      dihedral: 0.1,
      rootZ: -9,
      tipZ: 14.8,
      rootChord: 17.5,
      tipChord: 4,
      tip: 'fence'
    },
    engines: [
      [14.9, -9.5],
      [25.7, -1.5]
    ],
    engineRadius: 1.9,
    engineLength: 6,
    engineY: -4.3,
    tailSpan: 30.4,
    finHeight: 13,
    paint: '#f4f4f2',
    accent: '#16406e'
  }
})

/**
 * Concorde: four Olympus engines with reheat, an ogival delta wing, and a nose that droops
 * for takeoff and landing. Its analog fly-by-wire trims the aircraft and limits the angle of
 * attack, but nothing limits the bank.
 */
function concorde(): AircraftSpec {
  const mass = 130_000
  const weight = mass * GRAVITY
  const gear = { y: 5.4, noseZ: -16, mainX: 3.85, mainZ: 8 }
  const noseShare = gear.mainZ / (gear.mainZ - gear.noseZ)
  const spring = (load: number, sag: number) => {
    const stiffness = load / sag
    return [stiffness, 1.1 * Math.sqrt((stiffness * load) / GRAVITY)] as const
  }
  // The nose strut is stiff enough to take the extra load of full braking and the nose
  // coming down after touchdown
  const [noseSpring, noseDamper] = spring(weight * noseShare, 0.08)
  const [mainSpring, mainDamper] = spring((weight * (1 - noseShare)) / 2, 0.22)
  const shape: AirlinerShape = {
    type: 'airliner',
    variant: 'concorde',
    radius: 1.45,
    tall: 1.05,
    noseZ: -32,
    tailZ: 29.7,
    decks: 1,
    wing: {
      halfSpan: 12.8,
      y: -0.9,
      dihedral: -0.02,
      rootZ: -14,
      tipZ: 21.5,
      rootChord: 40.5,
      tipChord: 3.5,
      tip: 'raked'
    },
    // Two engines side by side in each nacelle under the wing
    engines: [
      [2.55, 7],
      [4.15, 7]
    ],
    engineRadius: 0.75,
    engineLength: 19,
    engineY: -2,
    tailSpan: 0,
    finHeight: 8.6,
    paint: '#f6f6f4',
    accent: '#1d3566'
  }
  return {
    id: 'concorde',
    name: 'Concorde',
    label: 'Concorde',
    role: 'Supersonic airliner',
    description:
      'Mach 2 above 55,000 ft on four reheated engines. Droop the nose with F to see the runway, and land fast and nose-high.',
    stats: { power: '4 × 38,050 lbf', topSpeed: 1320, stallSpeed: 135, climb: 5000 },

    mass,
    inertiaPitch: 20_000_000,
    inertiaYaw: 23_000_000,
    inertiaRoll: 2_500_000,
    wingArea: 358,
    wingSpan: 25.6,
    chord: 18,

    // A slender delta: a shallow lift slope, but vortex lift carries it to steep angles
    cl0: 0.02,
    clAlpha: 3,
    flapLift: 0,
    stallAlpha: 0.4,
    negativeStallAlpha: 0.25,
    flapStallShift: 0,
    stallSharpness: 22,
    stallHysteresis: 0.06,
    stallWarningMargin: 0.05,

    cd0: 0.0085,
    gearDrag: 0.012,
    flapDrag: 0.002,
    inducedDrag: 0.217,
    sideDrag: 0.4,
    sideForce: -0.5,
    waveDrag: 0.004,
    speedBrakeDrag: 0,
    liftDump: 0,

    cm0: 0.07,
    cmAlpha: -0.6,
    cmPitchRate: -3,
    cmElevator: 0.25,
    cmTrim: 0.3,
    cmStall: -0.05,

    clBeta: -0.07,
    clRollRate: -0.5,
    clYawRate: 0.05,
    clAileron: 0.035,
    stallRollBias: 0.008,

    cnBeta: 0.3,
    cnYawRate: -0.38,
    cnRollRate: -0.01,
    cnRudder: 0.09,
    cnAileron: -0.002,

    // Ram air in the intakes raises thrust with speed, which lets it cruise without reheat
    engine: {
      type: 'jet',
      idleThrust: 20_000,
      militaryThrust: 557_000,
      afterburnerThrust: 677_000,
      afterburnerFrom: 0.85,
      speedLapse: -0.47
    },
    engineCount: 4,
    spoolSeconds: 3,
    starterSeconds: 5,
    fuelCapacity: 95_000,
    fuelDump: true,
    fuelBurnIdle: 0.5,
    fuelBurnFull: 40,
    fuelUnit: { label: 'kg', perKg: 1 },

    flapLabels: ['Up', '5°', '12.5°'],
    flapName: 'Nose',
    flapSpeeds: [325, 270],
    gearSpeed: 270,
    flapSecondsPerNotch: 3,
    retractableGear: true,
    gearSeconds: 7,
    reverseThrust: 0.3,
    flyByWire: { alphaMargin: 0.05, maxBank: Number.POSITIVE_INFINITY },
    autobrake: true,

    maneuverSpeed: 165,
    neverExceedSpeed: 530 * KNOT,
    maxTouchdownSink: 4.5,
    gearTravel: 0.6,
    brakeFriction: 0.5,
    sideFriction: 0.8,
    maxSteerAngle: 0.6,

    contactPoints: [
      wheel(0, -gear.y, gear.noseZ, noseSpring, noseDamper, 'nose'),
      wheel(-gear.mainX, -gear.y, gear.mainZ, mainSpring, mainDamper, 'main'),
      wheel(gear.mainX, -gear.y, gear.mainZ, mainSpring, mainDamper, 'main'),
      // Retractable tail bumper wheel, for an over-rotation on takeoff
      skid(0.2, 26, mainSpring)
    ],
    hullPoints: [
      hull(0, -0.3, -31.5, true),
      hull(0, -1.45, 0, true),
      hull(-12.8, -1.4, 22.5),
      hull(12.8, -1.4, 22.5),
      hull(0, 1.5 + 8.6, 27.5),
      hull(0, 1.5, -20),
      hull(-3.3, -2.8, 12, true),
      hull(3.3, -2.8, 12, true)
    ],
    restHeight: gear.y - 0.2,
    wingtips: [new Vector3(-12.8, -1.4, 22.5), new Vector3(12.8, -1.4, 22.5)],
    breakup: [
      part(0, 0, 4, 1.45),
      part(0, 0, -22, 1.3),
      part(-6.5, -1, 14, 1.2),
      part(6.5, -1, 14, 1.2),
      part(0, 3, 25, 1)
    ],

    rotateSpeed: 195,
    climbSpeed: 250,
    approachSpeed: 165,
    cruiseSpeed: 150,
    runwayNeeded: 3000,
    gauges: {
      airspeed: {
        min: 0,
        max: 600,
        labelEvery: 100,
        tickEvery: 20,
        flapRange: [135, 270],
        normalRange: [180, 500],
        cautionRange: [500, 530]
      },
      climb: 6000,
      power: {
        caption: 'N2 %',
        max: 110,
        labelEvery: 20,
        tickEvery: 5,
        labelScale: 1,
        normalRange: [20, 100],
        redline: 104
      }
    },
    panel: 'glass',
    camera: { distance: 95, height: 24, eye: new Vector3(-0.5, 0.7, -24.3) },
    shape
  }
}

const CONCORDE = concorde()

/** Values the two fighters share. */
const FIGHTER = {
  flapSecondsPerNotch: 1,
  retractableGear: true,
  gearSeconds: 4,
  reverseThrust: 0.4,
  autobrake: false,
  flapLabels: ['Up', '1', '2', 'Full'],
  flapName: 'Flaps' as const,
  flapSpeeds: [300, 260, 240],
  gearSpeed: 300,
  engineCount: 1,
  spoolSeconds: 2,
  starterSeconds: 4,
  fuelUnit: { label: 'kg', perKg: 1 },
  stallSharpness: 28,
  stallHysteresis: 0.12,
  stallWarningMargin: 0.1,
  flapStallShift: 0.03,
  sideDrag: 0.5,
  sideForce: -0.9,
  waveDrag: 0.03,
  speedBrakeDrag: 0.06,
  liftDump: 0.1,
  maxTouchdownSink: 6,
  gearTravel: 0.45,
  brakeFriction: 0.55,
  sideFriction: 0.8,
  maxSteerAngle: 0.35,
  panel: 'hud' as const,
  climb: 6000
}

const fighterGauges = (maxPower: string): GaugeSpec => ({
  airspeed: {
    min: 0,
    max: 900,
    labelEvery: 100,
    tickEvery: 50,
    flapRange: [130, 300],
    normalRange: [140, 700],
    cautionRange: [700, 800]
  },
  climb: 6000,
  power: {
    caption: maxPower,
    max: 110,
    labelEvery: 20,
    tickEvery: 5,
    labelScale: 1,
    normalRange: [60, 100],
    redline: 104
  }
})

const F16: AircraftSpec = {
  ...FIGHTER,
  id: 'f16',
  name: 'F-16 Fighting Falcon',
  label: 'F-16',
  role: 'Single-engine jet fighter',
  description:
    'Twenty-nine thousand pounds of thrust with the afterburner lit. Fly-by-wire holds it short of the stall. Everything happens fast.',
  stats: { power: '29,000 lbf', topSpeed: 718, stallSpeed: 128, climb: 40_000 },

  mass: 11_000,
  inertiaPitch: 75_674,
  inertiaYaw: 85_552,
  inertiaRoll: 12_875,
  wingArea: 27.87,
  wingSpan: 9.14,
  chord: 3.45,

  cl0: 0.04,
  clAlpha: 3.5,
  flapLift: 0.35,
  stallAlpha: 0.52,
  negativeStallAlpha: 0.35,

  cd0: 0.021,
  gearDrag: 0.03,
  flapDrag: 0.04,
  inducedDrag: 0.141,

  cm0: 0.02,
  cmAlpha: -0.35,
  cmPitchRate: -14,
  cmElevator: 0.2,
  cmTrim: 0.25,
  cmStall: -0.01,

  clBeta: -0.05,
  clRollRate: -0.35,
  clYawRate: 0.03,
  clAileron: 0.045,
  stallRollBias: 0.004,

  cnBeta: 0.15,
  cnYawRate: -0.3,
  cnRollRate: 0,
  cnRudder: 0.03,
  cnAileron: -0.002,

  engine: {
    type: 'jet',
    idleThrust: 4000,
    militaryThrust: 76_000,
    afterburnerThrust: 127_000,
    afterburnerFrom: 0.85,
    speedLapse: 0
  },
  fuelCapacity: 3200,
  fuelDump: false,
  fuelBurnIdle: 0.12,
  fuelBurnFull: 7,
  flyByWire: { alphaMargin: 0.08, maxBank: Number.POSITIVE_INFINITY },

  maneuverSpeed: 170,
  neverExceedSpeed: 800 * KNOT,

  contactPoints: [
    wheel(0, -1.6, -3.5, 160_000, 22_000, 'nose'),
    wheel(-1.2, -1.6, 0.55, 350_000, 45_000, 'main'),
    wheel(1.2, -1.6, 0.55, 350_000, 45_000, 'main'),
    skid(-0.55, 6.9, 300_000)
  ],
  hullPoints: [
    hull(0, -0.35, -7.5, true),
    hull(0, -1, -1, true),
    hull(-4.7, -0.1, 2),
    hull(4.7, -0.1, 2),
    hull(0, 3.4, 6.4),
    hull(0, 1.25, -3.3)
  ],
  restHeight: 1.49,
  wingtips: [new Vector3(-4.7, 0, 2.6), new Vector3(4.7, 0, 2.6)],
  breakup: [
    part(0, 0, 1, 1.1),
    part(0, 0.1, -5.5, 0.6),
    part(-2.9, 0, 1.6, 0.35),
    part(2.9, 0, 1.6, 0.35),
    part(0, 1.2, 6, 0.7)
  ],

  rotateSpeed: 150,
  climbSpeed: 300,
  approachSpeed: 150,
  cruiseSpeed: 180,
  runwayNeeded: 1400,
  gauges: fighterGauges('RPM %'),
  camera: { distance: 27, height: 7.5, eye: new Vector3(0, 1.15, -3.6) },
  shape: { type: 'fighter', variant: 'f16', paint: '#8d959c', accent: '#5d666e' }
}

const F35: AircraftSpec = {
  ...FIGHTER,
  id: 'f35',
  name: 'F-35A Lightning II',
  label: 'F-35A',
  role: 'Stealth strike fighter',
  description:
    'Heavier and wider than the F-16, with the most powerful fighter engine ever built. It flies at angles of attack that would stall anything else here.',
  stats: { power: '43,000 lbf', topSpeed: 700, stallSpeed: 120, climb: 45_000 },

  mass: 20_000,
  inertiaPitch: 160_000,
  inertiaYaw: 190_000,
  inertiaRoll: 40_000,
  wingArea: 42.7,
  wingSpan: 10.7,
  chord: 4.3,

  cl0: 0.05,
  clAlpha: 3.3,
  flapLift: 0.4,
  stallAlpha: 0.65,
  negativeStallAlpha: 0.4,

  cd0: 0.022,
  gearDrag: 0.03,
  flapDrag: 0.04,
  inducedDrag: 0.15,

  cm0: 0.02,
  cmAlpha: -0.35,
  cmPitchRate: -16,
  cmElevator: 0.25,
  cmTrim: 0.3,
  cmStall: -0.01,

  clBeta: -0.05,
  clRollRate: -0.35,
  clYawRate: 0.03,
  clAileron: 0.04,
  stallRollBias: 0.004,

  cnBeta: 0.16,
  cnYawRate: -0.32,
  cnRollRate: 0,
  cnRudder: 0.03,
  cnAileron: -0.002,

  engine: {
    type: 'jet',
    idleThrust: 6000,
    militaryThrust: 125_000,
    afterburnerThrust: 191_000,
    afterburnerFrom: 0.85,
    speedLapse: 0
  },
  fuelCapacity: 8300,
  fuelDump: false,
  fuelBurnIdle: 0.2,
  fuelBurnFull: 9.5,
  flyByWire: { alphaMargin: 0.1, maxBank: Number.POSITIVE_INFINITY },

  maneuverSpeed: 175,
  neverExceedSpeed: 700 * KNOT,

  contactPoints: [
    wheel(0, -1.9, -4, 260_000, 40_000, 'nose'),
    wheel(-2, -1.9, 0.6, 620_000, 85_000, 'main'),
    wheel(2, -1.9, 0.6, 620_000, 85_000, 'main'),
    skid(-0.6, 7, 500_000)
  ],
  hullPoints: [
    hull(0, -0.4, -7.6, true),
    hull(0, -1.1, -1, true),
    hull(-5.3, -0.1, 2.6),
    hull(5.3, -0.1, 2.6),
    hull(0, 2.7, 6.6),
    hull(0, 1.3, -4)
  ],
  restHeight: 1.78,
  wingtips: [new Vector3(-5.3, 0, 3), new Vector3(5.3, 0, 3)],
  breakup: [
    part(0, 0, 1.2, 1.3),
    part(0, 0.1, -5.6, 0.7),
    part(-3.3, 0, 1.8, 0.4),
    part(3.3, 0, 1.8, 0.4),
    part(0, 1.2, 6.2, 0.8)
  ],

  rotateSpeed: 150,
  climbSpeed: 300,
  approachSpeed: 150,
  cruiseSpeed: 180,
  runwayNeeded: 1400,
  gauges: fighterGauges('RPM %'),
  camera: { distance: 28, height: 7.5, eye: new Vector3(0, 1.2, -4.4) },
  shape: { type: 'fighter', variant: 'f35', paint: '#6f767d', accent: '#4c5359' }
}

/** Every aircraft the player can fly, in picker order. */
export const HANGAR: AircraftSpec[] = [CESSNA, A320, B737, B787, A380, CONCORDE, F16, F35]
export const DEFAULT_AIRCRAFT = CESSNA

/** Distance of each engine from the centreline, numbered from the left wingtip. */
export function engineArms(spec: AircraftSpec) {
  if (spec.shape.type !== 'airliner') return [0]
  const right = spec.shape.engines.map(([x]) => x).sort((a, b) => a - b)
  return [...right.map(x => -x).reverse(), ...right]
}
