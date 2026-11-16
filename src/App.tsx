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
    <main className="relative h-full font-sans select-none">
      <Scene />
      <div className={photo ? 'hidden' : 'contents'}>
        <Hud />
      </div>
      <PhotoHint />
      <Menu />
    </main>
  )
}
