import { useState } from 'react'
import { Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { Switch } from '@/components/common/Switch'
import { CloudLoginModal } from '@/components/cloud/CloudLoginModal'
import { useCloudStore } from '@/store/cloud.store'
import { useSettingsStore } from '@/store/settings.store'

/**
 * Painel da biblioteca na nuvem.
 *
 * Mostra sessao, conectividade e a fila de posicoes pendentes — esse ultimo
 * numero e o que explica ao usuario que o que ele assistiu offline nao foi
 * perdido, so ainda nao subiu.
 */
export function CloudSettings(): JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)

  const status = useCloudStore((s) => s.status)
  const busy = useCloudStore((s) => s.busy)
  const logout = useCloudStore((s) => s.logout)
  const sync = useCloudStore((s) => s.sync)

  const [abrindoLogin, setAbrindoLogin] = useState(false)

  return (
    <div className="settings-group">
      <div className="section-title" style={{ margin: 0 }}>
        Biblioteca na nuvem
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">
            {status.signedIn ? (
              <>
                <Cloud size={14} /> Conectado como {status.email}
              </>
            ) : (
              <>
                <CloudOff size={14} /> Sem conta conectada
              </>
            )}
          </div>
          <div className="settings-row__hint">
            {status.signedIn
              ? status.online
                ? status.lastSyncAt
                  ? `Sincronizado as ${new Date(status.lastSyncAt).toLocaleTimeString()}`
                  : 'Aguardando a primeira sincronizacao'
                : 'Offline: tocando do que esta baixado e guardando o progresso'
              : 'Entre para assistir por streaming e sincronizar o progresso'}
            {status.pendingProgress > 0 && ` · ${status.pendingProgress} posicao(oes) na fila`}
          </div>
        </div>
        {status.signedIn && (
          <div className="settings-row__control" style={{ gap: 8 }}>
            <button className="btn" onClick={() => void sync()} disabled={busy || status.syncing}>
              {status.syncing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Sincronizar
            </button>
            <button className="btn" onClick={() => void logout()} disabled={busy}>
              Sair
            </button>
          </div>
        )}
      </div>

      {!status.signedIn && (
        <div className="settings-row">
          <div>
            <div className="settings-row__hint">
              Codigo por e-mail, sem senha. A conta e a mesma usada pelo aplicativo de TV.
            </div>
          </div>
          <div className="settings-row__control">
            <button
              className="btn btn--primary"
              onClick={() => setAbrindoLogin(true)}
              disabled={busy}
            >
              Entrar
            </button>
          </div>
        </div>
      )}

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Sincronizar em segundo plano</div>
          <div className="settings-row__hint">
            Envia o progresso e busca o que mudou a cada poucos minutos
          </div>
        </div>
        <Switch
          checked={settings.cloudAutoSync}
          onChange={(v) => void patch({ cloudAutoSync: v })}
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Enviar o que eu importar</div>
          <div className="settings-row__hint">
            Todo video importado sobe para a nuvem e fica disponivel na TV
          </div>
        </div>
        <Switch
          checked={settings.cloudAutoUpload}
          onChange={(v) => void patch({ cloudAutoUpload: v })}
        />
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-row__label">Endereco da API</div>
          <div className="settings-row__hint">Mude so se voce publicou seu proprio servidor</div>
        </div>
        <div className="settings-row__control">
          <input
            className="input"
            type="text"
            value={settings.cloudApiBaseUrl}
            onChange={(e) => void patch({ cloudApiBaseUrl: e.target.value.trim() })}
            spellCheck={false}
          />
        </div>
      </div>

      {abrindoLogin && <CloudLoginModal onClose={() => setAbrindoLogin(false)} />}

      {status.lastError && (
        <div className="settings-row">
          <div className="settings-row__hint" style={{ color: 'var(--danger, #ff6b6b)' }}>
            {status.lastError}
          </div>
        </div>
      )}
    </div>
  )
}
