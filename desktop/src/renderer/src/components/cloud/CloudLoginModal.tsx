import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { Modal } from '@/components/common/Modal'
import { useCloudStore } from '@/store/cloud.store'

interface CloudLoginModalProps {
  onClose: () => void
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DIGITOS = 6

/**
 * Entrar na biblioteca na nuvem com codigo enviado por e-mail.
 *
 * Dois passos: endereco e depois os seis digitos. Nao existe senha nenhuma —
 * provar que a caixa de e-mail e sua ja e a autenticacao, e nao sobra segredo
 * para esquecer, vazar ou reusar de outro site.
 */
export function CloudLoginModal({ onClose }: CloudLoginModalProps): JSX.Element {
  const [passo, setPasso] = useState<'email' | 'codigo'>('email')
  const [email, setEmail] = useState('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [validade, setValidade] = useState(0)
  const [reenvioEm, setReenvioEm] = useState(0)
  const campoCodigo = useRef<HTMLInputElement>(null)

  const busy = useCloudStore((s) => s.busy)
  const requestCode = useCloudStore((s) => s.requestCode)
  const verifyCode = useCloudStore((s) => s.verifyCode)
  const sync = useCloudStore((s) => s.sync)

  // contagem para liberar o reenvio
  useEffect(() => {
    if (reenvioEm <= 0) return
    const id = setInterval(() => setReenvioEm((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [reenvioEm])

  useEffect(() => {
    if (passo === 'codigo') campoCodigo.current?.focus()
  }, [passo])

  const pedirCodigo = async (): Promise<void> => {
    if (!EMAIL_VALIDO.test(email.trim())) {
      setErro('E-mail invalido.')
      return
    }
    setErro(null)

    const pedido = await requestCode(email.trim())
    if (!pedido) return

    setValidade(Math.round(pedido.expiresIn / 60))
    setReenvioEm(pedido.retryAfter)
    setCodigo('')
    setPasso('codigo')
  }

  const entrar = async (valor = codigo): Promise<void> => {
    if (valor.length !== DIGITOS) {
      setErro(`O codigo tem ${DIGITOS} digitos.`)
      return
    }
    setErro(null)

    const ok = await verifyCode(email.trim(), valor)
    if (!ok) {
      setErro('Codigo invalido ou expirado. Confira ou peca outro.')
      setCodigo('')
      return
    }

    // trazer o catalogo na hora: sem isso a tela fica igual a de antes do
    // login e parece que nada aconteceu
    void sync()
    onClose()
  }

  const digitar = (valor: string): void => {
    const limpo = valor.replace(/\D/g, '').slice(0, DIGITOS)
    setCodigo(limpo)
    setErro(null)
    // seis digitos preenchidos (inclusive colados): entra sem pedir clique
    if (limpo.length === DIGITOS) void entrar(limpo)
  }

  if (passo === 'email') {
    return (
      <Modal
        title="Entrar na nuvem"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn--ghost" onClick={onClose} type="button">
              Cancelar
            </button>
            <button
              className="btn btn--primary"
              onClick={() => void pedirCodigo()}
              disabled={busy}
              type="button"
            >
              {busy && <Loader2 size={14} className="spin" />}
              Enviar codigo
            </button>
          </>
        }
      >
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-2)' }}>
          Mandamos um codigo de {DIGITOS} digitos para o seu e-mail. Nao tem senha: a mesma conta
          vale para este player e para o aplicativo de TV.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="cloud-email">
            E-mail
          </label>
          <input
            id="cloud-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setErro(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && void pedirCodigo()}
            placeholder="voce@exemplo.com"
            autoComplete="username"
            autoFocus
          />
        </div>

        {erro && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #ff6b6b)' }}>
            {erro}
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      title="Codigo de acesso"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn--ghost"
            onClick={() => {
              setPasso('email')
              setErro(null)
            }}
            type="button"
          >
            <ArrowLeft size={14} />
            Trocar e-mail
          </button>
          <button
            className="btn btn--primary"
            onClick={() => void entrar()}
            disabled={busy || codigo.length !== DIGITOS}
            type="button"
          >
            {busy && <Loader2 size={14} className="spin" />}
            Entrar
          </button>
        </>
      }
    >
      <p
        style={{
          margin: '0 0 16px',
          fontSize: 13,
          color: 'var(--text-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }}
      >
        <MailCheck size={16} />
        Enviamos o codigo para <strong>{email.trim()}</strong>
        {validade > 0 && ` — vale por ${validade} minutos.`}
      </p>

      <div className="field">
        <label className="field__label" htmlFor="cloud-codigo">
          Codigo de {DIGITOS} digitos
        </label>
        <input
          id="cloud-codigo"
          ref={campoCodigo}
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={codigo}
          onChange={(e) => digitar(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void entrar()}
          placeholder="000000"
          style={{ fontSize: 24, letterSpacing: 8, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        />
      </div>

      <button
        className="btn btn--ghost btn--sm"
        onClick={() => void pedirCodigo()}
        disabled={busy || reenvioEm > 0}
        type="button"
      >
        {reenvioEm > 0 ? `Reenviar em ${reenvioEm}s` : 'Reenviar codigo'}
      </button>

      {erro && (
        <div role="alert" style={{ marginTop: 12, fontSize: 13, color: 'var(--danger, #ff6b6b)' }}>
          {erro}
        </div>
      )}
    </Modal>
  )
}
