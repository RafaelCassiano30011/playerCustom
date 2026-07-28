import { useEffect } from 'react'
import { usePlayerStore } from '@/store/player.store'
import { useSettingsStore } from '@/store/settings.store'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export interface ShortcutFlash {
  (message: string): void
}

/**
 * Atalhos globais no estilo VLC. Desativados enquanto o foco esta em campos
 * de texto ou enquanto um modal esta aberto (`blocked`).
 */
export function useKeyboardShortcuts(flash: ShortcutFlash, blocked = false): void {
  useEffect(() => {
    if (blocked) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return

      const player = usePlayerStore.getState()
      const { seekStep, volumeStep } = useSettingsStore.getState().settings
      const hasVideo = Boolean(player.video)
      const key = event.key

      const handled = (): void => {
        event.preventDefault()
        event.stopPropagation()
      }

      // Numeros: pula para a porcentagem correspondente da duracao.
      if (hasVideo && /^[0-9]$/.test(key) && !event.ctrlKey && !event.altKey) {
        handled()
        const ratio = Number(key) / 10
        player.seek(player.duration * ratio)
        flash(`${Number(key) * 10}%`)
        return
      }

      switch (key) {
        case ' ':
        case 'k':
        case 'K':
          if (!hasVideo) return
          handled()
          player.togglePlay()
          flash(player.playing ? 'Pausado' : 'Reproduzindo')
          break

        case 'ArrowRight':
        case 'l':
        case 'L': {
          if (!hasVideo) return
          handled()
          const step = event.shiftKey ? 60 : event.ctrlKey ? 3 : seekStep
          player.seekBy(step)
          flash(`+${step}s`)
          break
        }

        case 'ArrowLeft':
        case 'j':
        case 'J': {
          if (!hasVideo) return
          handled()
          const step = event.shiftKey ? 60 : event.ctrlKey ? 3 : seekStep
          player.seekBy(-step)
          flash(`-${step}s`)
          break
        }

        case 'ArrowUp':
          if (!hasVideo) return
          handled()
          player.bumpVolume(volumeStep)
          flash(`Volume ${Math.round(usePlayerStore.getState().volume * 100)}%`)
          break

        case 'ArrowDown':
          if (!hasVideo) return
          handled()
          player.bumpVolume(-volumeStep)
          flash(`Volume ${Math.round(usePlayerStore.getState().volume * 100)}%`)
          break

        case 'm':
        case 'M':
          if (!hasVideo) return
          handled()
          player.toggleMute()
          flash(usePlayerStore.getState().muted ? 'Mudo' : 'Som ligado')
          break

        case 'f':
        case 'F':
          if (!hasVideo) return
          handled()
          void player.toggleFullscreen()
          break

        case 'Escape':
          if (player.fullscreen) {
            handled()
            void player.setFullscreen(false)
          }
          break

        case 'n':
        case 'N':
          if (!hasVideo) return
          handled()
          void player.playNext('user')
          break

        case 'p':
        case 'P':
          if (!hasVideo) return
          handled()
          void player.playPrevious()
          break

        case ']':
        case '>':
          if (!hasVideo) return
          handled()
          player.bumpRate(0.25)
          flash(`${usePlayerStore.getState().rate}x`)
          break

        case '[':
        case '<':
          if (!hasVideo) return
          handled()
          player.bumpRate(-0.25)
          flash(`${usePlayerStore.getState().rate}x`)
          break

        case '=':
          if (!hasVideo) return
          handled()
          player.setRate(1)
          flash('1x')
          break

        case 's':
        case 'S': {
          if (!hasVideo) return
          const video = player.video
          if (!video || video.introStart === null) return
          handled()
          player.skipIntro()
          flash('Abertura pulada')
          break
        }

        case 'v':
        case 'V':
          if (!hasVideo) return
          handled()
          player.toggleSubtitles()
          flash(
            usePlayerStore.getState().subtitlesEnabled ? 'Legendas ligadas' : 'Legendas desligadas'
          )
          break

        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [flash, blocked])
}

export const SHORTCUTS: Array<[string, string]> = [
  ['Espaco / K', 'Reproduzir ou pausar'],
  ['J / seta esquerda', 'Retroceder'],
  ['L / seta direita', 'Avancar'],
  ['Shift + setas', 'Pular 60s'],
  ['Ctrl + setas', 'Pular 3s'],
  ['Setas cima/baixo', 'Volume'],
  ['M', 'Mudo'],
  ['F', 'Tela cheia'],
  ['Esc', 'Sair da tela cheia'],
  ['N / P', 'Proximo / anterior'],
  ['[ e ]', 'Velocidade'],
  ['=', 'Velocidade normal'],
  ['0-9', 'Pular para % do video'],
  ['S', 'Pular abertura'],
  ['V', 'Alternar legendas']
]
