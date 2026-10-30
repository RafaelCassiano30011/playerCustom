import { useEffect, useState } from 'react'
import { Heart, Play } from 'lucide-react'
import type { Video } from '@shared/types'
import { formatTime } from '@shared/time'
import { mediaUrl } from '@/lib/media'
import { usePlayerStore } from '@/store/player.store'

interface FavoritesViewProps {
  onOpenCollection: (id: string) => void
}

export function FavoritesView({ onOpenCollection }: FavoritesViewProps): JSX.Element {
  const [videos, setVideos] = useState<Video[]>([])
  const open = usePlayerStore((s) => s.open)

  useEffect(() => {
    void window.api.videos.favorites().then(setVideos)
  }, [])

  const handlePlay = async (video: Video): Promise<void> => {
    const queue = await window.api.videos.byCollection(video.collectionId)
    await open(video, queue)
    onOpenCollection(video.collectionId)
  }

  return (
    <>
      <header className="main__header">
        <div>
          <div className="main__title">Favoritos</div>
          <div className="main__subtitle">{videos.length} video(s)</div>
        </div>
      </header>
      <div className="scroll-area">
        {videos.length === 0 ? (
          <div className="empty">
            <Heart size={34} />
            <div className="empty__title">Nenhum favorito ainda</div>
            <p className="empty__text">Marque videos com o coracao para encontra-los aqui rapidamente.</p>
          </div>
        ) : (
          <div className="row-list">
            {videos.map((video) => (
              <button key={video.id} className="row" onClick={() => void handlePlay(video)}>
                <div
                  style={{
                    width: 64,
                    height: 36,
                    borderRadius: 6,
                    background: 'var(--bg-3)',
                    flexShrink: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {video.thumbnail ? (
                    <img src={mediaUrl(video.thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Play size={14} color="var(--text-2)" />
                  )}
                </div>
                <div className="row__main">
                  <div className="row__title">{video.name}</div>
                  <div className="row__sub">{formatTime(video.duration)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
