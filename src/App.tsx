import { useEffect } from 'react'
import { game, useGame } from './game/game'
import { Scene } from './scene/Scene'
import { Hud } from './ui/Hud'
import { Menu } from './ui/Menu'
import { PhotoHint } from './ui/PhotoHint'

export function App() {
  useEffect(() => game.attach(), [])
  // Photo mode hides the panels without unmounting them, so they come back as they were
  const photo = useGame(state => state.photo)
  return (
    <main className="relative h-full overflow-hidden font-sans select-none">
      <Scene />
      <div className={photo ? 'hidden' : 'contents'}>
        <Hud />
      </div>
      <PhotoHint />
      <Menu />
      {/* Phones and tablets fly held sideways */}
      <div className="bg-ink text-paper absolute inset-0 z-50 hidden flex-col items-center justify-center gap-2 p-8 text-center [@media(pointer:coarse)_and_(orientation:portrait)]:flex">
        <h2 className="text-2xl font-bold">Turn Sideways to Fly</h2>
        <p className="max-w-xs text-lg leading-snug">
          Hold your phone or tablet in landscape for the sticks and the full view.
        </p>
      </div>
    </main>
  )
}
