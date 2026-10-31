import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

interface PlayerMenuProps {
  icon: ReactNode
  label: string
  active?: boolean
  children: (close: () => void) => ReactNode
}

const MARGEM = 8

/**
 * Menu suspenso usado na barra do player e na lista de episodios.
 *
 * O painel vai para um portal com posicao fixa: dentro da lista ele seria
 * recortado pelo `overflow-y` do container, que foi exatamente o que
 * acontecia. Abre para baixo quando cabe e vira para cima quando nao cabe,
 * que e o caso da barra de controles, colada no rodape.
 */
export function PlayerMenu({ icon, label, active, children }: PlayerMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const painel = useRef<HTMLDivElement>(null)

  const posicionar = useCallback((): void => {
    const botao = ref.current?.getBoundingClientRect()
    const caixa = painel.current?.getBoundingClientRect()
    if (!botao || !caixa) return

    const abaixo = botao.bottom + MARGEM
    const cabeAbaixo = abaixo + caixa.height <= window.innerHeight - MARGEM
    const top = cabeAbaixo
      ? abaixo
      : Math.max(MARGEM, botao.top - MARGEM - caixa.height)

    // alinhado pela direita do botao, sem passar das bordas da janela
    const left = Math.min(
      Math.max(MARGEM, botao.right - caixa.width),
      window.innerWidth - caixa.width - MARGEM
    )

    setPosicao({ top, left })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPosicao(null)
      return
    }
    posicionar()
  }, [open, posicionar])

  useEffect(() => {
    if (!open) return
    // rolar ou redimensionar move o botao: reposiciona em vez de deixar o
    // painel flutuando longe de quem o abriu
    const refazer = (): void => posicionar()
    window.addEventListener('scroll', refazer, true)
    window.addEventListener('resize', refazer)
    return () => {
      window.removeEventListener('scroll', refazer, true)
      window.removeEventListener('resize', refazer)
    }
  }, [open, posicionar])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const alvo = event.target as Node
      if (ref.current?.contains(alvo) || painel.current?.contains(alvo)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="menu" ref={ref}>
      <button
        className={`icon-btn${active ? ' icon-btn--active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        aria-expanded={open}
        title={label}
      >
        {icon}
      </button>
      {open &&
        createPortal(
          <div
            className="menu__panel menu__panel--floating"
            ref={painel}
            style={{
              top: posicao?.top ?? -9999,
              left: posicao?.left ?? -9999,
              // enquanto nao mediu, fica fora da tela para nao piscar no canto
              visibility: posicao ? 'visible' : 'hidden'
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  )
}

interface MenuItemProps {
  label: string
  active?: boolean
  hint?: string
  onClick: () => void
}

export function MenuItem({ label, active, hint, onClick }: MenuItemProps): JSX.Element {
  return (
    <button className={`menu__item${active ? ' menu__item--active' : ''}`} onClick={onClick}>
      <span>{label}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{hint}</span>}
    </button>
  )
}
