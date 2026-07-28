import { db, mutate } from '../storage/database'
import { DEFAULT_SETTINGS, DEFAULT_SUBTITLE_STYLE } from '@shared/types'
import type { AppSettings, SubtitleStyle } from '@shared/types'
import { clamp } from '@shared/time'

function sanitizeSubtitleStyle(style: Partial<SubtitleStyle>): Partial<SubtitleStyle> {
  const out: Partial<SubtitleStyle> = { ...style }
  if (out.fontSize !== undefined) out.fontSize = clamp(out.fontSize, 10, 96)
  if (out.backgroundOpacity !== undefined) out.backgroundOpacity = clamp(out.backgroundOpacity, 0, 1)
  if (out.outlineWidth !== undefined) out.outlineWidth = clamp(out.outlineWidth, 0, 8)
  if (out.bottomOffset !== undefined) out.bottomOffset = clamp(out.bottomOffset, 0, 60)
  if (out.maxWidth !== undefined) out.maxWidth = clamp(out.maxWidth, 30, 100)
  if (out.lineHeight !== undefined) out.lineHeight = clamp(out.lineHeight, 1, 2.5)
  if (out.delay !== undefined) out.delay = clamp(out.delay, -60, 60)
  return out
}

/** Impede valores fora de faixa vindos da UI. */
function sanitize(patch: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = { ...patch }
  if (out.volume !== undefined) out.volume = clamp(out.volume, 0, 1)
  if (out.playbackRate !== undefined) out.playbackRate = clamp(out.playbackRate, 0.25, 4)
  if (out.seekStep !== undefined) out.seekStep = clamp(out.seekStep, 1, 120)
  if (out.volumeStep !== undefined) out.volumeStep = clamp(out.volumeStep, 0.01, 0.5)
  if (out.defaultNextEpisodeOffset !== undefined) {
    out.defaultNextEpisodeOffset = clamp(out.defaultNextEpisodeOffset, 5, 600)
  }
  if (out.subtitleFontSize !== undefined) out.subtitleFontSize = clamp(out.subtitleFontSize, 12, 64)
  return out
}

export const settingsRepository = {
  get(): AppSettings {
    const stored = db().settings
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      // Estilo pode vir incompleto de versoes antigas do arquivo.
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, ...(stored.subtitleStyle ?? {}) }
    }
  },

  update(patch: Partial<AppSettings>): AppSettings {
    return mutate((state) => {
      const { subtitleStyle, ...rest } = sanitize(patch)
      state.settings = { ...state.settings, ...rest }

      // Merge parcial: a UI envia so os campos alterados.
      if (subtitleStyle) {
        state.settings.subtitleStyle = {
          ...DEFAULT_SUBTITLE_STYLE,
          ...state.settings.subtitleStyle,
          ...sanitizeSubtitleStyle(subtitleStyle)
        }
      }
      return { ...state.settings }
    })
  }
}
