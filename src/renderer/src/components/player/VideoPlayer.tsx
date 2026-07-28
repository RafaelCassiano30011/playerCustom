import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Film, Loader2 } from 'lucide-react'
import { usePlayerStore } from '@/store/player.store'
import type { AudioTrackInfo } from '@/store/player.store'
import { PlayerControls } from './PlayerControls'
import { SkipIntroButton } from './SkipIntroButton'
import { NextEpisodeButton } from './NextEpisodeButton'
import { SubtitleOverlay } from './SubtitleOverlay'
import { CenterFlash, flashCenter } from './CenterFlash'
import { VideoSettingsModal } from './VideoSettingsModal'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

const IDLE_DELAY_MS = 2600

function readAudioTracks(el: HTMLVideoElement): AudioTrackInfo[] {
  const tracks = (el as unknown as { audioTracks?: ArrayLike<Record<string, unknown>> }).audioTracks
  if (!tracks || tracks.length <= 1) return []
  return Array.from(tracks as ArrayLike<Record<string, unknown>>).map((track, index) => ({
    id: String(track.id ?? index),
    label: String(track.label || track.language || `Faixa ${index + 1}`),
    enabled: Boolean(track.enabled)
  }))
}

export function VideoPlayer(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const [controlsVisible, setControlsVisible] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const video = usePlayerStore((s) => s.video)
  const status = usePlayerStore((s) => s.status)
  const error = usePlayerStore((s) => s.error)
  const playing = usePlayerStore((s) => s.playing)
  const fullscreen = usePlayerStore((s) => s.fullscreen)

  const attach = usePlayerStore((s) => s.attach)
  const onTimeUpdate = usePlayerStore((s) => s.onTimeUpdate)
  const onLoadedMetadata = usePlayerStore((s) => s.onLoadedMetadata)
  const onEnded = usePlayerStore((s) => s.onEnded)
  const onError = usePlayerStore((s) => s.onError)
  const onPlayingChange = usePlayerStore((s) => s.onPlayingChange)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const persistProgress = usePlayerStore((s) => s.persistProgress)

  useEffect(() => {
    attach(videoRef.current)
    return () => attach(null)
  }, [attach])

  // Salva progresso periodicamente mesmo sem novos timeupdate (ex.: pausado parado).
  useEffect(() => {
    const timer = setInterval(() => void persistProgress(), 10000)
    const onBeforeUnload = (): void => void persistProgress(true)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [persistProgress])

  const resetIdle = useCallback(() => {
    setControlsVisible(true)
    if (idleTimer.current) clearTimeout(idleTimer.current)
    if (!playing) return
    idleTimer.current = setTimeout(() => setControlsVisible(false), IDLE_DELAY_MS)
  }, [playing])

  useEffect(() => {
    resetIdle()
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [resetIdle, playing])

  const flash = useCallback((message: string) => flashCenter(message), [])
  useKeyboardShortcuts(flash, settingsOpen)

  const handlePointerActivity = (): void => resetIdle()

  const handleDoubleClick = (): void => {
    void usePlayerStore.getState().toggleFullscreen()
  }

  const handleStageClick = (event: React.MouseEvent): void => {
    if (event.detail > 1) return // double click cuida da tela cheia
    togglePlay()
  }

  if (!video) {
    return (
      <div className="player">
        <div className="player__stage">
          <div className="player__placeholder">
            <Film size={40} />
            <span>Selecione um video na lista ao lado para comecar.</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`player${!controlsVisible && playing ? ' player--idle-cursor' : ''}`}
      onMouseMove={handlePointerActivity}
      onPointerDown={handlePointerActivity}
    >
      <div className="player__stage" ref={stageRef} onDoubleClick={handleDoubleClick}>
        <video
          ref={videoRef}
          className="player__video"
          onClick={handleStageClick}
          onTimeUpdate={(e) => {
            const el = e.currentTarget
            const buffered = el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : 0
            onTimeUpdate(el.currentTime, buffered)
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget
            onLoadedMetadata(el.duration, readAudioTracks(el))
          }}
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
          onEnded={onEnded}
          onError={() => onError('Nao foi possivel reproduzir este arquivo. Formato pode nao ser suportado.')}
          onWaiting={() => undefined}
          playsInline
        />

        {status === 'loading' && (
          <div className="player__spinner">
            <Loader2 size={40} className="spinner" style={{ border: 'none' }} />
          </div>
        )}

        {status === 'error' && error && (
          <div className="player__error">
            <AlertTriangle size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {error}
          </div>
        )}

        <SubtitleOverlay raised={controlsVisible} />
        <SkipIntroButton />
        <NextEpisodeButton />
        <CenterFlash />
      </div>

      <PlayerControls
        visible={controlsVisible || !playing}
        onOpenVideoSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && video && (
        <VideoSettingsModal video={video} onClose={() => setSettingsOpen(false)} />
      )}

      {fullscreen === false && null}
    </div>
  )
}
