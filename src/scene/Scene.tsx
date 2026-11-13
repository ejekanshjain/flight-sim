import { Canvas, useFrame } from '@react-three/fiber'
import { game, useGame } from '../game/game'
import { Aircraft } from './Aircraft'
import { Airports } from './Airports'
import { FOG_DENSITY, HORIZON_COLOR } from './atmosphere'
import { CameraRig } from './CameraRig'
import { Effects } from './Effects'
import { MissionGates } from './MissionGates'
import { AircraftLights, LandingLight, TownLights } from './NightLights'
import { ApproachPath, RunwayLights } from './RunwayLights'
import { Balloons, Birds, Boats, Cities, Lighthouse, Roads, Villages } from './Scenery'
import { TrafficAircraft } from './Traffic'
import { CloudDeck, Environment, Rain } from './Weather'
import { Clouds, Lights, Sea, Sky, Terrain, Trees } from './World'

/** Steps the flight model before anything else reads it this frame. */
function Simulation() {
  useFrame((_, delta) => game.frame(delta), -1)
  return null
}

export function Scene() {
  // The faster setting drops shadows and extra pixels on high-density screens
  const detailed = useGame(state => state.quality === 'high')
  return (
    <Canvas
      shadows={detailed}
      dpr={detailed ? [1, 2] : 1}
      camera={{ fov: 58, near: 1, far: 60_000 }}
      // Depth precision spread evenly from 1 m to 60 km, so the sea and gently sloping
      // beaches far away stay apart instead of flickering through each other
      gl={{ logarithmicDepthBuffer: true }}
    >
      <color attach="background" args={[HORIZON_COLOR]} />
      <fogExp2 attach="fog" args={[HORIZON_COLOR, FOG_DENSITY]} />
      <Simulation />
      <Environment />
      <CameraRig />
      <Sky />
      <Lights />
      <Terrain />
      <Sea />
      <Airports />
      <RunwayLights />
      <TownLights />
      <AircraftLights />
      <LandingLight />
      <ApproachPath />
      <MissionGates />
      <Trees />
      <Villages />
      <Cities />
      <Roads />
      <Lighthouse />
      <Boats />
      <Balloons />
      <Birds />
      <Clouds />
      <CloudDeck />
      <Rain />
      <TrafficAircraft />
      <Aircraft />
      <Effects />
    </Canvas>
  )
}
