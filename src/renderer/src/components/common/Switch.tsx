interface SwitchProps {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
}

export function Switch({ checked, onChange, label }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      className={`switch${checked ? ' switch--on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__track" />
      {label && <span>{label}</span>}
    </button>
  )
}
