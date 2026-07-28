import type { Video } from '@shared/types'
import { usePlayerStore } from '@/store/player.store'
import { useLibraryStore } from '@/store/library.store'

/**
 * Enquanto um video esta aberto no player, nem geramos miniaturas: o ffmpeg
 * concorreria por disco/CPU com a reproducao. Reavaliamos periodicamente.
 */
const BUSY_RETRY_MS = 3000

const queue: Video[] = []
const queued = new Set<string>()
const failed = new Set<string>()
let draining = false

function playerBusy(): boolean {
  const { video, status } = usePlayerStore.getState()
  return video !== null || status === 'loading'
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true

  while (queue.length > 0) {
    if (playerBusy()) {
      await new Promise((r) => setTimeout(r, BUSY_RETRY_MS))
      continue
    }

    const video = queue.shift()
    if (!video) break

    try {
      // Toda a decodificacao acontece no processo principal, via ffmpeg.
      const updated = await window.api.videos.generateThumbnail(video.id)
      if (updated) useLibraryStore.getState().patchVideoLocal(updated)
      else failed.add(video.id)
    } catch {
      failed.add(video.id)
    }
  }

  draining = false
}

/**
 * Enfileira a geracao da miniatura de um video. So e chamado quando a linha
 * do episodio entra na tela (ver `useThumbnailOnVisible`).
 */
export function requestThumbnail(video: Video): void {
  if (video.thumbnail || queued.has(video.id) || failed.has(video.id)) return
  queued.add(video.id)
  queue.push(video)
  void drain()
}
