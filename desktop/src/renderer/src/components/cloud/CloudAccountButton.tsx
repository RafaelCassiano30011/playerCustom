import { useState } from 'react'
import { Cloud, CloudOff, LogIn, RefreshCw } from 'lucide-react'
import { useCloudStore } from '@/store/cloud.store'
import { CloudLoginModal } from '@/components/cloud/CloudLoginModal'

interface CloudAccountButtonProps {
  /** Leva para Configuracoes, onde fica o resto do painel da nuvem. */
  onOpenSettings: () => void
}

/**
 * Estado da conta na barra lateral.
 *
 * Sem sessao, isso e o unico lugar que abre o login — antes ele vivia dentro
 * de Configuracoes e ninguem achava.
 */
export function CloudAccountButton({ onOpenSettings }: CloudAccountButtonProps): JSX.Element {
  const [abrindoLogin, setAbrindoLogin] = useState(false)
  const status = useCloudStore((s) => s.status)

  if (!status.signedIn) {
    return (
      <>
        <button className="nav-item" onClick={() => setAbrindoLogin(true)}>
          <LogIn size={16} />
          Entrar na nuvem
        </button>
        {abrindoLogin && <CloudLoginModal onClose={() => setAbrindoLogin(false)} />}
      </>
    )
  }

  const detalhe = status.syncing
    ? 'Sincronizando...'
    : !status.online
      ? status.pendingProgress > 0
        ? `Offline · ${status.pendingProgress} na fila`
        : 'Offline'
      : status.pendingProgress > 0
        ? `${status.pendingProgress} posicao(oes) na fila`
        : 'Conectado'

  return (
    <button
      className="nav-item"
      onClick={onOpenSettings}
      title={`${status.email ?? ''} — ${detalhe}`}
      style={{ alignItems: 'flex-start' }}
    >
      {status.syncing ? (
        <RefreshCw size={16} className="spin" />
      ) : status.online ? (
        <Cloud size={16} />
      ) : (
        <CloudOff size={16} />
      )}
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          overflow: 'hidden',
          lineHeight: 1.3
        }}
      >
        <span
          style={{
            maxWidth: 150,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {status.email}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{detalhe}</span>
      </span>
    </button>
  )
}
