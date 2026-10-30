import { useMemo, type CSSProperties } from 'react'
import type { SubtitleStyle } from '@shared/types'
import { usePlayerStore } from '@/store/player.store'
import { useSettingsStore } from '@/store/settings.store'

/** Contorno via text-shadow: funciona em qualquer fonte, sem depender de -webkit-text-stroke. */
function outlineShadow(width: number): string {
  if (width <= 0) return ''
  const steps: string[] = []
  for (let angle = 0; angle < 360; angle += 45) {
    const rad = (angle * Math.PI) / 180
    const x = (Math.cos(rad) * width).toFixed(2)
    const y = (Math.sin(rad) * width).toFixed(2)
    steps.push(`${x}px ${y}px 0 #000`)
  }
  return steps.join(', ')
}

export function subtitleTextStyle(style: SubtitleStyle): CSSProperties {
  const shadows: string[] = []
  const outline = outlineShadow(style.outlineWidth)
  if (outline) shadows.push(outline)
  if (style.shadow) shadows.push('0 2px 6px rgba(0, 0, 0, 0.95)')

  const background =
    style.background === 'none'
      ? 'transparent'
      : `rgba(0, 0, 0, ${style.backgroundOpacity})`

  return {
    display: 'inline-block',
    padding: style.background === 'none' ? 0 : '4px 12px',
    borderRadius: 4,
    background,
    backdropFilter: style.background === 'blur' ? 'blur(6px)' : undefined,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    textShadow: shadows.length > 0 ? shadows.join(', ') : undefined,
    whiteSpace: 'pre-wrap',
    textAlign: 'center'
  }
}

export function SubtitleOverlay({ raised }: { raised: boolean }): JSX.Element | null {
  const subtitle = usePlayerStore((s) => s.subtitle)
  const enabled = usePlayerStore((s) => s.subtitlesEnabled)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const style = useSettingsStore((s) => s.settings.subtitleStyle)

  const cue = useMemo(() => {
    if (!subtitle || !enabled) return null
    // `delay` positivo atrasa a legenda: procuramos o cue de um instante anterior.
    const at = currentTime - style.delay
    return subtitle.cues.find((c) => at >= c.start && at <= c.end) ?? null
  }, [subtitle, enabled, currentTime, style.delay])

  if (!cue) return null

  // Sobe um pouco quando os controles estao visiveis, para nao ficar atras deles.
  const bottom = `calc(${style.bottomOffset}% + ${raised ? 72 : 0}px)`

  return (
    <div
      className="subtitles"
      style={{
        bottom,
        left: `${(100 - style.maxWidth) / 2}%`,
        right: `${(100 - style.maxWidth) / 2}%`
      }}
    >
      <span style={subtitleTextStyle(style)}>{cue.text}</span>
    </div>
  )
}
