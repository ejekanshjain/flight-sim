import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { type PerspectiveCamera, Vector3 } from 'three'
import { game, useGame } from '../game/game'
import { heightAt } from '../world/island'

const FORWARD = new Vector3(0, 0, -1)
/** Vertical field of view in degrees from the pilot's seat. */
export const COCKPIT_FOV = 68
/** Pixels the view is shifted up so the horizon clears the instrument panel. */
export const horizonShift = (height: number) => Math.min(90, height * 0.11)
// The chase camera looks this many aircraft-distances past the nose,
// so the runway stays visible on approach
const CHASE_LOOK_AHEAD = 1.9
// Radians per second the camera circles a wreck
const ORBIT_RATE = 0.14
const forward = new Vector3()
const target = new Vector3()
const goal = new Vector3()

/** Drives the camera: a smoothed chase view, the pilot's seat, or a slow circle around a wreck. */
export function CameraRig() {
  const mode = useGame(state => state.camera)
  const camera = useThree(state => state.camera) as PerspectiveCamera
  const size = useThree(state => state.size)
  const trail = useRef(new Vector3(0, 0, -1))
  const orbit = useRef({ angle: 0, started: false, focus: new Vector3() })

  // Shifts the view up so the horizon sits in the middle of the area above the instrument panel
  useEffect(() => {
    const shift = horizonShift(size.height)
    camera.setViewOffset(size.width, size.height, 0, shift, size.width, size.height)
    return () => camera.clearViewOffset()
  }, [camera, size])

  useEffect(() => {
    camera.fov = mode === 'cockpit' ? COCKPIT_FOV : 58
    camera.updateProjectionMatrix()
  }, [camera, mode])

  useFrame((_, delta) => {
    const { sim, wreck, effects } = game
    const view = sim.spec.camera
    const circle = orbit.current

    if (wreck.active) {
      const wreckage = wreck.pieces[0].position
      if (!circle.started) {
        // Start the circle from wherever the camera was at the moment of the crash
        circle.started = true
        circle.angle = Math.atan2(camera.position.z - wreckage.z, camera.position.x - wreckage.x)
        circle.focus.copy(wreckage)
      }
      circle.angle += ORBIT_RATE * delta
      circle.focus.lerp(wreckage, 1 - Math.exp(-delta * 3))
      goal
        .set(Math.cos(circle.angle), 0, Math.sin(circle.angle))
        .multiplyScalar(view.distance * 1.9)
      goal.add(circle.focus).setY(Math.max(circle.focus.y, 0) + view.height * 2.2)
      camera.position.lerp(goal, 1 - Math.exp(-delta * 1.6))
      keepAboveGround(camera.position, 2.5)
      camera.up.set(0, 1, 0)
      camera.lookAt(target.copy(circle.focus).setY(circle.focus.y + 1.5))
    } else if (mode === 'cockpit') {
      circle.started = false
      camera.position.copy(view.eye).applyQuaternion(sim.orientation).add(sim.position)
      camera.quaternion.copy(sim.orientation)
    } else {
      circle.started = false
      // The camera swings behind the nose with a short lag.
      // It follows only part of the pitch, so it stays above the tail in a climb or flare.
      forward.copy(FORWARD).applyQuaternion(sim.orientation)
      forward.y *= 0.4
      trail.current.lerp(forward.normalize(), 1 - Math.exp(-delta * 4)).normalize()
      camera.position.copy(sim.position).addScaledVector(trail.current, -view.distance)
      camera.position.y += view.height
      keepAboveGround(camera.position, 1.2)
      target.copy(sim.position).addScaledVector(trail.current, view.distance * CHASE_LOOK_AHEAD)
      target.y += 1
      camera.up.set(0, 1, 0)
      camera.lookAt(target)
    }

    // The blast of a crash shakes the view
    const shake = effects.shake * 0.05
    if (shake > 0.0005) {
      camera.rotateX((Math.random() - 0.5) * shake)
      camera.rotateZ((Math.random() - 0.5) * shake)
    }
  })
  return null
}

function keepAboveGround(position: Vector3, clearance: number) {
  const floor = Math.max(heightAt(position.x, position.z), 0) + clearance
  if (position.y < floor) position.y = floor
}
