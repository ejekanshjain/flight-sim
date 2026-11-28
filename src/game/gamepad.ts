import type { FlightSim } from '../sim/flight-sim'
import type { Look, LookView } from './look'
import type { Pilot } from './pilot'

/** What the controller reads and works in the game. */
export type ControllerHost = {
  readonly pilot: Pilot
  readonly look: Look
  readonly sim: FlightSim
  getState(): { status: string; camera: LookView }
  pressKey(code: string): boolean
  releaseKey(code: string): void
  toggleEngines(): void
}

// Buttons in the browser's standard layout, as a DualSense reports them, and the key each
// stands in for
const BUTTON_KEYS: Record<number, string> = {
  0: 'Enter', // Cross: fire, drop a bomb, or start and resume from the menus
  1: 'Space', // Circle: wheel brakes, or flares in a fight
  2: 'KeyG', // Square: landing gear
  3: 'KeyC', // Triangle: chase or cockpit view
  4: 'KeyV', // L1: flaps up a notch
  5: 'KeyF', // R1: flaps down a notch
  6: 'KeyQ', // L2: trim nose down
  7: 'KeyE', // R2: trim nose up
  8: 'Tab', // Create: bombsight
  9: 'Escape', // Options: pause and resume
  11: 'KeyZ', // R3: autopilot
  17: 'KeyM' // Touchpad: map
}
// L3 starts the engines, switching on the battery and fuel pumps first
const ENGINES_BUTTON = 10
const DPAD = { up: 12, down: 13, left: 14, right: 15 }
// Stick travel ignored around the middle, where a resting stick drifts
const DEAD_ZONE = 0.1
// Radians per second the D-pad turns the view
const LOOK_RATE = 2.2
// Seconds between rumble updates, each played a little longer so they run together
const RUMBLE_STEP = 0.1

/** Stick travel past the dead zone, softened near the middle for small corrections. */
export function shape(value: number) {
  const travel = (Math.abs(value) - DEAD_ZONE) / (1 - DEAD_ZONE)
  if (travel <= 0) return 0
  return Math.sign(value) * (0.5 * travel + 0.5 * travel ** 3)
}

/**
 * Reads the first connected gamepad every frame, laid out like a drone controller. The left
 * stick works the throttle (or collective) and rudder, the right stick pitch and roll, and
 * the buttons press the keys in `BUTTON_KEYS`. The D-pad turns the view while held.
 */
export class Controller {
  private readonly pressed = new Set<number>()
  /** True while a controller is in use, so letting go of it can centre the controls. */
  private active = false
  private lookHeld = false
  private wasOnGround = true
  private wasCrashed = false
  private lastSink = 0
  private rumbleClock = 0

  /** Reads the controller and moves the controls. Returns true while one is connected. */
  update(dt: number, host: ControllerHost) {
    const pad = navigator.getGamepads?.().find(candidate => candidate?.connected) ?? null
    const { analog } = host.pilot
    // Browsers that cannot lay a controller out the standard way report it unmapped
    if (pad?.mapping !== 'standard') {
      if (this.active) this.releaseAll(host)
      this.active = false
      return false
    }
    this.active = true
    const [leftX = 0, leftY = 0, rightX = 0, rightY = 0] = pad.axes
    analog.lever = -shape(leftY)
    analog.yaw = shape(leftX)
    analog.roll = shape(rightX)
    analog.pitch = shape(rightY)

    pad.buttons.forEach((button, index) => {
      const was = this.pressed.has(index)
      if (button.pressed === was) return
      if (button.pressed) this.pressed.add(index)
      else this.pressed.delete(index)
      if (index === ENGINES_BUTTON) {
        if (button.pressed) host.toggleEngines()
        return
      }
      const code = BUTTON_KEYS[index]
      if (!code) return
      if (button.pressed) host.pressKey(code)
      else host.releaseKey(code)
    })
    this.lookAround(dt, host)
    this.rumble(dt, pad, host)
    return true
  }

  private releaseAll(host: ControllerHost) {
    for (const index of this.pressed) {
      const code = BUTTON_KEYS[index]
      if (code) host.releaseKey(code)
    }
    this.pressed.clear()
    Object.assign(host.pilot.analog, { pitch: 0, roll: 0, yaw: 0, lever: 0 })
  }

  /** Turns the view while the D-pad is held, and swings it back ahead once let go. */
  private lookAround(dt: number, host: ControllerHost) {
    const held = (index: number) => (this.pressed.has(index) ? 1 : 0)
    const yaw = held(DPAD.left) - held(DPAD.right)
    const pitch = held(DPAD.up) - held(DPAD.down)
    const view = host.getState().camera
    if (yaw !== 0 || pitch !== 0) host.look.turn(yaw * LOOK_RATE * dt, pitch * LOOK_RATE * dt, view)
    else if (this.lookHeld) host.look.lookAhead()
    this.lookHeld = yaw !== 0 || pitch !== 0
  }

  /**
   * Shakes the controller: a buzz near the stall, a hum with the afterburner lit, a bump on
   * touchdown that grows with the sink rate, and a hard jolt in a crash.
   */
  private rumble(dt: number, pad: Gamepad, host: ControllerHost) {
    const { sim } = host
    const actuator = pad.vibrationActuator
    const flying = host.getState().status === 'flying'
    const crashed = sim.crash !== null
    // Browsers without rumble have no actuator, or turn the effect down
    const play = (duration: number, strong: number, weak: number) =>
      actuator
        ?.playEffect('dual-rumble', {
          duration,
          strongMagnitude: Math.min(1, strong),
          weakMagnitude: Math.min(1, weak)
        })
        .catch(() => {})
    if (crashed && !this.wasCrashed) play(700, 1, 1)
    else if (flying && sim.onGround && !this.wasOnGround && this.lastSink > 0.5) {
      play(160, this.lastSink / 4, this.lastSink / 6)
    } else if (flying) {
      this.rumbleClock -= dt
      if (this.rumbleClock <= 0) {
        this.rumbleClock = RUMBLE_STEP
        if (sim.stallWarning) play(RUMBLE_STEP * 1300, 0.25, 0.6)
        else if (sim.afterburner) play(RUMBLE_STEP * 1300, 0, 0.2)
      }
    }
    this.wasCrashed = crashed
    this.wasOnGround = sim.onGround
    this.lastSink = -sim.verticalSpeed
  }
}
