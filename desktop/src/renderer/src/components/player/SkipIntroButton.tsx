import { FastForward } from 'lucide-react'
import { usePlayerStore } from '@/store/player.store'

/**
 * Botao estilo Netflix. Visivel apenas entre `introStart` e `introEnd`;
 * o clique leva para `introSkipTo` (ou para o fim da abertura).
 */
export function SkipIntroButton(): JSX.Element | null {
  const video = usePlayerStore((s) => s.video)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const skipIntro = usePlayerStore((s) => s.skipIntro)

  if (!video || video.introStart === null || video.introEnd === null) return null
  if (currentTime < video.introStart || currentTime > video.introEnd) return null

  return (
    <button className="skip-intro" onClick={skipIntro} title="Pular abertura (S)">
      <FastForward size={18} />
      Pular abertura
    </button>
  )
}
