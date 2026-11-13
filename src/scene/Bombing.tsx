import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3
} from 'three'
import { GUIDED_REACH, type Target } from '../game/bombs'
import { game, useGame } from '../game/game'
import { heightAt } from '../world/island'
import { depthBias } from './logDepth'

const QUARTER_TURN = Math.PI / 2
// The aiming cross keeps about this share of its distance from the camera as its size
const CROSS_SCALE = 0.02
// Most bombs in the air at once
const MAX_FALLING = 8

/** One target: what stands there, a painted bullseye, a marker beam, and a crater once hit. */
function TargetModel({ target, index }: { target: Target; index: number }) {
  const standing = useRef<Group>(null)
  const crater = useRef<Group>(null)
  const y = heightAt(target.x, target.z)
  useFrame(() => {
    const destroyed = game.bombs.destroyed[index] ?? false
    if (standing.current) standing.current.visible = !destroyed
    if (crater.current) crater.current.visible = destroyed
  })
  const { radius, label } = target
  return (
    <group position={[target.x, y, target.z]}>
      {/* Bullseye rings painted around the target */}
      {[radius, radius * 0.55].map(ring => (
        <mesh key={ring} rotation-x={-QUARTER_TURN} position-y={0.3}>
          <ringGeometry args={[ring - 1.5, ring, 48]} />
          <meshBasicMaterial color="#f2efe6" side={DoubleSide} {...depthBias(0.001)} />
        </mesh>
      ))}
      <group ref={standing}>
        {label === 'radar' ? (
          <>
            <mesh castShadow position-y={6}>
              <cylinderGeometry args={[0.6, 0.9, 12, 8]} />
              <meshStandardMaterial color="#8a9096" />
            </mesh>
            <mesh castShadow position-y={13} rotation-x={-0.6}>
              <cylinderGeometry args={[6, 6, 0.6, 20]} />
              <meshStandardMaterial color="#d9dcdf" />
            </mesh>
          </>
        ) : label === 'fuel depot' ? (
          [-9, 0, 9].map(x => (
            <mesh key={x} castShadow position={[x, 4, 0]}>
              <cylinderGeometry args={[4, 4, 8, 16]} />
              <meshStandardMaterial color="#9c8f74" roughness={0.6} />
            </mesh>
          ))
        ) : (
          <mesh castShadow position-y={3}>
            <boxGeometry args={[radius * 0.5, 6, radius * 0.35]} />
            <meshStandardMaterial color="#77736b" roughness={0.9} />
          </mesh>
        )}
        {/* Orange marker beam, seen from far off and in the dark */}
        <mesh position-y={250}>
          <cylinderGeometry args={[5, 5, 500, 12, 1, true]} />
          <meshBasicMaterial
            color="#ff8a2a"
            transparent
            opacity={0.32}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
      <group ref={crater} visible={false}>
        <mesh rotation-x={-QUARTER_TURN} position-y={0.35}>
          <circleGeometry args={[radius * 0.7, 32]} />
          <meshStandardMaterial color="#1d1a17" roughness={1} {...depthBias(0.0015)} />
        </mesh>
      </group>
    </group>
  )
}

/** Where a bomb released now would land: a cross in a ring, green when it will hit. */
function AimCross() {
  const cross = useRef<Group>(null)
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: '#ffffff',
        depthTest: false,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
      }),
    []
  )
  useFrame(({ camera }) => {
    const { bombs } = game
    const group = cross.current
    if (!group) return
    group.visible = bombs.aiming
    if (!bombs.aiming) return
    group.position.copy(bombs.aim).setY(bombs.aim.y + 1)
    group.scale.setScalar(Math.max(4, bombs.aim.distanceTo(camera.position) * CROSS_SCALE))
    const index = bombs.nearestStanding(bombs.aim.x, bombs.aim.z)
    const nearest = bombs.targets[index]
    const zone = bombs.guided ? GUIDED_REACH : (nearest?.radius ?? 0)
    // Green while a release now, or an armed one, puts the bomb on the target
    const onTarget =
      bombs.armed >= 0 ||
      (nearest !== undefined &&
        (Math.hypot(nearest.x - bombs.aim.x, nearest.z - bombs.aim.z) <= zone ||
          (!bombs.guided && bombs.linedUp(game.sim, index))))
    material.color.set(onTarget ? '#4be36f' : '#ffffff')
  })
  return (
    // Drawn over everything, so a hill or a cloud never hides it
    <group ref={cross} visible={false} renderOrder={10}>
      <mesh rotation-x={-QUARTER_TURN} material={material} renderOrder={10}>
        <ringGeometry args={[0.85, 1, 40]} />
      </mesh>
      {[0, QUARTER_TURN].map(turn => (
        <mesh key={turn} rotation={[-QUARTER_TURN, 0, turn]} material={material} renderOrder={10}>
          <planeGeometry args={[2.6, 0.08]} />
        </mesh>
      ))}
    </group>
  )
}

const matrix = new Matrix4()
const turn = new Quaternion()
const scale = new Vector3(1, 1, 1)
const DOWN = new Vector3(0, -1, 0)
const heading = new Vector3()

/** Bombs on their way down, nose first along their path. */
function FallingBombs() {
  const mesh = useMemo(() => {
    const bombs = new InstancedMesh(
      new CylinderGeometry(0.18, 0.28, 2.2, 10),
      new MeshStandardMaterial({ color: '#4d5257', roughness: 0.5 }),
      MAX_FALLING
    )
    bombs.frustumCulled = false
    bombs.count = 0
    return bombs
  }, [])
  useFrame(() => {
    const { falling } = game.bombs
    mesh.count = Math.min(falling.length, MAX_FALLING)
    for (let i = 0; i < mesh.count; i++) {
      const bomb = falling[i]
      // The cylinder's long axis points along the bomb's flight
      turn.setFromUnitVectors(DOWN, heading.copy(bomb.velocity).normalize().negate())
      mesh.setMatrixAt(i, matrix.compose(bomb.position, turn, scale))
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return <primitive object={mesh} />
}

/** The bombing range's targets for the mission being flown, the aiming cross, and bombs. */
export function Bombing() {
  const mission = useGame(state => state.mission)
  const targets = mission?.targets ?? []
  if (targets.length === 0) return null
  return (
    <>
      {targets.map((target, i) => (
        <TargetModel key={`${target.x} ${target.z}`} target={target} index={i} />
      ))}
      <AimCross />
      <FallingBombs />
    </>
  )
}
