import { useState } from 'react'
import { Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { Switch } from '@/components/common/Switch'
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
  const login = useCloudStore((s) => s.login)
  const register = useCloudStore((s) => s.register)
  const logout = useCloudStore((s) => s.logout)
  const sync = useCloudStore((s) => s.sync)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const entrar = (criar: boolean): void => {
    if (!email.trim() || password.length < 8) return
    void (criar ? register(email.trim(), password) : login(email.trim(), password)).then((ok) => {
      if (ok) setPassword('')
    })
  }

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
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row__label">E-mail</div>
            </div>
            <div className="settings-row__control">
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@exemplo.com"
              />
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__label">Senha</div>
              <div className="settings-row__hint">Minimo de 8 caracteres</div>
            </div>
            <div className="settings-row__control">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && entrar(false)}
              />
            </div>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row__hint">
                A conta e a mesma usada pelo aplicativo de TV.
              </div>
            </div>
            <div className="settings-row__control" style={{ gap: 8 }}>
              <button className="btn btn--primary" onClick={() => entrar(false)} disabled={busy}>
                {busy && <Loader2 size={14} className="spin" />} Entrar
              </button>
              <button className="btn" onClick={() => entrar(true)} disabled={busy}>
                Criar conta
              </button>
            </div>
          </div>
        </>
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
