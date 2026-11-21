import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Path,
  Quaternion,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector3
} from 'three'
import { game } from '../game/game'
import type { Mission } from '../game/missions'

// Most gates any mission uses
const MAX_GATES = 16
// Bar thickness of a slot's frame, as a share of its size
const FRAME_BAR = 0.06
const NEXT = new Color('#4be36f')
const LATER = new Color('#f2a93b')
const UP = new Vector3(0, 1, 0)
const matrix = new Matrix4()
const turn = new Quaternion()
const position = new Vector3()
const scale = new Vector3()
const HIDDEN = new Matrix4().makeScale(0, 0, 0)

/** A flat square frame one unit across, standing upright and facing along Z. */
function frameGeometry() {
  const outer = new Shape()
  outer.moveTo(-0.5, -0.5)
  outer.lineTo(0.5, -0.5)
  outer.lineTo(0.5, 0.5)
  outer.lineTo(-0.5, 0.5)
  outer.closePath()
  const inner = 0.5 - FRAME_BAR
  const hole = new Path()
  hole.moveTo(-inner, -inner)
  hole.lineTo(-inner, inner)
  hole.lineTo(inner, inner)
  hole.lineTo(inner, -inner)
  hole.closePath()
  outer.holes.push(hole)
  return new ShapeGeometry(outer)
}

function gateMesh(geometry: TorusGeometry | ShapeGeometry) {
  const mesh = new InstancedMesh(
    geometry,
    new MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide }),
    MAX_GATES
  )
  mesh.frustumCulled = false
  mesh.visible = false
  return mesh
}

/**
 * The active mission's next three gates, the next one green and the others amber: rings,
 * and upright frames for slots flown through on the aircraft's side.
 */
export function MissionGates() {
  const meshes = useMemo(
    () => ({
      rings: gateMesh(new TorusGeometry(1, 0.06, 6, 40)),
      frames: gateMesh(frameGeometry())
    }),
    []
  )
  const shown = useRef<{ mission: Mission | null; gates: number }>({ mission: null, gates: -1 })
  useFrame(() => {
    const mission = game.getState().mission
    const gates = mission?.gates ?? []
    const passed = game.missions.gates
    if (shown.current.mission === mission && shown.current.gates === passed) return
    shown.current = { mission, gates: passed }
    const { rings, frames } = meshes
    rings.visible = gates.some(gate => !gate.slot)
    frames.visible = gates.some(gate => gate.slot)
    for (let i = 0; i < MAX_GATES; i++) {
      const gate = gates[i]
      rings.setMatrixAt(i, HIDDEN)
      frames.setMatrixAt(i, HIDDEN)
      // Only the next few gates show, so the course reads clearly ahead
      if (!gate || i < passed || i > passed + 2) continue
      turn.setFromAxisAngle(UP, -gate.heading)
      position.set(gate.x, gate.y, gate.z)
      const mesh = gate.slot ? frames : rings
      if (gate.slot) scale.set(gate.slot.width, gate.slot.height, 1)
      else scale.setScalar(gate.radius)
      mesh.setMatrixAt(i, matrix.compose(position, turn, scale))
      mesh.setColorAt(i, i === passed ? NEXT : LATER)
    }
    for (const mesh of [rings, frames]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  })
  return (
    <>
      <primitive object={meshes.rings} />
      <primitive object={meshes.frames} />
    </>
  )
}
