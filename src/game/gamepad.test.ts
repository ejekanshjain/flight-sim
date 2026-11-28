import { expect, test } from 'bun:test'
import { HANGAR } from '../sim/aircraft'
import { FlightSim, type Ground } from '../sim/flight-sim'
import { Controller } from './gamepad'
import { Look } from './look'
import { Pilot } from './pilot'

const FLAT: Ground = { heightAt: () => 0.01, surfaceAt: () => 'runway' }

test('a drone-style controller steers, and each button works its key once per press', () => {
  const spec = HANGAR.find(candidate => candidate.retractableGear) ?? HANGAR[0]
  const sim = new FlightSim(FLAT, spec)
  sim.placeInAir(0, 1000, 0, 0, spec.cruiseSpeed)
  const pilot = new Pilot()
  pilot.resetForAir(spec, sim)
  const used: string[] = []
  const host = {
    pilot,
    look: new Look(),
    sim,
    getState: () => ({ status: 'flying', camera: 'chase' as const }),
    pressKey: (code: string) => {
      used.push(code)
      return pilot.press(code, false, sim)
    },
    releaseKey: (code: string) => pilot.release(code),
    toggleEngines: () => used.push('engines')
  }
  // Left stick full up and a little right, right stick full right, the rest resting
  const pad = {
    connected: true,
    mapping: 'standard',
    axes: [0.5, -1, 1, 0.05],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 }))
  }
  let pads: (typeof pad)[] = [pad]
  Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true })
  const controller = new Controller()

  expect(controller.update(0.02, host)).toBe(true)
  expect(pilot.analog).toMatchObject({ lever: 1, roll: 1, pitch: 0 })
  // Softened near the middle: half travel gives less than half
  expect(pilot.analog.yaw).toBeGreaterThan(0)
  expect(pilot.analog.yaw).toBeLessThan(0.5)

  // Square lowers the gear once, however long it is held; L3 starts the engines
  const gear = pilot.controls.gearDown
  pad.buttons[2].pressed = true
  pad.buttons[10].pressed = true
  controller.update(0.02, host)
  controller.update(0.02, host)
  expect(pilot.controls.gearDown).toBe(!gear)
  expect(used).toEqual(['KeyG', 'engines'])

  // Unplugged, the controls centre
  pads = []
  expect(controller.update(0.02, host)).toBe(false)
  expect(pilot.analog).toEqual({ pitch: 0, roll: 0, yaw: 0, lever: 0 })
})
