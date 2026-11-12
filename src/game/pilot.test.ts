import { expect, test } from 'bun:test'
import { HANGAR } from '../sim/aircraft'
import { FlightSim } from '../sim/flight-sim'
import { ISLAND_GROUND } from '../world/island'
import { Pilot } from './pilot'

const STEP = 1 / 60

/** Holds a key for `seconds` without moving the aircraft, and returns the stick pitch. */
function hold(pilot: Pilot, sim: FlightSim, code: string, seconds: number, shift = false) {
  pilot.press(code, false, sim, undefined, shift)
  for (let time = 0; time < seconds; time += STEP) pilot.update(STEP, sim)
  return pilot.controls.pitch
}

test('a tap moves the stick a little, holding builds to full travel, Shift keeps it fine', () => {
  const spec = HANGAR.find(candidate => candidate.id === 'c172')
  if (!spec) throw new Error('Missing c172')
  const sim = new FlightSim(ISLAND_GROUND, spec)
  sim.placeOnGround(0, 0, 0)
  const pilot = new Pilot()
  pilot.resetForGround(sim, true)

  expect(hold(pilot, sim, 'ArrowDown', 0.1)).toBeLessThan(0.05)
  pilot.releaseAll()
  pilot.controls.pitch = 0
  expect(hold(pilot, sim, 'ArrowDown', 2)).toBeCloseTo(1, 2)
  pilot.releaseAll()
  pilot.controls.pitch = 0
  expect(hold(pilot, sim, 'ArrowDown', 2, true)).toBeLessThan(0.4)
})
