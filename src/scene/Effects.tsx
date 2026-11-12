import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Mesh, type PointLight } from 'three'
import { game } from '../game/game'
import { billboardMaterial, makeBillboards } from './billboards'

// Floats per particle in Effects.data
const STRIDE = 20
const CAPACITY = 4000

/** Draws the particle pool as soft sprites and lights the scene during an explosion. */
export function Effects() {
  const light = useRef<PointLight>(null)
  const uploaded = useRef(0)
  const sprites = useMemo(() => makeBillboards(CAPACITY, true), [])
  const mesh = useMemo(() => {
    const particles = new Mesh(sprites.geometry, billboardMaterial(0.5, 4))
    particles.frustumCulled = false
    particles.renderOrder = 3
    return particles
  }, [sprites])

  useFrame(() => {
    const { effects } = game
    const d = effects.data
    const center = sprites.center.array
    const info = sprites.info.array
    const tint = sprites.tint.array
    for (let i = 0; i < effects.count; i++) {
      const o = i * STRIDE
      const age = d[o + 6] / d[o + 7]
      const grow = 1 - (1 - age) * (1 - age)
      center[i * 3] = d[o]
      center[i * 3 + 1] = d[o + 1]
      center[i * 3 + 2] = d[o + 2]
      info[i * 4] = d[o + 8] + (d[o + 9] - d[o + 8]) * grow
      // Lifetime differs per particle, so it doubles as a stable random rotation
      info[i * 4 + 1] = d[o + 7] * 97
      // Fade in over the first tenth of the life, then fade out
      info[i * 4 + 2] = d[o + 16] * Math.min(1, age * 10) * (1 - age) ** 1.5
      info[i * 4 + 3] = d[o + 17]
      tint[i * 3] = d[o + 10] + (d[o + 13] - d[o + 10]) * age
      tint[i * 3 + 1] = d[o + 11] + (d[o + 14] - d[o + 11]) * age
      tint[i * 3 + 2] = d[o + 12] + (d[o + 15] - d[o + 12]) * age
    }
    sprites.geometry.instanceCount = effects.count
    // Upload only the live sprites, and nothing at all while the pool stays empty
    if (effects.count > 0 || uploaded.current > 0) {
      for (const [attribute, size] of [
        [sprites.center, 3],
        [sprites.info, 4],
        [sprites.tint, 3]
      ] as const) {
        attribute.clearUpdateRanges()
        attribute.addUpdateRange(0, Math.max(1, effects.count) * size)
        attribute.needsUpdate = true
      }
    }
    uploaded.current = effects.count

    if (light.current) {
      light.current.position.copy(effects.flashPosition)
      light.current.intensity = effects.flash * 3500
    }
  })

  return (
    <>
      <primitive object={mesh} />
      {/* Always in the scene, so the blast never forces the materials to rebuild */}
      <pointLight ref={light} color="#ff8a3c" intensity={0} decay={2} />
    </>
  )
}
