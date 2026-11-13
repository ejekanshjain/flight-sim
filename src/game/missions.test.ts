import { expect, test } from 'bun:test'
import { Vector3 } from 'three'
import { HANGAR, KNOT } from '../sim/aircraft'
import { FlightSim } from '../sim/flight-sim'
import { APPROACHES, onCentreline, pathAltitude } from '../world/approaches'
import { AIRPORTS, fromStrip, heightAt, ISLAND_GROUND, RANGE } from '../world/island'
import { Bombs, bombAdvice } from './bombs'
import { landingAdvice } from './coach'
import { MISSIONS, MissionRunner } from './missions'
import { Navigator } from './navigation'
import { Pilot } from './pilot'

const STEP = 1 / 120
const CALM = new Vector3()

test('every gate stands clear of the ground and close enough to the next to fly', () => {
  for (const mission of MISSIONS) {
    const gates = mission.gates ?? []
    gates.forEach((gate, i) => {
      expect(gate.y - gate.radius).toBeGreaterThan(Math.max(heightAt(gate.x, gate.z), 0))
      const next = gates[i + 1]
      if (next) expect(Math.hypot(next.x - gate.x, next.z - gate.z)).toBeLessThan(20_000)
    })
  }
})

test('a scripted pilot passes the takeoff tutorial', () => {
  const mission = MISSIONS.find(candidate => candidate.id === 'takeoff')
  const spec = HANGAR.find(candidate => candidate.id === 'c172')
  if (!mission || !spec || mission.start.kind !== 'runway') throw new Error('Missing mission')
  const sim = new FlightSim(ISLAND_GROUND, spec)
  // Line up as the game does: 150 m in from the start of the main runway
  const runway = AIRPORTS.find(airport => airport.code === 'CBI')?.runways[0]
  if (!runway) throw new Error('Missing runway')
  const start = fromStrip(runway, -runway.length / 2 + 150, 0)
  sim.placeOnGround(start.x, start.z, (runway.heading * Math.PI) / 180)
  const pilot = new Pilot()
  pilot.resetForGround(sim, false)
  const nav = new Navigator()
  const runner = new MissionRunner()
  runner.start(mission, sim)
  let result = null
  const press = (code: string) => {
    pilot.press(code, false, sim)
    pilot.release(code)
  }
  for (let time = 0; time < 200 && !result && !sim.crash; time += STEP) {
    if (time > 0.5 && pilot.controls.engineSwitches[0] === false) press('KeyI')
    if (sim.engineRunning && pilot.controls.parkingBrake) press('KeyP')
    pilot.controls.throttle = sim.engineRunning ? 1 : 0
    // Rotate at 55 knots, then hold a gentle climb
    const knots = sim.indicatedAirspeed / 0.5144
    pilot.controls.pitch = knots > 55 ? Math.max(-1, Math.min(1, (0.12 - sim.pitch) * 4)) : 0
    pilot.controls.roll = Math.max(-1, Math.min(1, -sim.bank * 2))
    sim.step(STEP, pilot.controls, CALM)
    result = runner.update(STEP, { sim, controls: pilot.controls, pilot, nav, parkedAt: null })
  }
  expect(sim.crash).toBeNull()
  expect(result).toEqual({ passed: true })
})

const KEY_CODES: Record<string, string> = {
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  W: 'KeyW',
  S: 'KeyS',
  A: 'KeyA',
  D: 'KeyD',
  E: 'KeyE',
  Q: 'KeyQ',
  Space: 'Space'
}

test('a pilot who only follows the coach passes the landing tutorial', () => {
  const mission = MISSIONS.find(candidate => candidate.id === 'landing')
  const spec = HANGAR.find(candidate => candidate.id === 'c172')
  if (!mission || !spec || mission.start.kind !== 'approach') throw new Error('Missing mission')
  const { start } = mission
  const approach = APPROACHES.find(candidate => candidate.id === start.approach)
  if (!approach) throw new Error('Missing approach')
  // Start as the game does: on the glide path, trimmed, with full flaps
  const sim = new FlightSim(ISLAND_GROUND, spec)
  const { x, z } = onCentreline(approach.end, start.distance)
  const heading = (approach.end.heading * Math.PI) / 180
  sim.placeInAir(
    x,
    pathAltitude(approach.end, approach.glide, start.distance),
    z,
    heading,
    start.speed * KNOT
  )
  const pilot = new Pilot()
  pilot.resetForAir(spec, sim)
  const flapNotch = start.flapNotch ?? 0
  Object.assign(pilot.controls, {
    flapNotch,
    ...sim.settleOnPath(approach.glide, flapNotch, true, CALM)
  })
  const nav = new Navigator()
  nav.select(approach, sim)
  const runner = new MissionRunner()
  runner.start(mission, sim)
  // Every 0.3 s, like a pilot reading the coach: hold the keys it says to hold, tap the others
  const held = new Set<string>()
  let result = null
  for (let time = 0; time < 400 && !result && !sim.crash; time += STEP) {
    if (Math.round(time / STEP) % 36 === 0) {
      const text = landingAdvice(sim, nav, pilot)?.text ?? ''
      const fine = text.includes('hold [Shift] and [↓]')
      const hold = new Set<string>(fine ? ['ArrowDown'] : [])
      for (const [, verb, key] of text.matchAll(/(tap|hold) \[([^\]]+)\]/gi)) {
        const code = KEY_CODES[key]
        if (!code) continue
        if (verb.toLowerCase() === 'hold') hold.add(code)
        else {
          pilot.press(code, false, sim, nav)
          pilot.update(0.15, sim, nav)
          pilot.release(code)
        }
      }
      for (const code of held) if (!hold.has(code)) pilot.release(code)
      for (const code of hold) pilot.press(code, held.has(code), sim, nav, fine)
      if (!fine) pilot.release('ShiftLeft')
      held.clear()
      for (const code of hold) held.add(code)
    }
    nav.update(sim)
    pilot.update(STEP, sim, nav)
    sim.step(STEP, pilot.controls, CALM)
    result = runner.update(STEP, { sim, controls: pilot.controls, pilot, nav, parkedAt: null })
  }
  expect(sim.crash).toBeNull()
  expect(result).toMatchObject({ passed: true })
})

test('passengers forgive a brief steep bank but not a long one', () => {
  const mission = MISSIONS.find(candidate => candidate.id === 'morning-shuttle')
  const spec = HANGAR.find(candidate => candidate.id === 'a320')
  if (!mission || !spec) throw new Error('Missing mission')
  const sim = new FlightSim(ISLAND_GROUND, spec)
  sim.placeInAir(0, 1500, 0, 0, 120)
  const pilot = new Pilot()
  const nav = new Navigator()
  const runner = new MissionRunner()
  runner.start(mission, sim)
  const context = { sim, controls: pilot.controls, pilot, nav, parkedAt: null }
  const fly = (seconds: number, bank: number) => {
    sim.bank = bank
    let result = null
    for (let time = 0; time < seconds && !result; time += STEP)
      result = runner.update(STEP, context)
    return result
  }
  // A second and a half at 50° only warns, and the warning clears once level again
  expect(fly(1.5, 0.87)).toBeNull()
  expect(runner.warning?.text).toContain('Roll level')
  expect(fly(3, 0)).toBeNull()
  expect(runner.warning).toBeNull()
  // Four seconds at 50° frightens them
  expect(fly(5, 0.87)).toMatchObject({ passed: false })
})

const turnTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from))

test('a scripted B-2 crew passes every bombing mission', () => {
  for (const mission of MISSIONS.filter(candidate => candidate.category === 'Bombing')) {
    const spec = HANGAR.find(candidate => candidate.id === mission.aircraft)
    const start = mission.start
    if (!spec || start.kind !== 'air') throw new Error('Missing mission')
    const sim = new FlightSim(ISLAND_GROUND, spec)
    sim.placeInAir(
      start.x,
      start.altitude,
      start.z,
      (start.heading * Math.PI) / 180,
      start.speed * KNOT
    )
    const pilot = new Pilot()
    pilot.resetForAir(spec, sim)
    Object.assign(pilot.controls, sim.settleOnPath(0, 0, false, CALM))
    pilot.engage(true, sim)
    pilot.autothrottle.speed = start.speed * KNOT
    pilot.toggleAutothrottle(sim)
    const nav = new Navigator()
    const runner = new MissionRunner()
    runner.start(mission, sim)
    const bombs = new Bombs()
    bombs.load(mission.bombs ?? 0, mission.targets ?? [], mission.guided)
    const context = { sim, controls: pilot.controls, pilot, nav, parkedAt: null, bombs }
    let result = null
    let pressed = Number.NEGATIVE_INFINITY
    for (let time = 0; time < mission.timeLimit && !result && !sim.crash; time += STEP) {
      // Through the gates first, then point the ground track at the target, as the card says
      const gate = mission.gates?.[runner.gates]
      const target = bombs.targets[bombs.nearestStanding(bombs.aim.x, bombs.aim.z)]
      const aim = gate ?? target
      if (aim) {
        const bearing = Math.atan2(aim.x - sim.position.x, -(aim.z - sim.position.z))
        const off = turnTo(Math.atan2(sim.velocity.x, -sim.velocity.z), bearing)
        pilot.autopilot.heading = gate
          ? bearing
          : sim.heading + Math.max(-0.4, Math.min(0.4, off * 2.5))
      }
      pilot.autopilot.hold = gate ? gate.y : mission.gates ? RANGE.elevation + 250 : start.altitude
      const advice = bombAdvice(bombs, sim) ?? ''
      // One press a second at most, as a player would
      if (/^(On target|Lined up|In the launch zone)/.test(advice) && time - pressed > 1) {
        bombs.release(sim)
        pressed = time
      }
      pilot.update(STEP, sim, nav)
      sim.step(STEP, pilot.controls, CALM)
      bombs.update(STEP, sim, ISLAND_GROUND)
      result = runner.update(STEP, context)
    }
    expect(sim.crash).toBeNull()
    expect(result).toMatchObject({ passed: true })
  }
})
