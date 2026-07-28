import { RotateCcw } from 'lucide-react'
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_FONTS,
  type SubtitleBackground,
  type SubtitleStyle
} from '@shared/types'
import { Switch } from '@/components/common/Switch'
import { subtitleTextStyle } from '@/components/player/SubtitleOverlay'
import { useSettingsStore } from '@/store/settings.store'

const WEIGHTS: Array<{ label: string; value: SubtitleStyle['fontWeight'] }> = [
  { label: 'Normal', value: 400 },
  { label: 'Media', value: 500 },
  { label: 'Semi-negrito', value: 600 },
  { label: 'Negrito', value: 700 },
  { label: 'Extra-negrito', value: 800 }
]

const BACKGROUNDS: Array<{ label: string; value: SubtitleBackground }> = [
  { label: 'Caixa escura', value: 'box' },
  { label: 'Desfoque', value: 'blur' },
  { label: 'Nenhum', value: 'none' }
]

const PRESET_COLORS = ['#ffffff', '#f5f542', '#7dd3fc', '#86efac', '#fdba74', '#f9a8d4']

interface RowProps {
  label: string
  hint?: string
  children: React.ReactNode
}

function Row({ label, hint, children }: RowProps): JSX.Element {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row__label">{label}</div>
        {hint && <div className="settings-row__hint">{hint}</div>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  )
}

export function SubtitleSettings(): JSX.Element {
  const style = useSettingsStore((s) => s.settings.subtitleStyle)
  const subtitlesEnabled = useSettingsStore((s) => s.settings.subtitlesEnabled)
  const patch = useSettingsStore((s) => s.patch)

  const set = (change: Partial<SubtitleStyle>): void => {
    void patch({ subtitleStyle: { ...style, ...change } })
  }

  return (
    <div className="settings-group">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="section-title" style={{ margin: 0 }}>
          Legendas
        </div>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void patch({ subtitleStyle: DEFAULT_SUBTITLE_STYLE })}
          title="Restaurar padrao"
        >
          <RotateCcw size={13} />
          Restaurar
        </button>
      </div>

      {/* Pre-visualizacao usa exatamente o mesmo estilo do player. */}
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          border: '1px solid var(--line)',
          background:
            'linear-gradient(135deg, #1c2333 0%, #2b3550 40%, #14324a 70%, #0d1b2a 100%)',
          minHeight: 150,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: 14
        }}
      >
        <span style={subtitleTextStyle(style)}>
          Assim que a legenda vai aparecer.{'\n'}Segunda linha de exemplo.
        </span>
      </div>

      <Row label="Legendas ativas" hint="Carrega .srt/.vtt com o mesmo nome do video">
        <Switch checked={subtitlesEnabled} onChange={(v) => void patch({ subtitlesEnabled: v })} />
      </Row>

      <Row label="Tamanho" hint={`${style.fontSize}px`}>
        <input
          className="slider"
          style={{ width: '100%' }}
          type="range"
          min={10}
          max={72}
          step={1}
          value={style.fontSize}
          onChange={(e) => set({ fontSize: Number(e.target.value) })}
        />
      </Row>

      <Row label="Fonte">
        <select
          className="select"
          value={style.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
        >
          {SUBTITLE_FONTS.map((font) => (
            <option key={font.value} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Espessura">
        <select
          className="select"
          value={style.fontWeight}
          onChange={(e) =>
            set({ fontWeight: Number(e.target.value) as SubtitleStyle['fontWeight'] })
          }
        >
          {WEIGHTS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Cor do texto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => set({ color })}
              aria-label={`Cor ${color}`}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: color,
                border:
                  style.color.toLowerCase() === color
                    ? '2px solid var(--accent)'
                    : '1px solid var(--line)'
              }}
            />
          ))}
          <input
            type="color"
            value={style.color}
            onChange={(e) => set({ color: e.target.value })}
            style={{
              width: 30,
              height: 24,
              padding: 0,
              background: 'none',
              border: '1px solid var(--line)',
              borderRadius: 4,
              cursor: 'pointer'
            }}
            aria-label="Cor personalizada"
          />
        </div>
      </Row>

      <Row label="Fundo">
        <select
          className="select"
          value={style.background}
          onChange={(e) => set({ background: e.target.value as SubtitleBackground })}
        >
          {BACKGROUNDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </Row>

      {style.background !== 'none' && (
        <Row label="Opacidade do fundo" hint={`${Math.round(style.backgroundOpacity * 100)}%`}>
          <input
            className="slider"
            style={{ width: '100%' }}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={style.backgroundOpacity}
            onChange={(e) => set({ backgroundOpacity: Number(e.target.value) })}
          />
        </Row>
      )}

      <Row label="Contorno" hint={style.outlineWidth === 0 ? 'Desligado' : `${style.outlineWidth}px`}>
        <input
          className="slider"
          style={{ width: '100%' }}
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={style.outlineWidth}
          onChange={(e) => set({ outlineWidth: Number(e.target.value) })}
        />
      </Row>

      <Row label="Sombra">
        <Switch checked={style.shadow} onChange={(v) => set({ shadow: v })} />
      </Row>

      <Row label="Altura na tela" hint={`${style.bottomOffset}% a partir da base`}>
        <input
          className="slider"
          style={{ width: '100%' }}
          type="range"
          min={0}
          max={45}
          step={1}
          value={style.bottomOffset}
          onChange={(e) => set({ bottomOffset: Number(e.target.value) })}
        />
      </Row>

      <Row label="Largura maxima" hint={`${style.maxWidth}% da tela`}>
        <input
          className="slider"
          style={{ width: '100%' }}
          type="range"
          min={30}
          max={100}
          step={5}
          value={style.maxWidth}
          onChange={(e) => set({ maxWidth: Number(e.target.value) })}
        />
      </Row>

      <Row label="Espaco entre linhas" hint={String(style.lineHeight)}>
        <input
          className="slider"
          style={{ width: '100%' }}
          type="range"
          min={1}
          max={2.2}
          step={0.05}
          value={style.lineHeight}
          onChange={(e) => set({ lineHeight: Number(e.target.value) })}
        />
      </Row>

      <Row
        label="Sincronia"
        hint={
          style.delay === 0
            ? 'Sem ajuste'
            : style.delay > 0
              ? `Atrasada ${style.delay.toFixed(1)}s`
              : `Adiantada ${Math.abs(style.delay).toFixed(1)}s`
        }
      >
        <input
          className="input"
          type="number"
          step={0.5}
          min={-60}
          max={60}
          value={style.delay}
          onChange={(e) => set({ delay: Number(e.target.value) })}
        />
      </Row>
    </div>
  )
}
