import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    api: RendererApi
    dnd: {
      /** Caminho absoluto de um File vindo de drag and drop. */
      pathForFile(file: File): string
    }
    platform: NodeJS.Platform
  }
}

export {}
