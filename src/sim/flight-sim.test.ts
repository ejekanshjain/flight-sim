import { describe, expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { Pilot } from '../game/pilot'
import { type AircraftSpec, HANGAR, KNOT } from './aircraft'
import { type Controls, FlightSim, type Ground } from './flight-sim'

const STEP = 1 / 120
const CALM = new Vector3()
const FLAT: Ground = { heightAt: () => 0.01, surfaceAt: () => 'runway' }
const find = (id: string) => HANGAR.find(spec => spec.id === id) as AircraftSpec
const CESSNA = find('c172')
const A320 = find('a320')
const F16 = find('f16')
/** Big jets with airliner instruments: the airliners and the bomber. */
const airliner = (spec: AircraftSpec) => spec.panel === 'glass'

function controls(overrides: Partial<Controls> = {}): Controls {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    brake: 0,
    brakeLeft: 0,
    brakeRight: 0,
    parkingBrake: false,
    battery: true,
    fuelPumps: true,
    flapNotch: 0,
    gearDown: true,
    speedBrake: false,
    reverse: false,
    trim: 0,
    fuelDump: false,
    engineSwitches: [true, true, true, true],
    ...overrides
  }
}

/** Aircraft parked on the runway with its engines already running. */
function parked(spec: AircraftSpec) {
  const sim = new FlightSim(FLAT, spec)
  sim.placeOnGround(0, 0, 0)
  sim.startAllEngines()
  return sim
}

function flying(spec: AircraftSpec, altitude: number, speed = spec.cruiseSpeed) {
  const sim = new FlightSim(FLAT, spec)
  sim.placeInAir(0, altitude, 0, 0, speed)
  return sim
}

/** Runs the sim for `seconds`, letting `fly` adjust the controls before each step. */
function run(sim: FlightSim, c: Controls, seconds: number, fly?: (time: number) => void) {
  for (let time = 0; time < seconds && !sim.crash; time += STEP) {
    fly?.(time)
    sim.step(STEP, c, CALM)
  }
}

const clamp = (value: number) => Math.min(1, Math.max(-1, value))

/** Holds a pitch attitude and wings level, like a pilot would. */
function holdAttitude(sim: FlightSim, c: Controls, pitch: number) {
  c.pitch = clamp((pitch - sim.pitch) * 6 - sim.angularVelocity.x * 1.5)
  c.roll = clamp(-sim.bank * 3)
}

/** Holds an altitude in metres by adjusting the pitch attitude. */
function holdAltitude(sim: FlightSim, c: Controls, altitude: number, maxPitch = 0.3) {
  const climb = clamp((altitude - sim.position.y) * 0.02 - sim.verticalSpeed * 0.05)
  holdAttitude(sim, c, climb * maxPitch)
}

describe.each(HANGAR)('$name', spec => {
  test('starts cold, then starts each engine in turn', () => {
    const sim = new FlightSim(FLAT, spec)
    sim.placeOnGround(0, 0, 0)
    const c = controls({ parkingBrake: true, engineSwitches: [false, false, false, false] })
    run(sim, c, 2)
    expect(sim.enginesRunning).toBe(0)
    c.engineSwitches.fill(true)
    run(sim, c, spec.starterSeconds * spec.engineCount + 1)
    expect(sim.enginesRunning).toBe(spec.engineCount)
    expect(sim.groundSpeed).toBeLessThan(0.3)
    expect(Math.abs(sim.pitch)).toBeLessThan(0.05)
    expect(Math.abs(sim.position.y - 0.01 - spec.restHeight)).toBeLessThan(0.08)
  })

  test('takes off and climbs', () => {
    const sim = parked(spec)
    const c = controls({ throttle: 1, flapNotch: airliner(spec) ? 2 : 0 })
    let liftoffDistance = 0
    run(sim, c, 60, () => {
      if (sim.indicatedAirspeed > spec.rotateSpeed * KNOT) holdAttitude(sim, c, 0.15)
      // Counter the propeller's left pull with rudder
      c.yaw = clamp(-Math.sin(sim.heading) * 4)
      if (sim.onGround) liftoffDistance = -sim.position.z
      else c.gearDown = false
      // Stay under the flap and airframe speed limits
      if (airliner(spec) && sim.indicatedAirspeed > spec.climbSpeed * KNOT) c.throttle = 0.5
    })
    expect(sim.crash).toBeNull()
    expect(liftoffDistance).toBeGreaterThan(100)
    expect(liftoffDistance).toBeLessThan(airliner(spec) ? 2200 : 1000)
    expect(sim.altitudeAgl).toBeGreaterThan(50)
  })

  test('flies hands-off without diverging', () => {
    const sim = flying(spec, 1500)
    run(sim, controls({ throttle: airliner(spec) ? 0.35 : 0.5, gearDown: false }), 60)
    expect(sim.crash).toBeNull()
    expect(Math.abs(sim.bank)).toBeLessThan(0.3)
    expect(sim.stall).toBeLessThan(0.1)
  })

  test('the autopilot holds heading and altitude, and the autothrottle holds speed', () => {
    const sim = flying(spec, 1500)
    const pilot = new Pilot()
    pilot.resetForAir(spec)
    const fly = (seconds: number) => {
      for (let time = 0; time < seconds && !sim.crash; time += STEP) {
        pilot.update(STEP, sim)
        sim.step(STEP, pilot.controls, CALM)
      }
    }
    fly(1)
    pilot.press('KeyZ', false, sim)
    pilot.press('KeyX', false, sim)
    pilot.releaseAll()
    const altitude = pilot.autopilot.hold
    fly(90)
    expect(sim.crash).toBeNull()
    expect(Math.abs(sim.position.y - altitude)).toBeLessThan(40)
    expect(Math.abs(Math.sin(sim.heading))).toBeLessThan(0.06)
    expect(Math.abs(sim.indicatedAirspeed / pilot.autothrottle.speed - 1)).toBeLessThan(0.08)
  })

  if (spec.flyByWire) {
    test('fly-by-wire keeps the wing flying with the stick held fully back', () => {
      const sim = flying(spec, 3000)
      const c = controls({ throttle: 0.4, gearDown: false })
      let deepest = 0
      run(sim, c, 20, () => {
        c.pitch = 1
        deepest = Math.max(deepest, sim.stall)
      })
      expect(sim.crash).toBeNull()
      expect(deepest).toBeLessThan(0.5)
    })
  } else {
    test('a stick-back stall drops a wing, costs height, and ends with the standard recovery', () => {
      const sim = flying(spec, 3000)
      const c = controls({ throttle: 0.3, gearDown: false })
      let warned = false
      let top = 0
      let deepest = 0
      let upset = 0
      // Pull all the way back and keep holding
      run(sim, c, 20, () => {
        c.pitch = 1
        warned ||= sim.stallWarning && sim.stall < 0.5
        top = Math.max(top, sim.position.y)
        deepest = Math.max(deepest, sim.stall)
        upset = Math.max(upset, Math.abs(sim.bank))
      })
      expect(warned).toBe(true)
      expect(deepest).toBeGreaterThan(0.8)
      // The wing drops: the aircraft rolls well past a normal turn
      expect(upset).toBeGreaterThan(0.6)

      // Recovery: throttle closed, stick forward, rudder against the turn
      c.throttle = 0
      let recovered = false
      run(sim, c, 12, () => {
        c.pitch = recovered ? 0 : -0.6
        c.yaw = recovered ? 0 : -Math.sign(sim.turnRate)
        recovered ||= sim.stall < 0.05
      })
      expect(recovered).toBe(true)
      expect(top - sim.position.y).toBeGreaterThan(60)
    })
  }
})

test('the Cessna stalls near 52 kt in level flight and tops out near its listed speed', () => {
  const sim = flying(CESSNA, 1500)
  const c = controls({ gearDown: false })
  let stallSpeed = 0
  // Hold altitude with the engine at idle until the wing gives up
  run(sim, c, 60, () => {
    if (stallSpeed > 0) return
    holdAltitude(sim, c, 1500, 0.4)
    if (sim.stall > 0.5) stallSpeed = sim.indicatedAirspeed
  })
  expect(stallSpeed / KNOT).toBeGreaterThan(49)
  expect(stallSpeed / KNOT).toBeLessThan(55)

  const fast = flying(CESSNA, 800)
  const full = controls({ throttle: 1 })
  run(fast, full, 150, () => holdAltitude(fast, full, 800))
  expect(Math.abs(fast.indicatedAirspeed / KNOT / CESSNA.stats.topSpeed - 1)).toBeLessThan(0.05)
})

test('brakes stop a Cessna landing roll within 350 m', () => {
  const sim = parked(CESSNA)
  sim.velocity.set(0, 0, -30)
  run(sim, controls({ brake: 1 }), 30)
  expect(sim.crash).toBeNull()
  expect(sim.groundSpeed).toBeLessThan(0.3)
  expect(-sim.position.z).toBeLessThan(350)
})

test('an airliner stops by itself after touchdown: spoilers up, brakes on', () => {
  const sim = parked(A320)
  sim.velocity.set(0, 0, -70)
  const c = controls()
  run(sim, c, 3)
  expect(sim.rollout).toBe(true)
  expect(sim.speedBrakePosition).toBeGreaterThan(0.9)
  run(sim, c, 40)
  expect(sim.crash).toBeNull()
  expect(sim.groundSpeed).toBeLessThan(2.5)
  expect(-sim.position.z).toBeLessThan(1500)
})

test('reverse thrust backs the aircraft up on the ground and slows it in the air', () => {
  const sim = parked(CESSNA)
  run(sim, controls({ throttle: 0.8, reverse: true }), 8)
  expect(sim.crash).toBeNull()
  // The nose points along -Z, so moving backward increases Z
  expect(sim.position.z).toBeGreaterThan(5)

  const speedAfter = (reverse: boolean) => {
    const airborne = flying(A320, 2000)
    const c = controls({ throttle: 0.8, reverse, gearDown: false })
    run(airborne, c, 10, () => holdAltitude(airborne, c, 2000))
    expect(airborne.reversePosition).toBe(reverse ? 1 : 0)
    return airborne.indicatedAirspeed
  }
  expect(speedAfter(false) - speedAfter(true)).toBeGreaterThan(15)
})

test('each engine switches on and off by itself, and a dead engine yaws the nose toward it', () => {
  const sim = flying(A320, 2000)
  const c = controls({ throttle: 1, gearDown: false, engineSwitches: [false, true] })
  run(sim, c, 6, () => holdAltitude(sim, c, 2000))
  expect(sim.engines.map(engine => engine.running)).toEqual([false, true])
  // Engine 1 is on the left, so the live right engine swings the nose left
  expect(Math.sin(sim.heading)).toBeLessThan(-0.02)

  c.engineSwitches[0] = true
  run(sim, c, A320.starterSeconds + 1)
  expect(sim.enginesRunning).toBe(2)
})

test('engines start only with the battery and the fuel pumps on', () => {
  const sim = new FlightSim(FLAT, A320)
  sim.placeOnGround(0, 0, 0)
  const c = controls({ parkingBrake: true, battery: false, fuelPumps: false })
  run(sim, c, A320.starterSeconds * 3)
  expect(sim.enginesRunning).toBe(0)
  c.battery = true
  run(sim, c, A320.starterSeconds * 3)
  expect(sim.enginesRunning).toBe(0)
  c.fuelPumps = true
  run(sim, c, A320.starterSeconds * 3)
  expect(sim.enginesRunning).toBe(2)
  // Running engines keep the power on without the battery
  c.battery = false
  run(sim, c, 1)
  expect(sim.powered).toBe(true)
})

test('full flaps at cruise speed jam the flaps where they are', () => {
  const sim = flying(A320, 2000)
  const c = controls({ throttle: 0.7, gearDown: false, flapNotch: 4 })
  run(sim, c, 15, () => holdAltitude(sim, c, 2000))
  expect(sim.flapsJammed).toBe(true)
  const stuck = sim.flapPosition
  c.flapNotch = 0
  run(sim, c, 5, () => holdAltitude(sim, c, 2000))
  expect(sim.flapPosition).toBe(stuck)
})

test('Concorde climbs on full reheat and passes Mach 1.6 within six minutes', () => {
  const concorde = find('concorde')
  const sim = flying(concorde, 3000, 150)
  const c = controls({ throttle: 1, gearDown: false })
  let mach = 0
  run(sim, c, 360, () => {
    // Climb holding about 420 kt, then level off near 55,000 ft
    const fast = clamp((sim.indicatedAirspeed / KNOT - 420) * 0.02)
    const climb = sim.position.y < 16_500 ? 0.08 + fast * 0.3 : (17_000 - sim.position.y) * 0.0002
    holdAttitude(sim, c, climb)
    mach = Math.max(mach, sim.mach)
  })
  expect(sim.crash).toBeNull()
  expect(mach).toBeGreaterThan(1.6)
  expect(sim.indicatedAirspeed).toBeLessThan(concorde.neverExceedSpeed)
})

test('the airbrake slows a jet down', () => {
  const speedAfter = (speedBrake: boolean) => {
    const sim = flying(F16, 2000, 200)
    const c = controls({ throttle: 0.3, gearDown: false, speedBrake })
    run(sim, c, 12, () => holdAltitude(sim, c, 2000))
    return sim.indicatedAirspeed
  }
  expect(speedAfter(false) - speedAfter(true)).toBeGreaterThan(15)
})

test('diving far past the red line breaks the aircraft up', () => {
  const sim = flying(CESSNA, 3000, 60)
  const c = controls({ throttle: 1 })
  run(sim, c, 40, () => holdAttitude(sim, c, -1))
  expect(sim.crash).toBe('overspeed')
})

test.each([CESSNA, A320])('$name lands from a flared approach and stops', spec => {
  const approach = spec.approachSpeed * KNOT
  const sim = flying(spec, 60, approach)
  sim.gearPosition = 1
  sim.flapPosition = 1
  const c = controls({ throttle: 0.3, flapNotch: spec.flapLabels.length - 1 })
  let touchdownSink = -1
  run(sim, c, 120, () => {
    const height = sim.altitudeAgl - spec.restHeight
    // Hold the approach speed with pitch, then close the throttle and raise the nose
    const flare = spec.wingSpan * 0.6
    if (height > flare) {
      holdAttitude(sim, c, clamp((sim.indicatedAirspeed - approach) * 0.04) * 0.2 - 0.03)
    } else holdAttitude(sim, c, 0.02 + (1 - height / flare) * 0.11)
    if (height < flare * 1.3) c.throttle = 0
    if (sim.onGround) {
      c.brake = 1
      if (touchdownSink < 0) touchdownSink = -sim.verticalSpeed
    }
  })
  expect(sim.crash).toBeNull()
  expect(touchdownSink).toBeGreaterThanOrEqual(0)
  expect(touchdownSink).toBeLessThan(3)
  expect(sim.groundSpeed).toBeLessThan(2.5)
})

test('a hard touchdown and a gear-up landing both end the flight', () => {
  // Dropped flat from just above the runway, so the main wheels take the blow
  const hard = flying(CESSNA, 3, 35)
  hard.velocity.y = -8
  run(hard, controls(), 5)
  expect(hard.crash).toBe('hard-landing')

  const gearUp = flying(F16, 3.2, 80)
  gearUp.velocity.y = -1
  run(gearUp, controls({ gearDown: false }), 10)
  expect(gearUp.crash).toBe('gear-up')
})

test('fuel has weight, and dumping lightens an A380 down to landing fuel', () => {
  const sim = flying(find('a380'), 6000, 250 * KNOT)
  // Placed in the air with landing fuel, so at the listed mass
  expect(sim.mass).toBeCloseTo(sim.spec.mass)
  sim.fuel = sim.spec.fuelCapacity
  const heavy = sim.mass
  expect(heavy - sim.spec.mass).toBeCloseTo(sim.spec.fuelCapacity * 0.7)
  const c = controls({ throttle: 0.5, fuelDump: true })
  run(sim, c, 300, () => holdAltitude(sim, c, 6000))
  expect(sim.crash).toBeNull()
  expect(sim.fuel).toBeLessThan(sim.spec.fuelCapacity * 0.2 + 1)
  expect(sim.fuel).toBeGreaterThan(sim.spec.fuelCapacity * 0.15)
  expect(sim.mass).toBeLessThan(heavy - sim.spec.fuelCapacity * 0.55)
})

test('an A320 cannot dump fuel', () => {
  const sim = flying(A320, 3000)
  const before = sim.fuel
  const c = controls({ throttle: 0.5, fuelDump: true })
  run(sim, c, 30, () => holdAltitude(sim, c, 3000))
  expect(sim.dumping).toBe(false)
  // Only what the engines burn
  expect(before - sim.fuel).toBeLessThan(150)
})
