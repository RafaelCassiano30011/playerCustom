import {
  Gauge,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Subtitles,
  AudioLines
} from 'lucide-react'
import { clamp, formatTime } from '@shared/time'
import type { EmbeddedTrackInfo } from '@shared/types'
import { usePlayerStore } from '@/store/player.store'
import { useSettingsStore } from '@/store/settings.store'
import { hasIntroConfig } from '@/lib/media'
import { SeekBar } from './SeekBar'
import { VolumeControl } from './VolumeControl'
import { MenuItem, PlayerMenu } from './PlayerMenu'

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function trackLabel(track: EmbeddedTrackInfo, fallbackIndex: number): string {
  const language = track.language ? track.language.toUpperCase() : null
  if (track.title && language) return `${track.title} (${language})`
  if (track.title) return track.title
  if (language) return language
  return `Faixa ${fallbackIndex + 1} (${track.codec})`
}

interface PlayerControlsProps {
  visible: boolean
  onOpenVideoSettings: () => void
}

export function PlayerControls({
  visible,
  onOpenVideoSettings
}: PlayerControlsProps): JSX.Element | null {
  const video = usePlayerStore((s) => s.video)
  const playing = usePlayerStore((s) => s.playing)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const buffered = usePlayerStore((s) => s.buffered)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const rate = usePlayerStore((s) => s.rate)
  const fullscreen = usePlayerStore((s) => s.fullscreen)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeat = usePlayerStore((s) => s.repeat)
  const subtitle = usePlayerStore((s) => s.subtitle)
  const subtitlesEnabled = usePlayerStore((s) => s.subtitlesEnabled)
  const embeddedTracks = usePlayerStore((s) => s.embeddedTracks)
  const activeEmbeddedAudioIndex = usePlayerStore((s) => s.activeEmbeddedAudioIndex)
  const activeEmbeddedSubtitleIndex = usePlayerStore((s) => s.activeEmbeddedSubtitleIndex)
  const audioTrackIndex = usePlayerStore((s) => s.audioTrackIndex)
  const extractingSubtitle = usePlayerStore((s) => s.extractingSubtitle)
  const queue = usePlayerStore((s) => s.queue)

  const store = usePlayerStore.getState.bind(usePlayerStore)

  // Ajustes rapidos sem sair do player; a tela de configuracoes tem o resto.
  const bumpSubtitleSize = (delta: number): void => {
    const settings = useSettingsStore.getState()
    const current = settings.settings.subtitleStyle
    void settings.patch({
      subtitleStyle: { ...current, fontSize: clamp(current.fontSize + delta, 10, 72) }
    })
  }
  const bumpSubtitleDelay = (delta: number): void => {
    const settings = useSettingsStore.getState()
    const current = settings.settings.subtitleStyle
    void settings.patch({
      subtitleStyle: {
        ...current,
        delay: Number(clamp(current.delay + delta, -60, 60).toFixed(1))
      }
    })
  }

  if (!video) return null

  const index = queue.findIndex((v) => v.id === video.id)
  const canPrevious = queue.length > 0
  const canNext = index >= 0 && (index < queue.length - 1 || repeat === 'all' || shuffle)

  const intro = hasIntroConfig(video)
    ? { start: video.introStart as number, end: video.introEnd as number }
    : null

  return (
    <div className={`controls${visible ? '' : ' controls--hidden'}`}>
      <SeekBar
        currentTime={currentTime}
        duration={duration}
        buffered={buffered}
        intro={intro}
        onSeek={(time) => store().seek(time)}
      />

      <div className="controls__row">
        <button
          className="icon-btn controls__play"
          onClick={() => store().togglePlay()}
          aria-label={playing ? 'Pausar' : 'Reproduzir'}
          title="Reproduzir/pausar (Espaco)"
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>

        <button
          className="icon-btn"
          onClick={() => void store().playPrevious()}
          disabled={!canPrevious}
          aria-label="Anterior"
          title="Anterior (P)"
        >
          <SkipBack size={19} />
        </button>

        <button
          className="icon-btn"
          onClick={() => void store().playNext('user')}
          disabled={!canNext}
          aria-label="Proximo"
          title="Proximo (N)"
        >
          <SkipForward size={19} />
        </button>

        <VolumeControl
          volume={volume}
          muted={muted}
          onChange={(value) => store().setVolume(value)}
          onToggleMute={() => store().toggleMute()}
        />

        <span className="controls__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <span className="controls__title">{video.name}</span>
        <span className="controls__spacer" />

        <button
          className={`icon-btn${shuffle ? ' icon-btn--active' : ''}`}
          onClick={() => store().toggleShuffle()}
          aria-label="Modo aleatorio"
          title="Aleatorio"
        >
          <Shuffle size={18} />
        </button>

        <button
          className={`icon-btn${repeat !== 'off' ? ' icon-btn--active' : ''}`}
          onClick={() => store().cycleRepeat()}
          aria-label="Modo repetir"
          title={
            repeat === 'off' ? 'Repetir: desligado' : repeat === 'all' ? 'Repetir: colecao' : 'Repetir: video'
          }
        >
          {repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
        </button>

        <PlayerMenu icon={<Gauge size={18} />} label="Velocidade" active={rate !== 1}>
          {(close) => (
            <>
              <div className="menu__label">Velocidade</div>
              {RATES.map((value) => (
                <MenuItem
                  key={value}
                  label={value === 1 ? 'Normal (1x)' : `${value}x`}
                  active={rate === value}
                  onClick={() => {
                    store().setRate(value)
                    close()
                  }}
                />
              ))}
            </>
          )}
        </PlayerMenu>

        <PlayerMenu
          icon={<Subtitles size={18} />}
          label="Legendas"
          active={Boolean(subtitle) && subtitlesEnabled}
        >
          {(close) => (
            <>
              <div className="menu__label">Legendas</div>
              <MenuItem
                label={subtitlesEnabled ? 'Desativar' : 'Ativar'}
                active={subtitlesEnabled}
                hint="V"
                onClick={() => {
                  store().toggleSubtitles()
                  close()
                }}
              />
              <MenuItem
                label="Carregar arquivo .srt"
                onClick={() => {
                  void window.api.dialog.pickSubtitle().then((path) => {
                    if (path) void store().loadSubtitle(path)
                  })
                  close()
                }}
              />
              {subtitle && (
                <MenuItem
                  label={`Remover: ${subtitle.label}`}
                  onClick={() => {
                    store().clearSubtitle()
                    close()
                  }}
                />
              )}
              <div className="menu__label">Aparencia</div>
              <MenuItem
                label="Aumentar tamanho"
                onClick={() => bumpSubtitleSize(2)}
              />
              <MenuItem
                label="Diminuir tamanho"
                onClick={() => bumpSubtitleSize(-2)}
              />
              <MenuItem label="Atrasar 0,5s" onClick={() => bumpSubtitleDelay(0.5)} />
              <MenuItem label="Adiantar 0,5s" onClick={() => bumpSubtitleDelay(-0.5)} />
              {embeddedTracks.subtitle.length > 0 && (
                <>
                  <div className="menu__label">Legendas do arquivo (MKV)</div>
                  {embeddedTracks.subtitle.map((track, i) => (
                    <MenuItem
                      key={track.index}
                      label={trackLabel(track, i)}
                      active={activeEmbeddedSubtitleIndex === track.index}
                      hint={extractingSubtitle && activeEmbeddedSubtitleIndex === track.index ? '...' : undefined}
                      onClick={() => {
                        void store().selectEmbeddedSubtitleTrack(track)
                        close()
                      }}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </PlayerMenu>

        {embeddedTracks.audio.length > 1 && (
          <PlayerMenu
            icon={<AudioLines size={18} />}
            label="Faixas de audio"
            active={audioTrackIndex !== null}
          >
            {(close) => (
              <>
                <div className="menu__label">Audio</div>
                <MenuItem
                  label="Padrao do arquivo"
                  active={audioTrackIndex === null}
                  onClick={() => {
                    store().resetAudioTrack()
                    close()
                  }}
                />
                {embeddedTracks.audio.map((track, i) => (
                  <MenuItem
                    key={track.index}
                    label={trackLabel(track, i)}
                    active={activeEmbeddedAudioIndex === track.index}
                    hint={track.codec}
                    onClick={() => {
                      store().selectEmbeddedAudioTrack(track)
                      close()
                    }}
                  />
                ))}
              </>
            )}
          </PlayerMenu>
        )}

        <button
          className="icon-btn"
          onClick={onOpenVideoSettings}
          aria-label="Configuracoes do video"
          title="Abertura e proximo episodio"
        >
          <Settings2 size={18} />
        </button>

        <button
          className="icon-btn"
          onClick={() => void store().toggleFullscreen()}
          aria-label="Tela cheia"
          title="Tela cheia (F)"
        >
          {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
        </button>
      </div>
    </div>
  )
}
