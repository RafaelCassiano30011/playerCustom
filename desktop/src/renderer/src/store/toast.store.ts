import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3200)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

/** Atalho para uso fora de componentes (stores, handlers). */
export const toast = {
  info: (message: string) => useToastStore.getState().push(message, 'info'),
  success: (message: string) => useToastStore.getState().push(message, 'success'),
  error: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    useToastStore.getState().push(message, 'error')
  }
}
