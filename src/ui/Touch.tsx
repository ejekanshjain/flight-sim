import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { game, useGame } from '../game/game'
import { shape } from '../game/gamepad'
import type { FlightSim } from '../sim/flight-sim'
import { useTelemetry } from './telemetry'

/** Touch screens: phones and tablets. */
export const TOUCH_QUERY = '(pointer: coarse)'
/** A phone held sideways, too short for the full instrument panel. */
export const PHONE_QUERY = '(pointer: coarse) and (max-height: 520px)'

/** True while the media query matches, following changes such as turning the device. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

// Pixels from the middle of a stick to the edge of its travel
const TRAVEL = 52

/**
 * A thumb stick: drag the knob, and it springs back to the middle when let go. Reports
 * where it points, -1 to 1 across (right is positive) and down (back is positive).
 */
function Stick(props: { label: string; onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const finger = useRef<number | null>(null)
  const { onMove } = props
  const move = (event: React.PointerEvent) => {
    if (finger.current !== event.pointerId || !base.current || !knob.current) return
    const box = base.current.getBoundingClientRect()
    let dx = event.clientX - (box.left + box.width / 2)
    let dy = event.clientY - (box.top + box.height / 2)
    const reach = Math.hypot(dx, dy)
    if (reach > TRAVEL) {
      dx *= TRAVEL / reach
      dy *= TRAVEL / reach
    }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`
    onMove(dx / TRAVEL, dy / TRAVEL)
  }
  const release = (event: React.PointerEvent) => {
    if (finger.current !== event.pointerId) return
    finger.current = null
    if (knob.current) knob.current.style.transform = ''
    onMove(0, 0)
  }
  // Centred again if the controls disappear mid-drag, as when the flight ends
  useEffect(() => () => onMove(0, 0), [onMove])
  return (
    <div
      ref={base}
      role="presentation"
      aria-label={props.label}
      className="bg-ink/35 ring-marking/40 pointer-events-auto relative flex size-36 touch-none items-center justify-center rounded-full ring-2 backdrop-blur-sm"
      onPointerDown={event => {
        finger.current = event.pointerId
        event.currentTarget.setPointerCapture(event.pointerId)
        move(event)
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div ref={knob} className="bg-marking/85 size-16 rounded-full shadow-lg" />
      <span className="text-marking/70 absolute -top-5 text-xs whitespace-nowrap">
        {props.label}
      </span>
    </div>
  )
}

/**
 * A button that stands in for a key: held while the finger is down, so brakes and trim
 * work while it stays pressed. `onPress` replaces the key for actions with no single key.
 */
function TouchButton(props: {
  code?: string
  onPress?: () => void
  on?: boolean
  children: ReactNode
}) {
  const down = useRef(false)
  const release = () => {
    if (!down.current) return
    down.current = false
    if (props.code) game.releaseKey(props.code)
  }
  return (
    <button
      type="button"
      data-on={props.on}
      className="bg-ink/60 text-marking ring-marking/40 data-[on=true]:bg-amber data-[on=true]:text-ink pointer-events-auto min-h-10 min-w-16 touch-none rounded-md px-2 text-xs font-bold ring-1 backdrop-blur-sm active:brightness-150"
      onPointerDown={event => {
        event.preventDefault()
        down.current = true
        if (props.onPress) props.onPress()
        else if (props.code) game.pressKey(props.code)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      {props.children}
    </button>
  )
}

/** What the touch buttons depend on, refreshed as the flight changes. */
type Situation = {
  onGround: boolean
  running: boolean
  gearDown: boolean
  parked: boolean
  autopilot: boolean
  fighting: boolean
  firing: boolean
}

function situation(sim: FlightSim): Situation {
  const c = game.pilot.controls
  return {
    onGround: sim.onGround,
    running: sim.enginesRunning === sim.spec.engineCount,
    gearDown: c.gearDown,
    parked: c.parkingBrake,
    autopilot: game.pilot.autopilot.on,
    fighting: game.combat.active && !sim.onGround,
    firing: game.combat.active || game.bombs.missiles > 0 || game.getState().bombsight
  }
}

/** Throttle setting beside the left stick, as the phone hides the throttle lever. */
function ThrottleBar() {
  const fill = useRef<HTMLDivElement>(null)
  useTelemetry(
    useCallback((_sim: FlightSim, controls) => {
      if (fill.current) fill.current.style.height = `${Math.round(controls.throttle * 100)}%`
    }, [])
  )
  return (
    <div className="bg-ink/50 ring-marking/40 relative h-28 w-2.5 self-end overflow-hidden rounded-full ring-1">
      <div ref={fill} className="bg-marking absolute inset-x-0 bottom-0" />
    </div>
  )
}

/** Switches the browser to full screen and back, where the browser allows it. */
export function FullscreenButton(props: { className: string }) {
  const [full, setFull] = useState(() => document.fullscreenElement !== null)
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  // iPhones have no full screen for web pages
  if (!document.fullscreenEnabled) return null
  const toggle = async () => {
    try {
      if (full) await document.exitFullscreen()
      else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        // Android can hold the screen sideways once the page fills it; others refuse
        await (screen.orientation as { lock?: (to: string) => Promise<void> }).lock?.('landscape')
      }
    } catch {
      // The browser turned it down, and the page stays as it is
    }
  }
  return (
    <button type="button" className={props.className} onClick={toggle}>
      {full ? 'Exit Full Screen' : 'Full Screen'}
    </button>
  )
}

const SYSTEM =
  'bg-ink/60 text-marking ring-marking/40 pointer-events-auto rounded-md px-3 py-1 text-xs font-bold ring-1 backdrop-blur-sm data-[on=true]:bg-amber data-[on=true]:text-ink'

/** Pause, map, panel, and full screen, in a row under the readouts. */
export function TouchMenu() {
  const instruments = useGame(state => state.instruments)
  const phone = useMedia(PHONE_QUERY)
  return (
    <div className="flex gap-2">
      <button type="button" className={SYSTEM} onClick={game.pause}>
        Pause
      </button>
      <button type="button" className={SYSTEM} onClick={game.toggleMap}>
        Map
      </button>
      {phone && (
        <button
          type="button"
          data-on={instruments}
          className={SYSTEM}
          onClick={game.toggleInstruments}
        >
          Panel
        </button>
      )}
      <FullscreenButton className={SYSTEM} />
    </div>
  )
}

/**
 * Two thumb sticks laid out like a drone controller, with buttons for what the keys do.
 * The left stick works the throttle (the collective in the helicopter) and the rudder, and
 * the right stick pitch and roll. `bottom` lifts them clear of the instrument panel, and
 * `buttons` false leaves only the sticks.
 */
export function TouchControls(props: { bottom: number; buttons: boolean }) {
  const spec = useGame(state => state.flown)
  const [now, setNow] = useState<Situation>(() => situation(game.sim))
  useTelemetry(
    useCallback((sim: FlightSim) => {
      const next = situation(sim)
      setNow(last =>
        (Object.keys(next) as (keyof Situation)[]).some(key => next[key] !== last[key])
          ? next
          : last
      )
    }, [])
  )
  const left = useCallback((x: number, y: number) => {
    Object.assign(game.pilot.analog, { lever: -shape(y), yaw: shape(x) })
  }, [])
  const right = useCallback((x: number, y: number) => {
    Object.assign(game.pilot.analog, { pitch: shape(y), roll: shape(x) })
  }, [])
  const flaps = !spec.autoFlaps && spec.flapLabels.length > 1
  return (
    <div
      className="absolute inset-x-0 flex items-end justify-between px-6 pb-4"
      style={{ bottom: props.bottom }}
    >
      <div className="flex items-end gap-3">
        <ThrottleBar />
        <Stick label={spec.rotor ? 'Climb · Turn' : 'Throttle · Rudder'} onMove={left} />
        <div hidden={!props.buttons} className="grid grid-cols-2 gap-2">
          {!now.running && <TouchButton onPress={game.toggleEngines}>Start</TouchButton>}
          {spec.retractableGear && (
            <TouchButton code="KeyG" on={now.gearDown}>
              Gear
            </TouchButton>
          )}
          {flaps && <TouchButton code="KeyV">Flaps Up</TouchButton>}
          {flaps && <TouchButton code="KeyF">Flaps Down</TouchButton>}
          {now.onGround && <TouchButton code="Space">Brakes</TouchButton>}
          {now.onGround && (
            <TouchButton code="KeyP" on={now.parked}>
              Park Brake
            </TouchButton>
          )}
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div hidden={!props.buttons} className="grid grid-cols-2 gap-2">
          {now.firing && <TouchButton code="Enter">Fire</TouchButton>}
          {now.fighting && <TouchButton code="Space">Flares</TouchButton>}
          {spec.shape.type === 'bomber' && <TouchButton code="Tab">Bombsight</TouchButton>}
          <TouchButton code="KeyZ" on={now.autopilot}>
            Autopilot
          </TouchButton>
          <TouchButton code="KeyC">Camera</TouchButton>
        </div>
        <Stick label="Pitch · Roll" onMove={right} />
      </div>
    </div>
  )
}
