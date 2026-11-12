import { useFrame } from '@react-three/fiber'
import { type ReactNode, type RefObject, useMemo, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  type Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3
} from 'three'
import { game, useGame } from '../game/game'
import { PART_NAMES, type PartName } from '../game/wreck'
import type { AircraftSpec, AirlinerShape, Shape } from '../sim/aircraft'
import { useDisposal } from './dispose'

const QUARTER_TURN = Math.PI / 2
const UP = new Vector3(0, 1, 0)
// Largest control surface angles in radians
const AILERON_TRAVEL = 0.35
const ELEVATOR_TRAVEL = 0.4
const RUDDER_TRAVEL = 0.45
const FLAP_TRAVEL = 0.6
const AIRBRAKE_TRAVEL = 1

// Colours the paint burns to after a crash on land
const SOOT = new Color('#3a3733')

type Paint = Record<'body' | 'accent' | 'dark' | 'glass' | 'red' | 'green', MeshStandardMaterial>

/** Shared by every aircraft model: its materials, and the parts it breaks into. */
type Airframe = {
  root: RefObject<Group | null>
  parts: RefObject<(Group | null)[]>
  paint: Paint
  spec: AircraftSpec
}

/**
 * Keeps an aircraft model on the flight model, or on its wreckage after a crash.
 * Hides it in cockpit view and scorches the paint once it burns.
 */
function useAirframe(spec: AircraftSpec, body: string, accent: string): Airframe {
  const root = useRef<Group>(null)
  const parts = useRef<(Group | null)[]>([])
  const colors = useMemo(
    () => ({ body: new Color(body), accent: new Color(accent), dark: new Color('#1e2226') }),
    [body, accent]
  )
  const paint = useMemo<Paint>(
    () => ({
      body: new MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }),
      accent: new MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 }),
      dark: new MeshStandardMaterial({ roughness: 0.6 }),
      glass: new MeshStandardMaterial({ color: '#16252f', roughness: 0.08, metalness: 0.6 }),
      red: new MeshStandardMaterial({
        color: '#ff2a1a',
        emissive: '#ff2a1a',
        emissiveIntensity: 3
      }),
      green: new MeshStandardMaterial({
        color: '#19ff5a',
        emissive: '#19ff5a',
        emissiveIntensity: 3
      })
    }),
    []
  )
  useDisposal(paint)

  useFrame(() => {
    const { sim, wreck } = game
    if (!root.current) return
    if (wreck.active) {
      // The parts are placed in world space, each following its piece of wreckage
      root.current.position.set(0, 0, 0)
      root.current.quaternion.identity()
      root.current.visible = true
      parts.current.forEach((part, i) => {
        part?.position.copy(wreck.pieces[i].position)
        part?.quaternion.copy(wreck.pieces[i].orientation)
      })
    } else {
      root.current.position.copy(sim.position)
      root.current.quaternion.copy(sim.orientation)
      root.current.visible = game.getState().camera === 'chase'
      parts.current.forEach((part, i) => {
        part?.position.copy(spec.breakup[i].rest)
        part?.quaternion.identity()
      })
    }
    // Paint burns black within a second of a crash on land
    const burnt = wreck.active && sim.crash !== 'water' ? Math.min(1, wreck.time * 1.5) * 0.85 : 0
    for (const key of ['body', 'accent', 'dark'] as const) {
      paint[key].color.copy(colors[key]).lerp(SOOT, burnt)
    }
  })
  return { root, parts, paint, spec }
}

/** One breakable part of the aircraft. Children use aircraft body coordinates. */
function Part(props: { airframe: Airframe; name: PartName; children: ReactNode }) {
  const index = PART_NAMES.indexOf(props.name)
  const { rest } = props.airframe.spec.breakup[index]
  return (
    <group
      ref={group => {
        props.airframe.parts.current[index] = group
      }}
      position={rest}
    >
      <group position={[-rest.x, -rest.y, -rest.z]}>{props.children}</group>
    </group>
  )
}

/** Cylinder running from one point to another, for struts and gear legs. */
function Strut(props: {
  from: [number, number, number]
  to: [number, number, number]
  radius: number
  material: MeshStandardMaterial
}) {
  const { position, quaternion, length } = useMemo(() => {
    const start = new Vector3(...props.from)
    const span = new Vector3(...props.to).sub(start)
    return {
      position: start.clone().addScaledVector(span, 0.5),
      quaternion: new Quaternion().setFromUnitVectors(UP, span.clone().normalize()),
      length: span.length()
    }
  }, [props.from, props.to])
  return (
    <mesh castShadow material={props.material} position={position} quaternion={quaternion}>
      <cylinderGeometry args={[props.radius, props.radius, length, 8]} />
    </mesh>
  )
}

/** Wheel with its axle across the aircraft, centred on `position`. */
function Wheel(props: {
  position: [number, number, number]
  radius: number
  material: MeshStandardMaterial
}) {
  return (
    <mesh castShadow material={props.material} position={props.position} rotation-z={QUARTER_TURN}>
      <cylinderGeometry args={[props.radius, props.radius, props.radius * 0.6, 16]} />
    </mesh>
  )
}

/** The aircraft in the world: the type picked in the menu, built from breakable parts. */
export function Aircraft() {
  const spec = useGame(state => state.flown)
  const { shape } = spec
  return (
    <>
      {shape.type === 'airliner' &&
        (shape.variant === 'concorde' ? (
          <ConcordeModel key={spec.id} spec={spec} shape={shape} />
        ) : (
          <AirlinerModel key={spec.id} spec={spec} shape={shape} />
        ))}
      {shape.type === 'fighter' && <FighterModel key={spec.id} spec={spec} shape={shape} />}
      {shape.type === 'propeller' && <PropellerModel key={spec.id} spec={spec} shape={shape} />}
      <Cockpit spec={spec} />
    </>
  )
}

type PropellerShape = Extract<Shape, { type: 'propeller' }>

/**
 * Single-engine propeller aircraft sized from its specification: high or low wing,
 * fixed or retractable gear. The nose points along -Z, matching the flight model.
 */
function PropellerModel({ spec, shape }: { spec: AircraftSpec; shape: PropellerShape }) {
  const airframe = useAirframe(spec, shape.paint, shape.accent)
  const { paint } = airframe
  const disc = useMemo(
    () =>
      new MeshStandardMaterial({
        color: '#cfd4d8',
        transparent: true,
        opacity: 0.14,
        side: DoubleSide,
        depthWrite: false
      }),
    []
  )
  const propeller = useRef<Group>(null)
  const blades = useRef<Group>(null)
  const blur = useRef<Group>(null)
  const beacon = useRef<Group>(null)
  const lamp = useRef<Group>(null)
  const noseGear = useRef<Group>(null)
  const leftGear = useRef<Group>(null)
  const rightGear = useRef<Group>(null)
  const leftFlap = useRef<Group>(null)
  const rightFlap = useRef<Group>(null)
  const leftAileron = useRef<Group>(null)
  const rightAileron = useRef<Group>(null)
  const leftBrake = useRef<Group>(null)
  const rightBrake = useRef<Group>(null)
  const elevator = useRef<Group>(null)
  const rudder = useRef<Group>(null)

  useFrame(({ clock }, delta) => {
    const { sim, pilot, wreck } = game
    const c = pilot.controls
    if (propeller.current && blades.current && blur.current) {
      const spinning = game.getState().status === 'flying' ? sim.rpm : 0
      propeller.current.rotation.z -= (spinning / 60) * Math.PI * 2 * delta
      // Above idle the blades blur into a disc
      blades.current.visible = spinning < 900
      blur.current.visible = spinning > 400
    }
    // The red beacon on the fin flashes once a second
    if (beacon.current) beacon.current.visible = !wreck.active && clock.elapsedTime % 1 < 0.12
    if (lamp.current) lamp.current.visible = pilot.landingLights && !wreck.active

    if (spec.retractableGear) {
      const retract = (1 - sim.gearPosition) * QUARTER_TURN
      for (const leg of [noseGear, leftGear, rightGear]) {
        if (leg.current) leg.current.visible = sim.gearPosition > 0.03
      }
      if (noseGear.current) noseGear.current.rotation.x = -retract
      if (leftGear.current) leftGear.current.rotation.z = retract
      if (rightGear.current) rightGear.current.rotation.z = -retract
    }
    const flap = sim.flapPosition * FLAP_TRAVEL
    if (leftFlap.current) leftFlap.current.rotation.x = flap
    if (rightFlap.current) rightFlap.current.rotation.x = flap
    if (leftAileron.current) leftAileron.current.rotation.x = c.roll * AILERON_TRAVEL
    if (rightAileron.current) rightAileron.current.rotation.x = -c.roll * AILERON_TRAVEL
    const airbrake = -sim.speedBrakePosition * AIRBRAKE_TRAVEL
    if (leftBrake.current) leftBrake.current.rotation.x = airbrake
    if (rightBrake.current) rightBrake.current.rotation.x = airbrake
    if (elevator.current) elevator.current.rotation.x = -(c.pitch + c.trim * 0.3) * ELEVATOR_TRAVEL
    if (rudder.current) rudder.current.rotation.y = c.yaw * RUDDER_TRAVEL
  })

  const radius = shape.cabinRadius
  const cabinFront = shape.noseZ + 0.9
  const cabinBack = 0.6
  const halfSpan = spec.wingSpan / 2
  const chord = spec.chord
  const [nose, leftMain, rightMain] = spec.contactPoints.map(point => point.position)
  const wheel = 0.21

  /** Gear leg from a mount on the airframe down to its wheel. It swings around the mount. */
  const leg = (
    mount: [number, number, number],
    wheelBottom: Vector3,
    ref: RefObject<Group | null>,
    size: number
  ) => (
    <group ref={ref} position={mount}>
      <Strut
        from={[0, 0, 0]}
        to={[wheelBottom.x - mount[0], wheelBottom.y + size - mount[1], wheelBottom.z - mount[2]]}
        radius={0.045}
        material={paint.dark}
      />
      <Wheel
        position={[
          wheelBottom.x - mount[0],
          wheelBottom.y + size - mount[1],
          wheelBottom.z - mount[2]
        ]}
        radius={size}
        material={paint.dark}
      />
    </group>
  )
  /** Height of the wing's underside at a distance from the centreline. */
  const underWing = (x: number) => shape.wingY + Math.abs(x) * Math.sin(shape.dihedral) - 0.09
  const mainLeg = (bottom: Vector3, ref: RefObject<Group | null>) =>
    shape.highWing
      ? leg([Math.sign(bottom.x) * radius * 0.7, -radius * 0.75, bottom.z], bottom, ref, wheel)
      : leg([bottom.x, underWing(bottom.x), bottom.z], bottom, ref, wheel)

  const wing = (side: 1 | -1) => (
    <>
      <group position={[0, shape.wingY, 0.15]} rotation-z={shape.dihedral * side}>
        {/* A flattened cylinder on its side gives the wing rounded leading and trailing edges */}
        <mesh
          castShadow
          material={paint.body}
          position={[(halfSpan / 2 + 0.05) * side, 0, 0]}
          rotation-z={QUARTER_TURN}
          scale={[0.11, 1, 1]}
        >
          <cylinderGeometry args={[chord / 2, chord / 2, halfSpan - 0.1, 20]} />
        </mesh>
        <mesh
          castShadow
          material={paint.accent}
          position={[halfSpan * side, 0, 0]}
          scale={[0.25, 0.1, chord / 2]}
        >
          <sphereGeometry args={[1, 12, 8]} />
        </mesh>
        <mesh
          material={side === 1 ? paint.green : paint.red}
          position={[(halfSpan + 0.22) * side, 0, -0.2]}
        >
          <sphereGeometry args={[0.06, 8, 6]} />
        </mesh>
        {spec.flapLabels.length > 1 && (
          <group
            ref={side === 1 ? rightFlap : leftFlap}
            position={[halfSpan * 0.34 * side, -0.02, chord / 2 - 0.03]}
          >
            <mesh castShadow material={paint.body} position={[0, 0, 0.2]}>
              <boxGeometry args={[halfSpan * 0.43, 0.06, 0.42]} />
            </mesh>
          </group>
        )}
        <group
          ref={side === 1 ? rightAileron : leftAileron}
          position={[halfSpan * 0.77 * side, -0.02, chord / 2 - 0.03]}
        >
          <mesh castShadow material={paint.body} position={[0, 0, 0.18]}>
            <boxGeometry args={[halfSpan * 0.4, 0.06, 0.38]} />
          </mesh>
        </group>
        {/* Airbrake panel: hinged at its front edge, it lifts out of the top of the wing */}
        <group
          ref={side === 1 ? rightBrake : leftBrake}
          position={[halfSpan * 0.4 * side, 0.09, 0.05]}
        >
          <mesh castShadow material={paint.accent} position={[0, 0, 0.2]}>
            <boxGeometry args={[halfSpan * 0.3, 0.03, 0.4]} />
          </mesh>
        </group>
      </group>
      {shape.highWing && (
        <Strut
          from={[radius * 0.8 * side, -radius * 0.6, 0.1]}
          to={[halfSpan * 0.5 * side, shape.wingY - 0.08, 0.15]}
          radius={0.04}
          material={paint.body}
        />
      )}
      {!shape.highWing &&
        mainLeg(side === 1 ? rightMain : leftMain, side === 1 ? rightGear : leftGear)}
    </>
  )

  return (
    <group ref={airframe.root}>
      <Part airframe={airframe} name="fuselage">
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0, (cabinFront + cabinBack) / 2]}
          rotation-x={QUARTER_TURN}
        >
          <cylinderGeometry args={[radius, radius, cabinBack - cabinFront, 20]} />
        </mesh>
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0.06, (cabinBack + shape.tailZ) / 2]}
          rotation-x={QUARTER_TURN}
        >
          <cylinderGeometry args={[0.14, radius, shape.tailZ - cabinBack, 20]} />
        </mesh>
        {/* Cheat line along the cabin */}
        <mesh
          material={paint.accent}
          position={[0, 0.02, (cabinFront + cabinBack) / 2]}
          rotation-x={QUARTER_TURN}
          scale={[1.05, 1, 0.33]}
        >
          <cylinderGeometry args={[radius, radius, cabinBack - cabinFront, 20, 1, true]} />
        </mesh>
        {shape.highWing ? (
          // Windscreen and side windows wrap the cabin under the wing
          <mesh
            material={paint.glass}
            position={[0, radius * 0.38, -0.55]}
            scale={[radius * 1.03, radius * 0.6, 1]}
          >
            <sphereGeometry args={[1, 20, 14]} />
          </mesh>
        ) : (
          <mesh
            material={paint.glass}
            position={[0, radius * 0.67, spec.camera.eye.z + 0.1]}
            scale={[radius * 0.83, radius * 0.8, 1.15]}
          >
            <sphereGeometry args={[1, 20, 14]} />
          </mesh>
        )}
        {leg([0, -radius * 0.75, nose.z], nose, noseGear, 0.19)}
        {shape.highWing && mainLeg(leftMain, leftGear)}
        {shape.highWing && mainLeg(rightMain, rightGear)}
      </Part>

      <Part airframe={airframe} name="nose">
        {/* Landing light */}
        <group ref={lamp} position={[0, -radius * 0.6, shape.noseZ + 0.35]}>
          <mesh>
            <sphereGeometry args={[0.1, 8, 6]} />
            <meshBasicMaterial color="#fffbe6" toneMapped={false} />
          </mesh>
        </group>
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0, shape.noseZ + 0.45]}
          rotation-x={QUARTER_TURN}
        >
          <cylinderGeometry args={[radius, radius * 0.68, 0.9, 20]} />
        </mesh>
        <mesh
          material={paint.accent}
          position={[0, 0, shape.noseZ + 0.04]}
          rotation-x={QUARTER_TURN}
        >
          <cylinderGeometry args={[radius * 0.69, radius * 0.64, 0.1, 20]} />
        </mesh>
        <group ref={propeller} position={[0, 0, shape.noseZ - 0.02]}>
          <mesh material={paint.dark} position={[0, 0, -0.18]} rotation-x={-QUARTER_TURN}>
            <coneGeometry args={[0.2, 0.42, 16]} />
          </mesh>
          <group ref={blades}>
            {[0, Math.PI].map(turn => (
              <group key={turn} rotation-z={turn}>
                <mesh
                  castShadow
                  material={paint.dark}
                  position={[0, shape.propRadius / 2, 0]}
                  scale={[1, 1, 0.25]}
                >
                  <cylinderGeometry args={[0.03, 0.09, shape.propRadius, 8]} />
                </mesh>
              </group>
            ))}
          </group>
          <group ref={blur}>
            <mesh material={disc}>
              <circleGeometry args={[shape.propRadius, 32]} />
            </mesh>
          </group>
        </group>
      </Part>

      <Part airframe={airframe} name="leftWing">
        {wing(-1)}
      </Part>
      <Part airframe={airframe} name="rightWing">
        {wing(1)}
      </Part>

      <Part airframe={airframe} name="tail">
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0.2, shape.tailZ - 0.5]}
          rotation-z={QUARTER_TURN}
          scale={[0.1, 1, 1]}
        >
          <cylinderGeometry args={[0.42, 0.42, shape.tailSpan, 16]} />
        </mesh>
        <group ref={elevator} position={[0, 0.2, shape.tailZ - 0.12]}>
          <mesh castShadow material={paint.body} position={[0, 0, 0.2]}>
            <boxGeometry args={[shape.tailSpan, 0.05, 0.42]} />
          </mesh>
        </group>
        <mesh
          castShadow
          material={paint.accent}
          position={[0, 0.2 + shape.finHeight / 2, shape.tailZ - 0.55]}
          scale={[0.1, 1, 1]}
        >
          <cylinderGeometry args={[0.3, 0.5, shape.finHeight, 16]} />
        </mesh>
        <group ref={rudder} position={[0, 0.2 + shape.finHeight / 2, shape.tailZ - 0.1]}>
          <mesh castShadow material={paint.accent} position={[0, 0, 0.2]}>
            <boxGeometry args={[0.07, shape.finHeight * 0.96, 0.4]} />
          </mesh>
        </group>
        <group ref={beacon} position={[0, 0.26 + shape.finHeight, shape.tailZ - 0.55]}>
          <mesh material={paint.red}>
            <sphereGeometry args={[0.08, 8, 6]} />
          </mesh>
        </group>
      </Part>
    </group>
  )
}

/** Flat panel with the outline `points` (x, z pairs) in the XZ plane, `thickness` tall. */
function plateGeometry(points: [number, number][], thickness: number) {
  const half = thickness / 2
  const positions: number[] = []
  const corner = (index: number, y: number) => {
    const [x, z] = points[index % points.length]
    positions.push(x, y, z)
  }
  for (let i = 1; i < points.length - 1; i++) {
    // Top and bottom faces, fanned out from the first corner
    for (const index of [0, i + 1, i]) corner(index, half)
    for (const index of [0, i, i + 1]) corner(index, -half)
  }
  for (let i = 0; i < points.length; i++) {
    for (const [index, y] of [
      [i, half],
      [i + 1, half],
      [i, -half],
      [i + 1, half],
      [i + 1, -half],
      [i, -half]
    ]) {
      corner(index, y)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Mirrors an outline across the centreline for the left-hand side. */
const mirrored = (points: [number, number][]): [number, number][] =>
  points.map(([x, z]) => [-x, z] as [number, number]).reverse()

type Outline = [number, number][]

/** Outlines and layout that differ between the two fighters. Outlines are (x, z) pairs. */
const FIGHTERS = {
  f16: {
    wing: [
      [0.85, -0.8],
      [4.6, 2.3],
      [4.6, 3.3],
      [0.85, 3.1]
    ] as Outline,
    strake: [
      [0.45, -3.4],
      [0.85, -0.8],
      [0.85, 1.2],
      [0.45, 1.2]
    ] as Outline,
    flaperon: [
      [0.9, 0],
      [4.5, 0.2],
      [4.5, 0.55],
      [0.9, 0.75]
    ] as Outline,
    flaperonZ: 3.15,
    stabilator: [
      [0.6, -1],
      [2.8, 0.25],
      [2.8, 0.95],
      [0.6, 0.8]
    ] as Outline,
    // Height and distance aft, turned upright when built
    fin: [
      [0.6, 3.9],
      [3.4, 6.25],
      [3.4, 7.15],
      [0.6, 7.3]
    ] as Outline,
    // Sideways position and outward lean of each fin
    fins: [[0, 0]],
    bodyWidth: 1.3,
    noseWidth: 1,
    canopyZ: -3.3,
    chinIntake: true,
    missiles: 4.72
  },
  f35: {
    wing: [
      [1.5, -1],
      [5.3, 2.5],
      [5.3, 3.5],
      [1.5, 3.7]
    ] as Outline,
    strake: [
      [0.7, -4.6],
      [1.5, -1],
      [1.5, 1.2],
      [0.7, 1.2]
    ] as Outline,
    flaperon: [
      [1.6, 0],
      [5.2, -0.15],
      [5.2, 0.3],
      [1.6, 0.75]
    ] as Outline,
    flaperonZ: 3.7,
    stabilator: [
      [1.3, -1],
      [3.6, 0.5],
      [3.6, 1.1],
      [1.3, 1.1]
    ] as Outline,
    fin: [
      [0.5, 4.4],
      [2.8, 6.3],
      [2.8, 7],
      [0.5, 7.2]
    ] as Outline,
    fins: [
      [1.25, 0.42],
      [-1.25, -0.42]
    ],
    bodyWidth: 1.95,
    noseWidth: 1.35,
    canopyZ: -4.1,
    chinIntake: false,
    missiles: 0
  }
}

/** Jet fighter: blended body, swept wing, bubble canopy, and an all-moving tailplane. */
function FighterModel(props: { spec: AircraftSpec; shape: Extract<Shape, { type: 'fighter' }> }) {
  const { spec, shape } = props
  const layout = FIGHTERS[shape.variant]
  const airframe = useAirframe(spec, shape.paint, shape.accent)
  const { paint } = airframe
  const geometry = useMemo(
    () => ({
      rightWing: plateGeometry(layout.wing, 0.14),
      leftWing: plateGeometry(mirrored(layout.wing), 0.14),
      rightStrake: plateGeometry(layout.strake, 0.16),
      leftStrake: plateGeometry(mirrored(layout.strake), 0.16),
      rightFlaperon: plateGeometry(layout.flaperon, 0.1),
      leftFlaperon: plateGeometry(mirrored(layout.flaperon), 0.1),
      rightStabilator: plateGeometry(layout.stabilator, 0.1),
      leftStabilator: plateGeometry(mirrored(layout.stabilator), 0.1),
      fin: plateGeometry(layout.fin, 0.14).rotateZ(QUARTER_TURN)
    }),
    [layout]
  )
  const flames = useMemo(() => {
    const glow = { transparent: true, depthWrite: false, toneMapped: false }
    return {
      outer: new MeshBasicMaterial({ ...glow, color: '#ff6a14', opacity: 0.55 }),
      core: new MeshBasicMaterial({ ...glow, color: '#ffe9a8', opacity: 0.9 })
    }
  }, [])
  const burner = useRef<Group>(null)
  const beacon = useRef<Group>(null)
  const lamp = useRef<Group>(null)
  const noseGear = useRef<Group>(null)
  const leftGear = useRef<Group>(null)
  const rightGear = useRef<Group>(null)
  const leftFlaperon = useRef<Group>(null)
  const rightFlaperon = useRef<Group>(null)
  const leftStabilator = useRef<Group>(null)
  const rightStabilator = useRef<Group>(null)
  const leftBrake = useRef<Group>(null)
  const rightBrake = useRef<Group>(null)

  useFrame(({ clock }) => {
    const { sim, pilot, wreck } = game
    const c = pilot.controls
    if (burner.current) {
      burner.current.visible = sim.afterburner && !wreck.active
      // The flame flickers in length
      burner.current.scale.z = 0.85 + Math.random() * 0.3
    }
    if (beacon.current) beacon.current.visible = !wreck.active && clock.elapsedTime % 1 < 0.12
    if (lamp.current) lamp.current.visible = pilot.landingLights && !wreck.active

    const retract = (1 - sim.gearPosition) * QUARTER_TURN
    for (const leg of [noseGear, leftGear, rightGear]) {
      if (leg.current) leg.current.visible = sim.gearPosition > 0.03
    }
    if (noseGear.current) noseGear.current.rotation.x = -retract
    if (leftGear.current) leftGear.current.rotation.x = retract
    if (rightGear.current) rightGear.current.rotation.x = retract

    // Flaperons droop together as flaps and move against each other to roll
    const flap = sim.flapPosition * 0.35
    if (leftFlaperon.current) leftFlaperon.current.rotation.x = flap + c.roll * 0.3
    if (rightFlaperon.current) rightFlaperon.current.rotation.x = flap - c.roll * 0.3
    // The whole tailplane moves, and helps the roll
    const pitch = -(c.pitch + c.trim * 0.3) * 0.35
    if (leftStabilator.current) leftStabilator.current.rotation.x = pitch + c.roll * 0.12
    if (rightStabilator.current) rightStabilator.current.rotation.x = pitch - c.roll * 0.12
    if (leftBrake.current) leftBrake.current.rotation.y = -sim.speedBrakePosition * 0.9
    if (rightBrake.current) rightBrake.current.rotation.y = sim.speedBrakePosition * 0.9
  })

  const [nose, leftMain, rightMain] = spec.contactPoints.map(point => point.position)
  const leg = (bottom: Vector3, ref: RefObject<Group | null>, size: number) => (
    <group ref={ref} position={[bottom.x * 0.75, -0.6, bottom.z]}>
      <Strut
        from={[0, 0, 0]}
        to={[bottom.x * 0.25, bottom.y + size + 0.6, 0]}
        radius={0.07}
        material={paint.dark}
      />
      <Wheel
        position={[bottom.x * 0.25, bottom.y + size + 0.6, 0]}
        radius={size}
        material={paint.dark}
      />
    </group>
  )
  const wing = (side: 1 | -1) => (
    <>
      <mesh
        castShadow
        material={paint.body}
        geometry={side === 1 ? geometry.rightWing : geometry.leftWing}
      />
      <group ref={side === 1 ? rightFlaperon : leftFlaperon} position={[0, 0, layout.flaperonZ]}>
        <mesh
          castShadow
          material={paint.body}
          geometry={side === 1 ? geometry.rightFlaperon : geometry.leftFlaperon}
        />
      </group>
      {layout.missiles > 0 && (
        <mesh
          castShadow
          material={paint.accent}
          position={[layout.missiles * side, 0, 2.7]}
          rotation-x={QUARTER_TURN}
        >
          <cylinderGeometry args={[0.07, 0.07, 2.9, 8]} />
        </mesh>
      )}
      <mesh
        material={side === 1 ? paint.green : paint.red}
        position={[layout.wing[1][0] * side, 0, layout.wing[1][1]]}
      >
        <sphereGeometry args={[0.07, 8, 6]} />
      </mesh>
    </>
  )

  return (
    <group ref={airframe.root}>
      <Part airframe={airframe} name="fuselage">
        {/* Wide, flattened centre body that blends into the wings */}
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0, 0.5]}
          rotation-x={QUARTER_TURN}
          scale={[layout.bodyWidth, 1, 0.82]}
        >
          <cylinderGeometry args={[0.85, 0.75, 6, 24]} />
        </mesh>
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0, 5.25]}
          rotation-x={QUARTER_TURN}
          scale={[layout.bodyWidth * 0.88, 1, 0.9]}
        >
          <cylinderGeometry args={[0.62, 0.85, 3.5, 24]} />
        </mesh>
        <mesh castShadow material={paint.dark} position={[0, 0, 7.3]} rotation-x={QUARTER_TURN}>
          <cylinderGeometry args={[0.5, 0.64, 0.7, 24, 1, true]} />
        </mesh>
        <mesh castShadow material={paint.body} geometry={geometry.rightStrake} />
        <mesh castShadow material={paint.body} geometry={geometry.leftStrake} />
        {layout.chinIntake ? (
          <>
            <mesh
              castShadow
              material={paint.body}
              position={[0, -0.72, -0.9]}
              rotation-x={QUARTER_TURN}
              scale={[1, 1, 0.55]}
            >
              <cylinderGeometry args={[0.62, 0.58, 4.2, 20]} />
            </mesh>
            <mesh material={paint.dark} position={[0, -0.72, -3.01]} scale={[1, 0.55, 1]}>
              <circleGeometry args={[0.5, 20]} />
            </mesh>
          </>
        ) : (
          // One slanted intake on each side of the cockpit
          [-1, 1].map(side => (
            <group key={side} position={[1.05 * side, -0.1, -2.2]}>
              <mesh castShadow material={paint.body} position={[0, 0, 1.4]}>
                <boxGeometry args={[0.85, 0.95, 3.4]} />
              </mesh>
              <mesh material={paint.dark} position={[0, 0, -0.31]}>
                <planeGeometry args={[0.7, 0.8]} />
              </mesh>
            </group>
          ))
        )}
        <group ref={burner} position={[0, 0, 7.6]}>
          <mesh material={flames.outer} position={[0, 0, 2.1]} rotation-x={QUARTER_TURN}>
            <coneGeometry args={[0.47, 4.2, 16, 1, true]} />
          </mesh>
          <mesh material={flames.core} position={[0, 0, 1.1]} rotation-x={QUARTER_TURN}>
            <coneGeometry args={[0.28, 2.2, 16, 1, true]} />
          </mesh>
        </group>
        {/* Airbrakes: two panels that swing out from the sides of the tail */}
        <group ref={leftBrake} position={[-0.72 * layout.bodyWidth * 0.8, 0, 5.9]}>
          <mesh castShadow material={paint.accent} position={[0, 0, 0.55]}>
            <boxGeometry args={[0.06, 0.7, 1.1]} />
          </mesh>
        </group>
        <group ref={rightBrake} position={[0.72 * layout.bodyWidth * 0.8, 0, 5.9]}>
          <mesh castShadow material={paint.accent} position={[0, 0, 0.55]}>
            <boxGeometry args={[0.06, 0.7, 1.1]} />
          </mesh>
        </group>
        {leg(leftMain, leftGear, 0.3)}
        {leg(rightMain, rightGear, 0.3)}
      </Part>

      <Part airframe={airframe} name="nose">
        <mesh
          castShadow
          material={paint.accent}
          position={[0, 0, -6.3]}
          rotation-x={-QUARTER_TURN}
          scale={[layout.noseWidth, 1, 1]}
        >
          <coneGeometry args={[0.42, 2.4, 24]} />
        </mesh>
        <mesh
          castShadow
          material={paint.body}
          position={[0, 0, -3.8]}
          rotation-x={QUARTER_TURN}
          scale={[layout.noseWidth, 1, 1]}
        >
          <cylinderGeometry args={[0.76, 0.42, 2.6, 24]} />
        </mesh>
        <mesh material={paint.glass} position={[0, 0.58, layout.canopyZ]} scale={[0.46, 0.55, 1.8]}>
          <sphereGeometry args={[1, 24, 16]} />
        </mesh>
        {leg(nose, noseGear, 0.24)}
        {/* Landing light */}
        <group ref={lamp} position={[0, nose.y + 0.9, nose.z - 0.15]}>
          <mesh>
            <sphereGeometry args={[0.1, 8, 6]} />
            <meshBasicMaterial color="#fffbe6" toneMapped={false} />
          </mesh>
        </group>
      </Part>

      <Part airframe={airframe} name="leftWing">
        {wing(-1)}
      </Part>
      <Part airframe={airframe} name="rightWing">
        {wing(1)}
      </Part>

      <Part airframe={airframe} name="tail">
        {layout.fins.map(([x, lean]) => (
          <group key={x} position={[x, 0, 0]} rotation-z={-lean}>
            <mesh castShadow material={paint.body} geometry={geometry.fin} />
          </group>
        ))}
        <group ref={rightStabilator} position={[0, -0.05, 6.3]}>
          <mesh castShadow material={paint.body} geometry={geometry.rightStabilator} />
        </group>
        <group ref={leftStabilator} position={[0, -0.05, 6.3]}>
          <mesh castShadow material={paint.body} geometry={geometry.leftStabilator} />
        </group>
        <group ref={beacon} position={[0, 0.95, 4.2]}>
          <mesh material={paint.red}>
            <sphereGeometry args={[0.09, 8, 6]} />
          </mesh>
        </group>
      </Part>
    </group>
  )
}

/**
 * Fuselage tube from nose to tail in two pieces, split where the aircraft breaks apart.
 * Texture coordinates run along the body (u) and around it from the belly (v).
 */
function fuselageGeometry(shape: AirlinerShape) {
  const stations = 56
  const around = 28
  const { radius, tall, noseZ, tailZ } = shape
  const noseLength = radius * 2.6
  const tailLength = radius * 6
  const positions: number[] = []
  const uvs: number[] = []
  for (let i = 0; i <= stations; i++) {
    const along = i / stations
    const z = noseZ + along * (tailZ - noseZ)
    // Rounded nose, constant cabin, then a tail cone that sweeps upward
    const intoNose = Math.max(0, 1 - (z - noseZ) / noseLength)
    const intoTail = Math.max(0, (z - (tailZ - tailLength)) / tailLength)
    const r = radius * Math.max(0.04, Math.sqrt(1 - intoNose ** 2.2) * (1 - 0.9 * intoTail ** 1.5))
    const lift = radius * (0.75 * intoTail ** 2 - 0.25 * intoNose ** 2)
    for (let j = 0; j <= around; j++) {
      const angle = (j / around) * Math.PI * 2
      positions.push(r * Math.sin(angle), -r * Math.cos(angle) * tall + lift, z)
      uvs.push(along, j / around)
    }
  }
  const split = Math.round(stations * 0.2)
  const section = (from: number, to: number) => {
    const index: number[] = []
    for (let i = from; i < to; i++) {
      for (let j = 0; j < around; j++) {
        const a = i * (around + 1) + j
        const b = a + around + 1
        index.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    return geometry
  }
  return { nose: section(0, split), body: section(split, stations) }
}

/** Paints the fuselage: belly, cabin windows on each deck, cockpit windows, and a cheat line. */
function liveryTexture(shape: AirlinerShape) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Airliner paint needs a 2D canvas, which this browser refused')
  const { width, height } = canvas
  // Canvas rows run around the fuselage: 0 at the belly, 0.25 on the right, 0.5 on top
  const row = (around: number) => (1 - around) * height
  ctx.fillStyle = shape.paint
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#b9bdc0'
  ctx.fillRect(0, row(0.1), width, height)
  ctx.fillRect(0, 0, width, row(0.9))
  ctx.fillStyle = shape.accent
  for (const side of [0.215, 0.785]) ctx.fillRect(width * 0.05, row(side) - 2, width * 0.84, 4)
  ctx.fillStyle = '#1b2530'
  const decks = shape.decks === 2 ? [0.262, 0.345] : [0.285]
  const pitch = (0.52 / (shape.tailZ - shape.noseZ)) * width
  for (const deck of decks) {
    for (const around of [deck, 1 - deck]) {
      for (let x = width * 0.13; x < width * 0.83; x += pitch) {
        ctx.fillRect(x, row(around) - 3, pitch * 0.45, 6)
      }
    }
  }
  // Cockpit windows wrap the top of the nose
  ctx.fillRect(width * 0.035, row(0.44), width * 0.022, row(0.3) - row(0.44))
  ctx.fillRect(width * 0.035, row(0.7), width * 0.022, row(0.56) - row(0.7))
  ctx.fillRect(width * 0.028, row(0.56), width * 0.012, row(0.44) - row(0.56))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** Geometry and paint for an airliner's fuselage, wings, moving panels, and tail. */
export function airlinerParts(shape: AirlinerShape) {
  const { wing, radius } = shape
  const rootX = radius * 0.85
  const outline: Outline = [
    [rootX, wing.rootZ],
    [wing.halfSpan, wing.tipZ],
    [wing.halfSpan, wing.tipZ + wing.tipChord],
    [rootX + (wing.halfSpan - rootX) * 0.32, wing.rootZ + wing.rootChord * 0.78],
    [rootX, wing.rootZ + wing.rootChord]
  ]
  // Trailing-edge panels: flaps inboard, spoilers ahead of them
  const trailing = (from: number, to: number, chord: number, back: number): Outline => {
    const edge = (share: number) =>
      wing.rootZ +
      wing.rootChord * 0.8 +
      (wing.tipZ + wing.tipChord - wing.rootZ - wing.rootChord * 0.8) * share
    const x1 = rootX + (wing.halfSpan - rootX) * from
    const x2 = rootX + (wing.halfSpan - rootX) * to
    return [
      [x1, edge(from) - chord * (1 - back)],
      [x2, edge(to) - chord * 0.6 * (1 - back)],
      [x2, edge(to) + chord * 0.6 * back],
      [x1, edge(from) + chord * back]
    ]
  }
  const flap = trailing(0.06, 0.7, wing.rootChord * 0.24, 0.9)
  const spoiler = trailing(0.2, 0.68, wing.rootChord * 0.16, -0.6)
  const stabChord = shape.tailSpan * 0.36
  const stabZ = shape.tailZ - stabChord - radius * 0.9
  const stab: Outline = [
    [radius * 0.25, stabZ],
    [shape.tailSpan / 2, stabZ + shape.tailSpan * 0.3],
    [shape.tailSpan / 2, stabZ + shape.tailSpan * 0.3 + stabChord * 0.4],
    [radius * 0.25, stabZ + stabChord]
  ]
  const finChord = shape.finHeight * 0.95
  const finZ = shape.tailZ - finChord - radius * 0.6
  const fin: Outline = [
    [0, finZ],
    [shape.finHeight, finZ + shape.finHeight * 0.72],
    [shape.finHeight, finZ + shape.finHeight * 0.72 + finChord * 0.36],
    [0, finZ + finChord]
  ]
  const thick = wing.rootChord * 0.055
  return {
    fuselage: fuselageGeometry(shape),
    skin: new MeshStandardMaterial({
      map: liveryTexture(shape),
      roughness: 0.38,
      metalness: 0.1
    }),
    wings: [plateGeometry(mirrored(outline), thick), plateGeometry(outline, thick)],
    flaps: [plateGeometry(mirrored(flap), thick * 0.5), plateGeometry(flap, thick * 0.5)],
    spoilers: [plateGeometry(mirrored(spoiler), thick * 0.2), plateGeometry(spoiler, thick * 0.2)],
    stabs: [plateGeometry(mirrored(stab), thick * 0.5), plateGeometry(stab, thick * 0.5)],
    fin: plateGeometry(fin, thick * 0.6).rotateZ(QUARTER_TURN),
    thick
  }
}

/** Left and right wheel on each axle of a gear truck, as [side, axle] pairs. */
const wheelSpots = (axles: number) =>
  Array.from({ length: axles * 2 }, (_, i): [number, number] => [i % 2 ? 1 : -1, Math.floor(i / 2)])

/** Jet airliner sized from its specification: one or two decks, two or four engines. */
function AirlinerModel({ spec, shape }: { spec: AircraftSpec; shape: AirlinerShape }) {
  const airframe = useAirframe(spec, shape.paint, shape.accent)
  const { paint } = airframe
  const { wing, radius } = shape
  const top = radius * shape.tall
  const length = shape.tailZ - shape.noseZ
  const tailLift = radius * 0.75

  const built = useMemo(() => airlinerParts(shape), [shape])
  useDisposal(built)

  const flaps = useRef<(Group | null)[]>([])
  const spoilers = useRef<(Group | null)[]>([])
  const stabs = useRef<Group>(null)
  const gear = useRef<(Group | null)[]>([])
  const beacon = useRef<Group>(null)
  const strobes = useRef<(Group | null)[]>([])
  const lamps = useRef<(Group | null)[]>([])

  useFrame(({ clock }) => {
    const { sim, pilot, wreck } = game
    const blink = clock.elapsedTime % 1.2
    if (beacon.current) beacon.current.visible = !wreck.active && clock.elapsedTime % 1 < 0.12
    for (const strobe of strobes.current) {
      if (strobe) strobe.visible = !wreck.active && (blink < 0.05 || (blink > 0.15 && blink < 0.2))
    }
    for (const lamp of lamps.current) if (lamp) lamp.visible = pilot.landingLights && !wreck.active
    // Flaps slide back and down as they extend
    for (const flap of flaps.current) {
      if (!flap) continue
      flap.position.set(
        0,
        -sim.flapPosition * built.thick * 1.6,
        sim.flapPosition * wing.rootChord * 0.1
      )
      flap.rotation.x = sim.flapPosition * 0.12
    }
    for (const spoiler of spoilers.current) {
      if (spoiler)
        spoiler.position.y = built.thick * 0.6 + sim.speedBrakePosition * built.thick * 1.4
    }
    if (stabs.current) stabs.current.rotation.x = -pilot.controls.pitch * 0.12
    // Gear legs swing sideways into the wing roots, the nose leg forward
    const retract = (1 - sim.gearPosition) * QUARTER_TURN
    gear.current.forEach((leg, i) => {
      if (!leg) return
      leg.visible = sim.gearPosition > 0.03
      if (i === 0) leg.rotation.x = retract
      else leg.rotation.z = i % 2 ? retract : -retract
    })
  })

  const [nose, leftMain, rightMain] = spec.contactPoints.map(point => point.position)
  const tyre = -nose.y * 0.16
  /** Gear leg with a truck of wheels. `pairs` is how many axles the truck has. */
  const leg = (index: number, bottom: Vector3, pairs: number, mountY: number) => {
    const drop = bottom.y + tyre - mountY
    return (
      <group
        key={index}
        ref={group => {
          gear.current[index] = group
        }}
        position={[bottom.x, mountY, bottom.z]}
      >
        <Strut from={[0, 0, 0]} to={[0, drop, 0]} radius={tyre * 0.22} material={paint.dark} />
        {wheelSpots(pairs).map(([side, axle]) => (
          <Wheel
            key={`${axle} ${side}`}
            position={[side * tyre * 0.75, drop, (axle - (pairs - 1) / 2) * tyre * 2.3]}
            radius={index === 0 ? tyre * 0.8 : tyre}
            material={paint.dark}
          />
        ))}
      </group>
    )
  }
  const trucks = spec.mass > 300_000 ? 3 : spec.mass > 120_000 ? 2 : 1

  const wingPart = (side: 0 | 1) => {
    const sign = side === 1 ? 1 : -1
    const tipSize = wing.tipChord
    return (
      <>
        <group position={[0, wing.y, 0]} rotation-z={wing.dihedral * sign}>
          <mesh castShadow material={paint.body} geometry={built.wings[side]} />
          <group
            ref={group => {
              flaps.current[side] = group
            }}
          >
            <mesh castShadow material={paint.body} geometry={built.flaps[side]} />
          </group>
          <group
            ref={group => {
              spoilers.current[side] = group
            }}
          >
            <mesh material={paint.accent} geometry={built.spoilers[side]} />
          </group>
          {/* Wingtip device: blended sharklet, split scimitar, or a fence above and below */}
          {wing.tip !== 'raked' && (
            <mesh
              castShadow
              material={paint.accent}
              position={[
                wing.halfSpan * sign,
                wing.tip === 'sharklet' ? tipSize * 0.6 : 0,
                wing.tipZ + tipSize * 0.7
              ]}
              rotation-z={wing.tip === 'sharklet' ? -0.25 * sign : 0}
            >
              <boxGeometry
                args={[0.12, tipSize * (wing.tip === 'sharklet' ? 1.3 : 1.6), tipSize * 0.75]}
              />
            </mesh>
          )}
          <mesh
            material={side === 1 ? paint.green : paint.red}
            position={[wing.halfSpan * sign, 0, wing.tipZ]}
          >
            <sphereGeometry args={[0.16, 8, 6]} />
          </mesh>
          <group
            ref={group => {
              strobes.current[side] = group
            }}
            position={[wing.halfSpan * sign, 0, wing.tipZ + tipSize]}
          >
            <mesh>
              <sphereGeometry args={[0.2, 8, 6]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          </group>
        </group>
        {shape.engines.map(([x, z]) => {
          const wingUnder = wing.y + x * Math.sin(wing.dihedral) - built.thick
          return (
            <group key={x} position={[x * sign, shape.engineY, z]}>
              <mesh
                castShadow
                material={paint.body}
                position={[0, 0, shape.engineLength / 2]}
                rotation-x={QUARTER_TURN}
              >
                <cylinderGeometry
                  args={[
                    shape.engineRadius * 0.7,
                    shape.engineRadius,
                    shape.engineLength,
                    28,
                    1,
                    true
                  ]}
                />
              </mesh>
              <mesh material={paint.accent} position={[0, 0, 0.15]} rotation-x={QUARTER_TURN}>
                <cylinderGeometry
                  args={[shape.engineRadius * 1.02, shape.engineRadius * 0.96, 0.3, 28, 1, true]}
                />
              </mesh>
              <mesh
                material={paint.dark}
                position={[0, 0, shape.engineLength * 0.12]}
                rotation-y={Math.PI}
              >
                <circleGeometry args={[shape.engineRadius * 0.97, 28]} />
              </mesh>
              <mesh
                material={paint.dark}
                position={[0, 0, shape.engineLength * 1.02]}
                rotation-x={QUARTER_TURN}
              >
                <coneGeometry args={[shape.engineRadius * 0.45, shape.engineLength * 0.45, 16]} />
              </mesh>
              {/* Pylon up to the wing */}
              <mesh
                castShadow
                material={paint.body}
                position={[
                  0,
                  (wingUnder - shape.engineY + shape.engineRadius) / 2,
                  shape.engineLength * 0.65
                ]}
              >
                <boxGeometry
                  args={[
                    0.3,
                    Math.max(0.2, wingUnder - shape.engineY - shape.engineRadius * 0.6),
                    shape.engineLength * 0.9
                  ]}
                />
              </mesh>
            </group>
          )
        })}
        {leg(side + 1, side === 1 ? rightMain : leftMain, trucks, wing.y - built.thick)}
        <group
          ref={group => {
            lamps.current[side] = group
          }}
          position={[radius * 1.3 * sign, wing.y, wing.rootZ + 0.4]}
        >
          <mesh>
            <sphereGeometry args={[0.28, 10, 8]} />
            <meshBasicMaterial color="#fffbe6" toneMapped={false} />
          </mesh>
        </group>
      </>
    )
  }

  return (
    <group ref={airframe.root}>
      <Part airframe={airframe} name="fuselage">
        <mesh castShadow material={built.skin} geometry={built.fuselage.body} />
        <group ref={beacon} position={[0, top + 0.15, 0]}>
          <mesh material={paint.red}>
            <sphereGeometry args={[0.25, 8, 6]} />
          </mesh>
        </group>
      </Part>
      <Part airframe={airframe} name="nose">
        <mesh castShadow material={built.skin} geometry={built.fuselage.nose} />
        {leg(0, nose, 1, -radius * 0.8)}
      </Part>
      <Part airframe={airframe} name="leftWing">
        {wingPart(0)}
      </Part>
      <Part airframe={airframe} name="rightWing">
        {wingPart(1)}
      </Part>
      <Part airframe={airframe} name="tail">
        <group ref={stabs} position={[0, tailLift * 0.55, shape.tailZ - length * 0.07]}>
          <group position={[0, 0, -(shape.tailZ - length * 0.07)]}>
            <mesh castShadow material={paint.body} geometry={built.stabs[0]} />
            <mesh castShadow material={paint.body} geometry={built.stabs[1]} />
          </group>
        </group>
        <mesh
          castShadow
          material={paint.accent}
          geometry={built.fin}
          position={[0, top * 0.7 + tailLift * 0.5, 0]}
        />
      </Part>
    </group>
  )
}

// Concorde: where the nose hinges down, and how far it droops at full travel
const NOSE_HINGE_Z = -25.2
const NOSE_HINGE_Y = -1.1
const NOSE_DROOP = (12.5 * Math.PI) / 180
// Wing stations from root to tip as [x, leading edge z, trailing edge z, thickness]
const CONCORDE_WING: [number, number, number, number][] = [
  [1.2, -14, 24.2, 0.75],
  [2, -8, 24.2, 0.7],
  [3, -2.5, 24.2, 0.62],
  [4.3, 3, 24.2, 0.52],
  [6, 8.5, 24.1, 0.42],
  [8, 13, 24, 0.32],
  [10, 17, 23.9, 0.24],
  [11.6, 20.2, 23.8, 0.18],
  [12.8, 22.4, 23.7, 0.12]
]
// Elevons along the trailing edge: inboard x, outboard x
const ELEVONS: [number, number][] = [
  [1.4, 5],
  [5.2, 8.8],
  [9, 12.4]
]
const ELEVON_CHORD = 2.2

/** Radius and centreline height of Concorde's fuselage at a station along the body. */
function concordeSection(z: number) {
  const { radius, noseZ, tailZ } = CONCORDE_BODY
  // A long needle nose, a constant cabin, then a tail cone that sweeps up
  const intoNose = Math.max(0, 1 - (z - noseZ) / 9)
  const intoTail = Math.max(0, (z - (tailZ - 11.5)) / 11.5)
  const r = radius * Math.max(0.03, (1 - intoNose ** 1.7) * (1 - 0.78 * intoTail ** 1.4))
  return { r, lift: 0.75 * intoTail ** 2 - 0.15 * intoNose ** 2 }
}

const CONCORDE_BODY = { radius: 1.45, tall: 1.05, noseZ: -32, tailZ: 29.7 }

/**
 * Concorde's fuselage in three pieces: the drooping nose ahead of the hinge, the cockpit
 * section, and the cabin and tail. Texture u runs along the whole body.
 */
function concordeFuselage() {
  const { tall, noseZ, tailZ } = CONCORDE_BODY
  const around = 28
  const build = (from: number, to: number, stations: number) => {
    const positions: number[] = []
    const uvs: number[] = []
    for (let i = 0; i <= stations; i++) {
      const z = from + ((to - from) * i) / stations
      const { r, lift } = concordeSection(z)
      for (let j = 0; j <= around; j++) {
        const angle = (j / around) * Math.PI * 2
        positions.push(r * Math.sin(angle), -r * Math.cos(angle) * tall + lift, z)
        uvs.push((z - noseZ) / (tailZ - noseZ), j / around)
      }
    }
    const index: number[] = []
    for (let i = 0; i < stations; i++) {
      for (let j = 0; j < around; j++) {
        const a = i * (around + 1) + j
        const b = a + around + 1
        index.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    return geometry
  }
  return {
    droop: build(noseZ, NOSE_HINGE_Z, 16),
    cockpit: build(NOSE_HINGE_Z, -16, 10),
    body: build(-16, tailZ, 40)
  }
}

/** White paint, a blue and a red line along the windows, small cabin windows, and the windscreen. */
function concordeLivery(paint: string, accent: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Concorde paint needs a 2D canvas, which this browser refused')
  const { width, height } = canvas
  const { noseZ, tailZ } = CONCORDE_BODY
  const u = (z: number) => ((z - noseZ) / (tailZ - noseZ)) * width
  // Canvas rows run around the fuselage: 0 at the belly, 0.25 on the right, 0.5 on top
  const row = (around: number) => (1 - around) * height
  ctx.fillStyle = paint
  ctx.fillRect(0, 0, width, height)
  for (const side of [0.3, 0.7]) {
    const below = side < 0.5 ? -1 : 1
    ctx.fillStyle = accent
    ctx.fillRect(u(-24), row(side + below * 0.035) - 2, u(25) - u(-24), 4)
    ctx.fillStyle = '#b3262d'
    ctx.fillRect(u(-24), row(side + below * 0.05) - 1, u(25) - u(-24), 2)
    // Concorde's windows are famously small
    ctx.fillStyle = '#1b2530'
    for (let z = -21; z < 15; z += 0.52) ctx.fillRect(u(z), row(side) - 3, u(0.22) - u(0), 6)
  }
  // Windscreen behind the hinge, and the visor that covers it on the nose
  ctx.fillStyle = '#16202a'
  ctx.fillRect(u(-25), row(0.62), u(-23.7) - u(-25), row(0.38) - row(0.62))
  ctx.fillRect(u(-27.4), row(0.56), u(-25.4) - u(-27.4), row(0.44) - row(0.56))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * The right half of the ogival delta wing as a solid of top and bottom skins between
 * spanwise stations. The left half mirrors it.
 */
function deltaWingGeometry(side: 1 | -1) {
  const positions: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    // Two triangles a-b-c and a-c-d, wound to face outward on the right half
    const order = side === 1 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]
    for (const point of order) positions.push(point[0] * side, point[1], point[2])
  }
  for (let i = 0; i < CONCORDE_WING.length - 1; i++) {
    const [x1, le1, te1, t1] = CONCORDE_WING[i]
    const [x2, le2, te2, t2] = CONCORDE_WING[i + 1]
    // Thickest a third of the way back, thin at both edges
    const mid1 = le1 + (te1 - le1) * 0.35
    const mid2 = le2 + (te2 - le2) * 0.35
    for (const sign of [1, -1]) {
      const y1 = (sign * t1) / 2
      const y2 = (sign * t2) / 2
      const front = [
        [x1, 0, le1],
        [x1, y1, mid1],
        [x2, y2, mid2],
        [x2, 0, le2]
      ]
      const back = [
        [x1, y1, mid1],
        [x1, 0, te1],
        [x2, 0, te2],
        [x2, y2, mid2]
      ]
      for (const panel of [front, back]) {
        if (sign === 1) quad(panel[0], panel[1], panel[2], panel[3])
        else quad(panel[0], panel[3], panel[2], panel[1])
      }
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Concorde: slender body, ogival delta wing, four engines in two nacelles, and a drooping nose. */
function ConcordeModel({ spec, shape }: { spec: AircraftSpec; shape: AirlinerShape }) {
  const airframe = useAirframe(spec, shape.paint, shape.accent)
  const { paint } = airframe
  const built = useMemo(
    () => ({
      fuselage: concordeFuselage(),
      skin: new MeshStandardMaterial({
        map: concordeLivery(shape.paint, shape.accent),
        roughness: 0.35,
        metalness: 0.1
      }),
      wings: [deltaWingGeometry(-1), deltaWingGeometry(1)],
      elevons: ELEVONS.map(([inner, outer]) =>
        plateGeometry(
          [
            [inner, 0],
            [outer, 0],
            [outer, ELEVON_CHORD * 0.95],
            [inner, ELEVON_CHORD]
          ],
          0.1
        )
      ),
      fin: plateGeometry(
        [
          [0, 15.5],
          [8.6, 25.4],
          [8.6, 27.2],
          [0, 27.4]
        ],
        0.38
      ).rotateZ(QUARTER_TURN),
      rudder: plateGeometry(
        [
          [0.2, 0],
          [8.4, 0],
          [8.4, 1.5],
          [0.2, 1.9]
        ],
        0.24
      ).rotateZ(QUARTER_TURN)
    }),
    [shape]
  )
  useDisposal(built)

  const flames = useMemo(() => {
    const glow = { transparent: true, depthWrite: false, toneMapped: false }
    return {
      outer: new MeshBasicMaterial({ ...glow, color: '#ff7a24', opacity: 0.5 }),
      core: new MeshBasicMaterial({ ...glow, color: '#ffe9a8', opacity: 0.85 })
    }
  }, [])
  const nose = useRef<Group>(null)
  const elevons = useRef<(Group | null)[]>([])
  const rudder = useRef<Group>(null)
  const burners = useRef<(Group | null)[]>([])
  const gear = useRef<(Group | null)[]>([])
  const beacon = useRef<Group>(null)
  const strobes = useRef<(Group | null)[]>([])
  const lamps = useRef<(Group | null)[]>([])

  useFrame(({ clock }) => {
    const { sim, pilot, wreck } = game
    const c = pilot.controls
    const blink = clock.elapsedTime % 1.2
    if (beacon.current) beacon.current.visible = !wreck.active && blink < 0.12
    for (const strobe of strobes.current) {
      if (strobe) strobe.visible = !wreck.active && (blink < 0.05 || (blink > 0.15 && blink < 0.2))
    }
    for (const lamp of lamps.current) if (lamp) lamp.visible = pilot.landingLights && !wreck.active
    // The nose droops 5° at the middle notch and 12.5° at full
    if (nose.current) nose.current.rotation.x = -sim.flapPosition * NOSE_DROOP
    // Elevons do the work of elevators and ailerons together
    elevons.current.forEach((elevon, i) => {
      if (!elevon) return
      const right = i >= ELEVONS.length
      const roll = c.roll * 0.3 * (right ? -1 : 1)
      elevon.rotation.x = -(c.pitch + c.trim * 0.3) * 0.3 + roll
    })
    if (rudder.current) rudder.current.rotation.y = -c.yaw * 0.35
    const flame = 0.85 + Math.random() * 0.3
    for (const burner of burners.current) {
      if (!burner) continue
      burner.visible = sim.afterburner && !wreck.active
      burner.scale.z = flame
    }
    // Main legs fold inward under the wing, the nose leg forward
    const retract = (1 - sim.gearPosition) * QUARTER_TURN
    gear.current.forEach((leg, i) => {
      if (!leg) return
      leg.visible = sim.gearPosition > 0.03
      if (i === 0) leg.rotation.x = retract
      else leg.rotation.z = i === 1 ? -retract : retract
    })
  })

  const [noseWheel, leftMain, rightMain] = spec.contactPoints.map(point => point.position)
  const wingY = shape.wing.y
  /** A tall gear leg ending in a truck of `pairs` axles. */
  const leg = (index: number, bottom: Vector3, pairs: number, mountY: number, tyre: number) => {
    const drop = bottom.y + tyre - mountY
    return (
      <group
        key={index}
        ref={group => {
          gear.current[index] = group
        }}
        position={[bottom.x, mountY, bottom.z]}
      >
        <Strut from={[0, 0, 0]} to={[0, drop, 0]} radius={0.16} material={paint.dark} />
        {wheelSpots(pairs).map(([side, axle]) => (
          <Wheel
            key={`${axle} ${side}`}
            position={[side * tyre * 0.8, drop, (axle - (pairs - 1) / 2) * tyre * 2.4]}
            radius={tyre}
            material={paint.dark}
          />
        ))}
      </group>
    )
  }
  const wingPart = (side: 0 | 1) => {
    const sign = side === 1 ? 1 : -1
    const nacelleX = 3.35 * sign
    const tip = CONCORDE_WING[CONCORDE_WING.length - 1]
    return (
      <>
        <group position={[0, wingY, 0]} rotation-z={shape.wing.dihedral * sign}>
          <mesh castShadow material={paint.body} geometry={built.wings[side]} />
          {built.elevons.map((geometry, i) => (
            <group
              key={ELEVONS[i][0]}
              ref={group => {
                elevons.current[side * ELEVONS.length + i] = group
              }}
              position={[0, 0, 24.2]}
              scale={[sign, 1, 1]}
            >
              <mesh castShadow material={paint.body} geometry={geometry} />
            </group>
          ))}
          <mesh
            material={side === 1 ? paint.green : paint.red}
            position={[tip[0] * sign, 0, tip[1] + 0.3]}
          >
            <sphereGeometry args={[0.16, 8, 6]} />
          </mesh>
          <group
            ref={group => {
              strobes.current[side] = group
            }}
            position={[tip[0] * sign, 0, tip[1] + 0.9]}
          >
            <mesh>
              <sphereGeometry args={[0.2, 8, 6]} />
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
          </group>
        </group>
        {/* Two engines side by side in one nacelle, with intakes ahead of the wing's spar */}
        <group position={[nacelleX, shape.engineY, 0]}>
          <mesh castShadow material={paint.body} position={[0, 0, 16.8]}>
            <boxGeometry args={[3.1, 1.55, 19.5]} />
          </mesh>
          <mesh castShadow material={paint.body} position={[0, 0.55, 16.8]}>
            <boxGeometry args={[2.6, 0.5, 19.5]} />
          </mesh>
          {[-0.78, 0.78].map(x => (
            <group key={x} position={[x, 0, 0]}>
              {/* Intake mouth, raked back at the bottom */}
              <mesh material={paint.dark} position={[0, 0, 7.04]} rotation-x={-0.25}>
                <planeGeometry args={[1.35, 1.25]} />
              </mesh>
              <mesh material={paint.dark} position={[0, 0, 26.9]} rotation-x={QUARTER_TURN}>
                <cylinderGeometry args={[0.55, 0.62, 0.8, 16, 1, true]} />
              </mesh>
              <group
                ref={group => {
                  burners.current[side * 2 + (x > 0 ? 1 : 0)] = group
                }}
                position={[0, 0, 27.3]}
              >
                <mesh material={flames.outer} position={[0, 0, 2.6]} rotation-x={QUARTER_TURN}>
                  <coneGeometry args={[0.55, 5.2, 14, 1, true]} />
                </mesh>
                <mesh material={flames.core} position={[0, 0, 1.3]} rotation-x={QUARTER_TURN}>
                  <coneGeometry args={[0.32, 2.6, 14, 1, true]} />
                </mesh>
              </group>
            </group>
          ))}
        </group>
        {leg(side + 1, side === 1 ? rightMain : leftMain, 2, wingY - 0.3, 0.62)}
        <group
          ref={group => {
            lamps.current[side] = group
          }}
          position={[1.9 * sign, wingY - 0.3, -10]}
        >
          <mesh>
            <sphereGeometry args={[0.22, 10, 8]} />
            <meshBasicMaterial color="#fffbe6" toneMapped={false} />
          </mesh>
        </group>
      </>
    )
  }

  return (
    <group ref={airframe.root}>
      <Part airframe={airframe} name="fuselage">
        <mesh castShadow material={built.skin} geometry={built.fuselage.body} />
        <group ref={beacon} position={[0, 1.6, 2]}>
          <mesh material={paint.red}>
            <sphereGeometry args={[0.22, 8, 6]} />
          </mesh>
        </group>
      </Part>
      <Part airframe={airframe} name="nose">
        <mesh castShadow material={built.skin} geometry={built.fuselage.cockpit} />
        {/* The nose swings down about a hinge below the windscreen */}
        <group position={[0, NOSE_HINGE_Y, NOSE_HINGE_Z]}>
          <group ref={nose}>
            <group position={[0, -NOSE_HINGE_Y, -NOSE_HINGE_Z]}>
              <mesh castShadow material={built.skin} geometry={built.fuselage.droop} />
            </group>
          </group>
        </group>
        {leg(0, noseWheel, 1, -1.3, 0.5)}
      </Part>
      <Part airframe={airframe} name="leftWing">
        {wingPart(0)}
      </Part>
      <Part airframe={airframe} name="rightWing">
        {wingPart(1)}
      </Part>
      <Part airframe={airframe} name="tail">
        <group position={[0, 1.2, 0]}>
          <mesh castShadow material={paint.body} geometry={built.fin} />
          <group ref={rudder} position={[0, 0, 27.4]}>
            <mesh castShadow material={paint.body} geometry={built.rudder} />
          </group>
        </group>
      </Part>
    </group>
  )
}

const TRIM = new MeshStandardMaterial({ color: '#14171a', roughness: 0.9 })

/**
 * What the pilot sees of their own aircraft from the seat: the glareshield and the frame
 * around the windows. Shown only in cockpit view.
 */
function Cockpit({ spec }: { spec: AircraftSpec }) {
  const frame = useRef<Group>(null)
  useFrame(() => {
    if (!frame.current) return
    frame.current.visible = game.getState().camera === 'cockpit' && !game.wreck.active
    frame.current.position.copy(game.sim.position)
    frame.current.quaternion.copy(game.sim.orientation)
  })
  const { eye } = spec.camera
  const kind = spec.shape.type
  return (
    <group ref={frame}>
      {/* Drawn 2.6 times life size around the eye: it looks the same from the seat,
          and nothing sits closer than the camera can draw */}
      <group position={eye} scale={2.6}>
        {/* Glareshield across the bottom of the view */}
        <mesh material={TRIM} position={[-eye.x, -0.4, -0.85]}>
          <boxGeometry args={[2.6, 0.1, 0.9]} />
        </mesh>
        {/* Instrument panel face below it, so the ground never shows under the glareshield */}
        <mesh material={TRIM} position={[-eye.x, -1.15, -0.5]}>
          <boxGeometry args={[2.6, 1.5, 0.1]} />
        </mesh>
        {kind === 'fighter' && (
          <>
            {/* Canopy bow, and the frame of the head-up display glass */}
            <mesh material={TRIM} position={[0, -0.32, -0.95]}>
              <torusGeometry args={[0.62, 0.028, 8, 28, Math.PI]} />
            </mesh>
            {[-0.17, 0.17].map(x => (
              <mesh key={x} material={TRIM} position={[x, -0.2, -0.62]}>
                <boxGeometry args={[0.012, 0.32, 0.012]} />
              </mesh>
            ))}
          </>
        )}
        {kind === 'airliner' && (
          <>
            {/* Centre post between the two windscreens, side post, and the roof */}
            <mesh material={TRIM} position={[-eye.x, 0.12, -1.05]} rotation-x={0.5}>
              <boxGeometry args={[0.08, 1.1, 0.08]} />
            </mesh>
            <mesh material={TRIM} position={[-0.8, 0.12, -0.75]} rotation-x={0.4}>
              <boxGeometry args={[0.1, 1.1, 0.1]} />
            </mesh>
            <mesh material={TRIM} position={[-eye.x, 0.56, -0.6]} rotation-x={-0.5}>
              <boxGeometry args={[2.8, 0.1, 0.9]} />
            </mesh>
          </>
        )}
        {kind === 'propeller' && (
          <>
            {/* Engine cowl ahead, door posts, and the wing overhead */}
            <mesh position={[-eye.x, -0.62, -1.7]}>
              <boxGeometry args={[1.05, 0.3, 1.3]} />
              <meshStandardMaterial color="#f3f2ee" roughness={0.5} />
            </mesh>
            {[-0.45, 0.95].map(x => (
              <mesh key={x} material={TRIM} position={[x, 0.05, -0.7]} rotation-x={0.45}>
                <boxGeometry args={[0.06, 1, 0.06]} />
              </mesh>
            ))}
            <mesh material={TRIM} position={[-eye.x, 0.45, -0.3]}>
              <boxGeometry args={[3.2, 0.08, 1.4]} />
            </mesh>
          </>
        )}
      </group>
    </group>
  )
}
