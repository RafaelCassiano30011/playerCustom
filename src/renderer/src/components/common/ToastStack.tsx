import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { useToastStore } from '@/store/toast.store'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle
} as const

export function ToastStack(): JSX.Element {
  const toasts = useToastStore((state) => state.toasts)

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((item) => {
        const Icon = ICONS[item.kind]
        return (
          <div key={item.id} className={`toast toast--${item.kind}`}>
            <Icon size={16} />
            <span>{item.message}</span>
          </div>
        )
      })}
    </div>
  )
}
