import { type RefObject, useCallback, useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { game } from '../game/game'
import type { Goal } from '../game/missions'
import { onCameraMoved } from '../scene/CameraRig'
import type { FlightSim } from '../sim/flight-sim'
import { FEET_PER_METRE, KNOTS_PER_MS, setText, useTelemetry } from './telemetry'

const GREEN = '#4be36f'
// Pixels the marker keeps from the sides of the view, and from the top bar
const MARGIN = 56
const TOP_CLEAR = 100
// The hover display shows within this many metres of a pad or a hover spot. Its edge is
// RANGE metres away, and the drift line reaches where you will be in DRIFT_AHEAD seconds.
const SHOW_WITHIN = 120
const RANGE = 60
const DRIFT_AHEAD = 3
const point = new Vector3()

/** Metres along the ground from the aircraft to a goal. */
export function goalDistance(sim: FlightSim, goal: Goal) {
  return Math.hypot(goal.x - sim.position.x, goal.z - sim.position.z)
}

/** A distance in metres, or in kilometres from 1 km. */
export function distanceText(metres: number) {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`
}

/** Which way to turn for a goal, in plain words: ahead, behind, or degrees left or right. */
export function goalDirection(sim: FlightSim, goal: Goal) {
  if (goalDistance(sim, goal) < (goal.spot ?? 30)) return 'right below you'
  const bearing = Math.atan2(goal.x - sim.position.x, -(goal.z - sim.position.z))
  const turn =
    (Math.atan2(Math.sin(bearing - sim.heading), Math.cos(bearing - sim.heading)) * 180) / Math.PI
  const size = Math.round(Math.abs(turn) / 5) * 5
  if (size <= 10) return 'straight ahead'
  if (size >= 160) return 'behind you'
  return `turn ${turn > 0 ? 'right' : 'left'} ${size}°`
}

/**
 * Green marker over where the current mission step leads, with its name and distance. When
 * the place is off screen, the marker waits at the edge with an arrow pointing the way.
 * `panel` is the instrument panel, which the marker stays above.
 */
export function GoalMarker({ panel }: { panel: RefObject<HTMLDivElement | null> }) {
  const marker = useRef<HTMLDivElement>(null)
  const arrow = useRef<SVGGElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  // Top of the instrument panel in pixels, measured when its size or the window changes
  const floor = useRef(window.innerHeight)
  useEffect(() => {
    const element = panel.current
    if (!element) return
    const measure = () => {
      floor.current = element.getBoundingClientRect().top
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [panel])

  useEffect(
    () =>
      onCameraMoved(camera => {
        const box = marker.current
        if (!box) return
        const goal = game.missions.goal
        const shown = goal !== null && game.getState().status === 'flying'
        box.hidden = !shown
        if (!goal || !shown) return
        point.set(goal.x, goal.y + 2, goal.z).project(camera)
        // A point behind the camera projects mirrored, so flip it back to point the way round
        const behind = point.z > 1
        if (behind) point.multiplyScalar(-1)
        const width = window.innerWidth
        const x = ((point.x + 1) / 2) * width
        const y = ((1 - point.y) / 2) * window.innerHeight
        const left = MARGIN
        const right = width - MARGIN
        const top = TOP_CLEAR
        // The label hangs below the marker, so it keeps clear of the panel too
        const bottom = Math.max(top + 40, floor.current - MARGIN - 12)
        const inside = !behind && x > left && x < right && y > top && y < bottom
        let at = { x, y }
        if (!inside) {
          // Slide out from the middle of the view toward the place until the edge stops it
          const middle = { x: (left + right) / 2, y: (top + bottom) / 2 }
          let dx = x - middle.x
          let dy = y - middle.y
          if (Math.hypot(dx, dy) < 1) dy = 1
          const reach = Math.min(
            (right - middle.x) / Math.max(Math.abs(dx), 1e-6),
            (bottom - middle.y) / Math.max(Math.abs(dy), 1e-6)
          )
          dx *= reach
          dy *= reach
          at = { x: middle.x + dx, y: middle.y + dy }
          arrow.current?.setAttribute(
            'transform',
            `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)})`
          )
        }
        arrow.current?.setAttribute('visibility', inside ? 'hidden' : 'visible')
        box.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`
        setText(label.current, `${goal.name} · ${distanceText(goalDistance(game.sim, goal))}`)
      }),
    []
  )

  return (
    <div ref={marker} hidden className="absolute top-0 left-0">
      <svg
        viewBox="-30 -30 60 60"
        className="absolute -top-7 -left-7 size-14 drop-shadow-[0_1px_2px_rgb(0_0_0/0.8)]"
        aria-hidden="true"
      >
        <path d="M 0 -11 L 11 0 L 0 11 L -11 0 Z" fill="none" stroke={GREEN} strokeWidth="3.5" />
        <circle r="2.5" fill={GREEN} />
        <g ref={arrow} visibility="hidden">
          <path d="M 18 -7 L 28 0 L 18 7 Z" fill={GREEN} />
        </g>
      </svg>
      <span
        ref={label}
        className="absolute top-6 left-0 -translate-x-1/2 text-sm font-bold whitespace-nowrap text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]"
      />
    </div>
  )
}

/**
 * Top-down view around the helicopter, nose up, shown near a pad or a hover spot. The green
 * circle is the spot and the line is where the drift carries you in a few seconds, so
 * steering the line's end onto the circle brings you over it.
 */
export function HoverDisplay() {
  const card = useRef<HTMLDivElement>(null)
  const spot = useRef<SVGCircleElement>(null)
  const drift = useRef<SVGLineElement>(null)
  const height = useRef<HTMLSpanElement>(null)
  const speed = useRef<HTMLSpanElement>(null)
  useTelemetry(
    useCallback((sim: FlightSim) => {
      if (!card.current) return
      const goal = game.missions.goal
      const shown =
        goal?.spot !== undefined && goalDistance(sim, goal) < SHOW_WITHIN && !sim.onGround
      card.current.hidden = !shown
      if (!goal?.spot || !shown) return
      const scale = 90 / RANGE
      // Nose-up axes: ahead along the heading, and right across it
      const forwardX = Math.sin(sim.heading)
      const forwardZ = -Math.cos(sim.heading)
      const across = (x: number, z: number) => [
        x * -forwardZ + z * forwardX,
        x * forwardX + z * forwardZ
      ]
      const [right, ahead] = across(goal.x - sim.position.x, goal.z - sim.position.z)
      // A spot past the edge waits on the edge, in the right direction
      const out = Math.hypot(right, ahead) * scale
      const pull = out > 88 ? 88 / out : 1
      spot.current?.setAttribute('cx', (right * scale * pull).toFixed(1))
      spot.current?.setAttribute('cy', (-ahead * scale * pull).toFixed(1))
      spot.current?.setAttribute('r', (goal.spot * scale).toFixed(1))
      const [slide, forward] = across(sim.velocity.x, sim.velocity.z)
      const length = Math.hypot(slide, forward) * DRIFT_AHEAD * scale
      const cap = length > 92 ? 92 / length : 1
      drift.current?.setAttribute('x2', (slide * DRIFT_AHEAD * scale * cap).toFixed(1))
      drift.current?.setAttribute('y2', (-forward * DRIFT_AHEAD * scale * cap).toFixed(1))
      const wheels = (sim.position.y - sim.spec.restHeight - goal.y) * FEET_PER_METRE
      setText(height.current, `${Math.max(0, Math.round(wheels))} ft`)
      setText(speed.current, `${Math.round(sim.groundSpeed * KNOTS_PER_MS)} kt`)
    }, [])
  )
  return (
    <div
      ref={card}
      hidden
      className="bg-ink/80 text-marking w-60 rounded-md px-3 py-2 shadow-lg backdrop-blur-sm"
    >
      <h2 className="text-sm font-bold">Hover Display</h2>
      <svg viewBox="-100 -100 200 200" className="mt-1 aspect-square w-full" role="img">
        <title>Pad position and drift, seen from above with the nose up</title>
        <circle r="96" fill="#06080a" />
        <circle r="90" fill="none" stroke="white" strokeOpacity="0.35" />
        <circle r="45" fill="none" stroke="white" strokeOpacity="0.25" strokeDasharray="3 4" />
        <text x="4" y="-47" fontSize="10" fill="white" fillOpacity="0.5">
          {RANGE / 2} m
        </text>
        <circle ref={spot} fill={GREEN} fillOpacity="0.25" stroke={GREEN} strokeWidth="2.5" />
        <line ref={drift} stroke="#f2a93b" strokeWidth="3.5" strokeLinecap="round" />
        {/* The helicopter, nose up, in the middle */}
        <path d="M 0 -9 L 5 4 L 0 1 L -5 4 Z" fill="white" />
      </svg>
      <dl className="mt-1 grid grid-cols-2 text-xs">
        <div>
          <dt className="text-marking/60">Wheels above it</dt>
          <dd ref={height} className="text-base font-bold tabular-nums" />
        </div>
        <div>
          <dt className="text-marking/60">Drift</dt>
          <dd ref={speed} className="text-base font-bold tabular-nums" />
        </div>
      </dl>
    </div>
  )
}
