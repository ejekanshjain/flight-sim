import { Vector3 } from 'three'
import { GRAVITY } from '../sim/aircraft'
import type { FlightSim, Ground } from '../sim/flight-sim'
import type { Effects } from './effects'

export type EnemyKind = 'fighter' | 'bomber'

/** Where an enemy appears. Heading is in degrees; a bomber heads for `goal`. */
export type EnemySpawn = {
  kind: EnemyKind
  x: number
  z: number
  altitude: number
  heading: number
  goal?: { x: number; z: number }
}

/** An enemy aircraft, flown by simple rules rather than the full flight model. */
export type Enemy = {
  kind: EnemyKind
  position: Vector3
  velocity: Vector3
  /** Bank in radians, for drawing: right wing down is positive. */
  bank: number
  alive: boolean
  /** Shot down and falling in flames until it reaches the ground or the sea. */
  falling: boolean
  /** Seconds until it may fire again, and missiles it has left. */
  cooldown: number
  shots: number
  /** Seconds left of a break turn away from a missile, and which way it breaks. */
  evading: number
  /** Seconds left before it may start another pass, after flying past the player. */
  extending: number
  breakSide: number
  goal: Vector3 | null
}

/** A heat-seeking missile in flight, from the player or an enemy. */
export type Missile = {
  position: Vector3
  velocity: Vector3
  /** The enemy it homes on, the player, a flare that fooled it, or nothing. */
  target: Enemy | 'player' | Flare | null
  age: number
  fromPlayer: boolean
}

export type Flare = { position: Vector3; velocity: Vector3; age: number }

/** Something worth a sound or a notice. */
export type CombatEvent =
  | { kind: 'launch'; fromPlayer: boolean }
  | { kind: 'kill'; at: Vector3 }
  | { kind: 'wreck'; at: Vector3 }
  | { kind: 'hit' }

const SPEED: Record<EnemyKind, number> = { fighter: 240, bomber: 210 }
// Sustained g a fighter pulls in a turn, and a bomber's gentle limit
const MAX_G: Record<EnemyKind, number> = { fighter: 4.5, bomber: 1.5 }
const SHOTS: Record<EnemyKind, number> = { fighter: 2, bomber: 0 }
// The player's seeker locks within this cone off the nose and this range
export const AIR_LOCK_CONE = 0.3
export const AIR_LOCK_RANGE = 6000
// An enemy fires when the player is this close to its nose and in range
const FIRE_CONE = 0.22
const FIRE_RANGE = 4000
const FIRST_SHOT = 14
const RELOAD = 12
// Missile speed in m/s, the sideways acceleration its fins allow, and its fuse distance.
// Enemy missiles turn less sharply, so a hard break or flares can beat them.
const MISSILE_SPEED = 600
const PLAYER_MISSILE_TURN = 320
const ENEMY_MISSILE_TURN = 190
const MISSILE_LIFE = 14
const FUSE = 15
// A fighter breaks away from a missile within this range, for this long
const BREAK_RANGE = 3500
const BREAK_SECONDS = 4
// Within this distance of the player a fighter has made its pass. It then flies straight for
// EXTEND_STRAIGHT seconds and makes no new pass until EXTEND_SECONDS have gone by.
const MERGE = 1200
const EXTEND_STRAIGHT = 8
const EXTEND_SECONDS = 20
// Flares burn this long, and fool a missile homing on their aircraft with these odds
const FLARE_LIFE = 4
const PLAYER_DECOY = 0.75
const ENEMY_DECOY = 0.5
// Enemies keep at least this far above the ground
const FLOOR = 250
const STEP = 1 / 60
const RAIL = new Vector3(0, -1, 0)

const toTarget = new Vector3()
const wanted = new Vector3()
const lead = new Vector3()
const dir = new Vector3()

/** Turns `velocity` toward `wanted` (a unit vector) by at most `accel * dt` sideways. */
function steer(velocity: Vector3, desired: Vector3, accel: number, dt: number) {
  const speed = velocity.length()
  dir.copy(velocity).divideScalar(speed)
  const angle = dir.angleTo(desired)
  const most = (accel / speed) * dt
  if (angle > 1e-5) dir.lerp(desired, Math.min(1, most / angle)).normalize()
  velocity.copy(dir).multiplyScalar(speed)
  return Math.min(angle, most) / dt
}

/**
 * Air combat: enemy fighters and bombers, the player's heat-seeking missiles and theirs, and
 * flares. Call `update` every frame while flying.
 */
export class AirCombat {
  readonly enemies: Enemy[] = []
  readonly missiles: Missile[] = []
  readonly flares: Flare[] = []
  /** Missiles and flares the player has left. */
  ammo = 0
  flaresLeft = 0
  /** The enemy a missile fired now would home on, or -1. */
  lock = -1
  /** True while an enemy missile homes on the player. */
  warning = false

  load(spawns: EnemySpawn[], missiles: number, flares: number) {
    this.enemies.length = 0
    this.missiles.length = 0
    this.flares.length = 0
    this.ammo = missiles
    this.flaresLeft = flares
    this.lock = -1
    this.warning = false
    for (const spawn of spawns) {
      const heading = (spawn.heading * Math.PI) / 180
      this.enemies.push({
        kind: spawn.kind,
        position: new Vector3(spawn.x, spawn.altitude, spawn.z),
        velocity: new Vector3(Math.sin(heading), 0, -Math.cos(heading)).multiplyScalar(
          SPEED[spawn.kind]
        ),
        bank: 0,
        alive: true,
        falling: false,
        cooldown: FIRST_SHOT,
        shots: SHOTS[spawn.kind],
        evading: 0,
        extending: 0,
        breakSide: 1,
        goal: spawn.goal ? new Vector3(spawn.goal.x, spawn.altitude, spawn.goal.z) : null
      })
    }
  }

  clear() {
    this.load([], 0, 0)
  }

  get active() {
    return this.enemies.length > 0
  }

  /** Enemies shot down so far. */
  get downed() {
    return this.enemies.filter(enemy => !enemy.alive).length
  }

  /** Fires a missile at the locked enemy, or straight ahead without a lock. */
  fire(sim: FlightSim) {
    if (this.ammo <= 0 || sim.onGround) return false
    this.ammo--
    const position = toTarget.copy(RAIL).applyQuaternion(sim.orientation).add(sim.position)
    const forward = dir.set(0, 0, -1).applyQuaternion(sim.orientation)
    this.missiles.push({
      position: position.clone(),
      velocity: sim.velocity.clone().addScaledVector(forward, 30),
      target: this.enemies[this.lock] ?? null,
      age: 0,
      fromPlayer: true
    })
    return true
  }

  /** Drops a pair of flares behind the player. Each may lure away a missile homing on it. */
  dropFlares(sim: FlightSim) {
    if (this.flaresLeft <= 0 || sim.onGround) return false
    this.flaresLeft--
    const flare = this.release(sim.position, sim.velocity)
    for (const missile of this.missiles) {
      if (missile.target === 'player' && Math.random() < PLAYER_DECOY) missile.target = flare
    }
    return true
  }

  /**
   * Moves the enemies, missiles, and flares, and draws their trails. Returns what happened,
   * including a hit on the player.
   */
  update(dt: number, sim: FlightSim, ground: Ground, effects: Effects): CombatEvent[] {
    const events: CombatEvent[] = []
    for (let t = 0; t < dt; t += STEP) {
      const step = Math.min(STEP, dt - t)
      for (const enemy of this.enemies) this.fly(enemy, step, sim, ground, events)
      for (let i = this.missiles.length - 1; i >= 0; i--) {
        if (this.flyMissile(this.missiles[i], step, sim, ground, events)) this.missiles.splice(i, 1)
      }
      for (let i = this.flares.length - 1; i >= 0; i--) {
        const flare = this.flares[i]
        flare.age += step
        flare.velocity.multiplyScalar(Math.exp(-step * 1.5))
        flare.velocity.y -= 3 * step
        flare.position.addScaledVector(flare.velocity, step)
        if (flare.age > FLARE_LIFE) this.flares.splice(i, 1)
      }
    }
    for (const missile of this.missiles) effects.missileTrail(missile.position, dt)
    for (const flare of this.flares) effects.flare(flare.position)
    for (const enemy of this.enemies) if (enemy.falling) effects.engineFire(enemy.position, dt)
    this.warning = this.missiles.some(missile => missile.target === 'player')
    this.updateLock(sim)
    return events
  }

  /** One enemy's step: chase or head for its goal, break from missiles, and fire. */
  private fly(enemy: Enemy, dt: number, sim: FlightSim, ground: Ground, events: CombatEvent[]) {
    const { position, velocity } = enemy
    if (enemy.falling) {
      velocity.multiplyScalar(Math.exp(-dt * 0.3))
      velocity.y -= GRAVITY * dt
      position.addScaledVector(velocity, dt)
      enemy.bank += dt * 1.5
      if (position.y <= Math.max(ground.heightAt(position.x, position.z), 0)) {
        enemy.falling = false
        events.push({ kind: 'wreck', at: position.clone() })
      }
      return
    }
    if (!enemy.alive) return
    enemy.cooldown -= dt
    enemy.evading = Math.max(0, enemy.evading - dt)
    enemy.extending = Math.max(0, enemy.extending - dt)
    toTarget.copy(sim.position).sub(position)
    const distance = toTarget.length()
    // After a close pass it flies straight on for a while, then turns back for another run
    if (distance < MERGE && enemy.extending === 0 && !enemy.goal) enemy.extending = EXTEND_SECONDS
    if (enemy.goal) {
      // A bomber flies level and straight for its goal
      wanted.copy(enemy.goal).sub(position).setY(0).normalize()
    } else if (enemy.extending > EXTEND_SECONDS - EXTEND_STRAIGHT) {
      wanted.copy(velocity).setY(0).normalize()
    } else if (enemy.evading > 0) {
      // Break turn: hard across the missile's path and a little down
      wanted
        .set(-velocity.z * enemy.breakSide, -0.15 * velocity.length(), velocity.x * enemy.breakSide)
        .normalize()
    } else {
      // Lead pursuit: aim where the player will be by the time it gets there
      const seconds = Math.min(3, distance / SPEED[enemy.kind])
      wanted
        .copy(lead.copy(sim.position).addScaledVector(sim.velocity, seconds))
        .sub(position)
        .normalize()
    }
    const floor = Math.max(ground.heightAt(position.x, position.z), 0) + FLOOR
    if (position.y < floor) wanted.y = Math.max(wanted.y, 0.35)
    wanted.normalize()
    const sideways = wanted.x * velocity.z - wanted.z * velocity.x
    const rate = steer(velocity, wanted, MAX_G[enemy.kind] * GRAVITY, dt)
    const bank = Math.atan2(rate * velocity.length(), GRAVITY) * (sideways > 0 ? -1 : 1)
    enemy.bank += (bank - enemy.bank) * Math.min(1, dt * 3)
    position.addScaledVector(velocity, dt)
    // Fire when the player sits ahead and in range
    const offNose = dir.copy(velocity).normalize().angleTo(toTarget)
    if (enemy.shots > 0 && enemy.cooldown <= 0 && distance < FIRE_RANGE && offNose < FIRE_CONE) {
      enemy.shots--
      enemy.cooldown = RELOAD
      this.missiles.push({
        position: position.clone(),
        velocity: velocity.clone(),
        target: 'player',
        age: 0,
        fromPlayer: false
      })
      events.push({ kind: 'launch', fromPlayer: false })
    }
  }

  /** One missile's step. Returns true once it is gone: a hit, a miss, or burnt out. */
  private flyMissile(
    missile: Missile,
    dt: number,
    sim: FlightSim,
    ground: Ground,
    events: CombatEvent[]
  ) {
    missile.age += dt
    if (missile.age > MISSILE_LIFE) return true
    const { position, velocity, target } = missile
    const speed = Math.min(MISSILE_SPEED, velocity.length() + 250 * dt)
    velocity.setLength(speed)
    // Where the target is, and how fast it moves, if it still flies
    let aim: Vector3 | null = null
    let aimVelocity: Vector3 | null = null
    if (target === 'player') {
      aim = sim.position
      aimVelocity = sim.velocity
    } else if (target && 'alive' in target) {
      if (target.alive) {
        aim = target.position
        aimVelocity = target.velocity
      }
    } else if (target && target.age < FLARE_LIFE) {
      aim = target.position
      aimVelocity = target.velocity
    }
    if (aim && aimVelocity) {
      const distance = toTarget.copy(aim).sub(position).length()
      if (distance < FUSE) return this.detonate(missile, events)
      // Aim ahead of the target by the time to close the gap
      const closing = Math.max(50, speed - aimVelocity.dot(toTarget.normalize()))
      lead
        .copy(aim)
        .addScaledVector(aimVelocity, distance / closing)
        .sub(position)
        .normalize()
      // A missile fired from behind and passed by its target loses it
      if (dir.copy(velocity).normalize().angleTo(lead) > 1.4) missile.target = null
      else steer(velocity, lead, missile.fromPlayer ? PLAYER_MISSILE_TURN : ENEMY_MISSILE_TURN, dt)
    }
    position.addScaledVector(velocity, dt)
    return position.y <= Math.max(ground.heightAt(position.x, position.z), 0)
  }

  /** A missile bursts by its target: an enemy goes down in flames, or the player is hit. */
  private detonate(missile: Missile, events: CombatEvent[]) {
    const { target } = missile
    if (target === 'player') events.push({ kind: 'hit' })
    else if (target && 'alive' in target) {
      target.alive = false
      target.falling = true
      events.push({ kind: 'kill', at: target.position.clone() })
    }
    return true
  }

  /** Flares from an aircraft, falling behind it and burning bright. */
  private release(position: Vector3, velocity: Vector3) {
    const flare = {
      position: position.clone(),
      velocity: velocity.clone().multiplyScalar(0.4),
      age: 0
    }
    flare.velocity.y -= 10
    this.flares.push(flare)
    return flare
  }

  /**
   * The live enemy nearest the nose within the seeker's cone and range, or -1. Fighters
   * also break away from a missile homing on them, dropping flares as they go.
   */
  private updateLock(sim: FlightSim) {
    this.lock = -1
    const forward = dir.set(0, 0, -1).applyQuaternion(sim.orientation)
    let best = AIR_LOCK_CONE
    this.enemies.forEach((enemy, i) => {
      if (!enemy.alive) return
      toTarget.copy(enemy.position).sub(sim.position)
      // The seeker moves on from an enemy that already has a missile on its way
      const engaged = this.missiles.some(missile => missile.target === enemy)
      if (!engaged && toTarget.length() <= AIR_LOCK_RANGE && this.ammo > 0) {
        const off = forward.angleTo(toTarget)
        if (off < best) {
          best = off
          this.lock = i
        }
      }
      if (enemy.kind !== 'fighter' || enemy.evading > 0) return
      for (const missile of this.missiles) {
        if (missile.target !== enemy) continue
        if (missile.position.distanceTo(enemy.position) > BREAK_RANGE) continue
        enemy.evading = BREAK_SECONDS
        enemy.breakSide = Math.random() < 0.5 ? -1 : 1
        const flare = this.release(enemy.position, enemy.velocity)
        if (Math.random() < ENEMY_DECOY) missile.target = flare
      }
    })
  }
}

/**
 * Advice for the fight: a missile warning first, then a lock, then which way to turn for the
 * nearest enemy. Keys sit in square brackets.
 */
export function combatAdvice(combat: AirCombat, sim: FlightSim): string | null {
  if (!combat.active || sim.onGround) return null
  if (combat.warning) return 'Missile! Press [Space] for flares and turn hard across its path.'
  const name = (enemy: Enemy) => (enemy.kind === 'bomber' ? 'bomber' : 'fighter')
  const locked = combat.enemies[combat.lock]
  if (locked) {
    const km = (locked.position.distanceTo(sim.position) / 1000).toFixed(1)
    return `Locked on the ${name(locked)}, ${km} km: press [Enter] to fire.`
  }
  if (combat.ammo <= 0) {
    return combat.missiles.some(missile => missile.fromPlayer) ? 'Missile away.' : null
  }
  let nearest: Enemy | null = null
  for (const enemy of combat.enemies) {
    if (!enemy.alive) continue
    if (
      !nearest ||
      enemy.position.distanceTo(sim.position) < nearest.position.distanceTo(sim.position)
    ) {
      nearest = enemy
    }
  }
  if (!nearest) return null
  const x = nearest.position.x - sim.position.x
  const z = nearest.position.z - sim.position.z
  const across = Math.hypot(x, z)
  const km = (Math.hypot(across, nearest.position.y - sim.position.y) / 1000).toFixed(1)
  const bearing = Math.atan2(x, -z) - sim.heading
  const turn = Math.atan2(Math.sin(bearing), Math.cos(bearing)) * (180 / Math.PI)
  if (Math.abs(turn) > 15) {
    return `Turn ${Math.round(Math.abs(turn))}° ${turn > 0 ? 'right' : 'left'} for the nearest ${name(nearest)}, ${km} km.`
  }
  const climb =
    (Math.atan2(nearest.position.y - sim.position.y, across) - sim.pitch) * (180 / Math.PI)
  if (Math.abs(climb) > 12) {
    return `${climb > 0 ? 'Pull the nose up' : 'Push the nose down'} ${Math.round(Math.abs(climb))}° toward the ${name(nearest)}, ${km} km.`
  }
  return `The ${name(nearest)} is ahead, ${km} km. It locks within ${AIR_LOCK_RANGE / 1000} km.`
}
