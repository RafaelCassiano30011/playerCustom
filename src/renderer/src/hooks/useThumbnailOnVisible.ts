import { useEffect, useRef } from 'react'
import type { Video } from '@shared/types'
import { requestThumbnail } from '@/lib/thumbnailWorker'

/**
 * Retorna um ref pra colocar no elemento da linha do episodio. So pede a
 * thumbnail quando essa linha realmente aparece na tela — em colecoes com
 * centenas de episodios, gerar tudo de uma vez trava a decodificacao do
 * video que esta tocando.
 */
export function useThumbnailOnVisible(video: Video, enabled: boolean): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled || video.thumbnail || !ref.current) return

    const element = ref.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) requestThumbnail(video)
      },
      { rootMargin: '300px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [video, enabled])

  return ref
}
