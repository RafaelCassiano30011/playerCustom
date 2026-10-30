import type { Video } from '@shared/types'
import { progressRatio } from '@shared/time'

/** URL servida pelo protocolo `media://` do processo principal. */
export function mediaUrl(path: string | null | undefined): string | undefined {
  return path ? window.api.files.toMediaUrl(path) : undefined
}

export function videoProgress(video: Video): number {
  if (video.status === 'completed') return 1
  return progressRatio(video.lastPosition, video.duration)
}

/** Segundo a partir do qual o aviso de proximo episodio deve aparecer. */
export function nextEpisodeThreshold(video: Video, fallbackOffset: number): number | null {
  const offset = video.nextEpisodeOffset ?? fallbackOffset
  if (!offset || !video.duration) return null
  return Math.max(0, video.duration - offset)
}

export function hasIntroConfig(video: Video): boolean {
  return video.introStart !== null && video.introEnd !== null
}
