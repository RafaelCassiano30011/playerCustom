import { useEffect, useRef, useState } from 'react'
import { Play, X } from 'lucide-react'
import { usePlayerStore } from '@/store/player.store'
import { useSettingsStore } from '@/store/settings.store'
import { nextEpisodeThreshold } from '@/lib/media'

const COUNTDOWN_SECONDS = 15

/**
 * Aviso estilo Netflix: aparece perto do fim do episodio, com contagem
 * regressiva que dispara o proximo video automaticamente se ignorado.
 */
export function NextEpisodeButton(): JSX.Element | null {
  const video = usePlayerStore((s) => s.video)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const queue = usePlayerStore((s) => s.queue)
  const autoPlayNext = usePlayerStore((s) => s.autoPlayNext)
  const nextDismissed = usePlayerStore((s) => s.nextDismissed)
  const dismissNext = usePlayerStore((s) => s.dismissNext)
  const playNext = usePlayerStore((s) => s.playNext)
  const defaultOffset = useSettingsStore((s) => s.settings.defaultNextEpisodeOffset)

  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)
  const firedRef = useRef(false)

  const threshold = video ? nextEpisodeThreshold(video, defaultOffset) : null
  const index = video ? queue.findIndex((v) => v.id === video.id) : -1
  const upcoming = index >= 0 ? queue[index + 1] : undefined
  const isLast = !upcoming && queue.length > 0 && index === queue.length - 1

  const visible =
    Boolean(video) &&
    threshold !== null &&
    currentTime >= threshold &&
    duration - currentTime > 0.4 &&
    !nextDismissed &&
    !isLast &&
    Boolean(upcoming)

  useEffect(() => {
    if (!visible) {
      setRemaining(COUNTDOWN_SECONDS)
      firedRef.current = false
      return
    }
    if (!autoPlayNext) return

    setRemaining(COUNTDOWN_SECONDS)
    firedRef.current = false
    const start = Date.now()
    const timer = setInterval(() => {
      const left = Math.max(0, COUNTDOWN_SECONDS - Math.floor((Date.now() - start) / 1000))
      setRemaining(left)
      if (left === 0 && !firedRef.current) {
        firedRef.current = true
        void playNext('auto')
      }
    }, 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, video?.id, autoPlayNext])

  if (!visible || !upcoming) return null

  const progress = autoPlayNext ? ((COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS) * 100 : 0

  return (
    <div className="next-episode">
      <div className="next-episode__info">
        <span className="next-episode__label">Proximo episodio</span>
        <span className="next-episode__name">{upcoming.name}</span>
      </div>
      <button className="next-episode__play" onClick={() => void playNext('user')}>
        {autoPlayNext && <span className="next-episode__fill" style={{ width: `${progress}%` }} />}
        <Play size={16} />
        <span>{autoPlayNext ? `Reproduzir (${remaining})` : 'Reproduzir'}</span>
      </button>
      <button className="icon-btn" onClick={dismissNext} aria-label="Fechar aviso">
        <X size={16} />
      </button>
    </div>
  )
}
