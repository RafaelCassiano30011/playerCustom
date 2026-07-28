import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings } from '@shared/types'
import { toast } from './toast.store'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<AppSettings>
  patch: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const settings = await window.api.settings.get()
      set({ settings, loaded: true })
      document.documentElement.dataset.theme = settings.theme
      return settings
    } catch (error) {
      toast.error(error)
      set({ loaded: true })
      return get().settings
    }
  },

  /** Otimista: aplica na UI e reconcilia com o retorno do main. */
  patch: async (patch) => {
    const previous = get().settings
    set({ settings: { ...previous, ...patch } })
    if (patch.theme) document.documentElement.dataset.theme = patch.theme
    try {
      const settings = await window.api.settings.update(patch)
      set({ settings })
    } catch (error) {
      set({ settings: previous })
      toast.error(error)
    }
  }
}))
