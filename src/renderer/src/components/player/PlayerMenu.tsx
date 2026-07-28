import { useEffect, useRef, useState, type ReactNode } from 'react'

interface PlayerMenuProps {
  icon: ReactNode
  label: string
  active?: boolean
  children: (close: () => void) => ReactNode
}

/** Menu suspenso da barra de controles (velocidade, legendas, audio). */
export function PlayerMenu({ icon, label, active, children }: PlayerMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
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
      {open && <div className="menu__panel">{children(() => setOpen(false))}</div>}
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
