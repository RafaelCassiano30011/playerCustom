import { Fragment } from 'react'
import { Switch } from '@/components/common/Switch'
import { SubtitleSettings } from '@/components/settings/SubtitleSettings'
import { CloudSettings } from '@/components/settings/CloudSettings'
import { useSettingsStore } from '@/store/settings.store'
import { SHORTCUTS } from '@/hooks/useKeyboardShortcuts'

export function SettingsView(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)

  return (
    <>
      <header className="main__header">
        <div>
          <div className="main__title">Configuracoes</div>
          <div className="main__subtitle">Preferencias gerais do player</div>
        </div>
      </header>

      <div className="scroll-area">
        <div className="settings-grid">
          <div className="settings-group">
            <div className="section-title" style={{ margin: 0 }}>
              Reproducao
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row__label">Reproduzir proximo automaticamente</div>
                <div className="settings-row__hint">Toca o proximo episodio ao terminar o atual</div>
              </div>
              <Switch checked={settings.autoPlayNext} onChange={(v) => void patch({ autoPlayNext: v })} />
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row__label">Modo aleatorio</div>
                <div className="settings-row__hint">Embaralha a ordem dos episodios</div>
              </div>
              <Switch checked={settings.shuffle} onChange={(v) => void patch({ shuffle: v })} />
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row__label">Tempo de avanco/retrocesso</div>
                <div className="settings-row__hint">Segundos por tecla J/L</div>
              </div>
              <div className="settings-row__control">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={120}
                  value={settings.seekStep}
                  onChange={(e) => void patch({ seekStep: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row__label">Proximo episodio (padrao)</div>
                <div className="settings-row__hint">Segundos antes do fim para exibir o aviso</div>
              </div>
              <div className="settings-row__control">
                <input
                  className="input"
                  type="number"
                  min={5}
                  max={600}
                  value={settings.defaultNextEpisodeOffset}
                  onChange={(e) => void patch({ defaultNextEpisodeOffset: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <SubtitleSettings />

          <div className="settings-group">
            <div className="section-title" style={{ margin: 0 }}>
              Biblioteca
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row__label">Miniaturas automaticas</div>
                <div className="settings-row__hint">Gera capturas de tela dos videos importados</div>
              </div>
              <Switch checked={settings.autoThumbnails} onChange={(v) => void patch({ autoThumbnails: v })} />
            </div>
          </div>

          <div className="settings-group">
            <div className="section-title" style={{ margin: 0 }}>
              Aparencia
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row__label">Tema</div>
              </div>
              <div className="settings-row__control">
                <select
                  className="select"
                  value={settings.theme}
                  onChange={(e) => void patch({ theme: e.target.value as 'dark' | 'midnight' })}
                >
                  <option value="dark">Escuro (VLC)</option>
                  <option value="midnight">Meia-noite (azul)</option>
                </select>
              </div>
            </div>
          </div>

          <CloudSettings />

          <div className="settings-group">
            <div className="section-title" style={{ margin: 0 }}>
              Atalhos de teclado
            </div>
            <div className="shortcut-table">
              {SHORTCUTS.map(([keys, description]) => (
                <Fragment key={keys}>
                  <kbd>{keys}</kbd>
                  <span style={{ color: 'var(--text-1)' }}>{description}</span>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
