import { useState } from 'react'
import { ListVideo } from 'lucide-react'
import type { Video } from '@shared/types'
import { EpisodeItem } from './EpisodeItem'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { VideoSettingsModal } from '@/components/player/VideoSettingsModal'
import { useLibraryStore } from '@/store/library.store'
import { useCloudStore } from '@/store/cloud.store'

interface EpisodeListProps {
  collectionId: string
  videos: Video[]
  activeVideoId: string | null
  autoThumbnails: boolean
  onPlay: (video: Video) => void
}

export function EpisodeList({
  collectionId,
  videos,
  activeVideoId,
  autoThumbnails,
  onPlay
}: EpisodeListProps): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragOverSide, setDragOverSide] = useState<'before' | 'after' | null>(null)
  const [configuring, setConfiguring] = useState<Video | null>(null)
  const [deleting, setDeleting] = useState<Video | null>(null)

  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite)
  const resetProgress = useLibraryStore((s) => s.resetProgress)
  const deleteVideo = useLibraryStore((s) => s.deleteVideo)
  const reorder = useLibraryStore((s) => s.reorder)
  const move = useLibraryStore((s) => s.move)

  const downloads = useCloudStore((s) => s.downloads)
  const download = useCloudStore((s) => s.download)
  const cancelDownload = useCloudStore((s) => s.cancelDownload)
  const removeOffline = useCloudStore((s) => s.removeOffline)

  if (videos.length === 0) {
    return (
      <div className="empty">
        <ListVideo size={34} />
        <div className="empty__title">Sem episodios</div>
        <p className="empty__text">Importe videos ou arraste arquivos para esta colecao.</p>
      </div>
    )
  }

  const handleDrop = (targetId: string): void => {
    if (!dragId || dragId === targetId) {
      setDragOverId(null)
      setDragOverSide(null)
      return
    }
    const ids = videos.map((v) => v.id)
    const from = ids.indexOf(dragId)
    let to = ids.indexOf(targetId)
    if (dragOverSide === 'after') to += 1
    ids.splice(from, 1)
    const adjustedTo = from < to ? to - 1 : to
    ids.splice(adjustedTo, 0, dragId)

    setDragId(null)
    setDragOverId(null)
    setDragOverSide(null)
    void reorder(collectionId, ids)
  }

  return (
    <>
      <div className="episodes__list">
        {videos.map((video, index) => (
          <EpisodeItem
            key={video.id}
            video={video}
            index={index}
            active={video.id === activeVideoId}
            autoThumbnails={autoThumbnails}
            download={downloads[video.id] ?? null}
            onDownload={() => void download(video.id)}
            onCancelDownload={() => void cancelDownload(video.id)}
            onRemoveOffline={() => void removeOffline(video.id)}
            dragging={dragId === video.id}
            dragOver={dragOverId === video.id ? dragOverSide : null}
            onPlay={() => onPlay(video)}
            onToggleFavorite={() => void toggleFavorite(video.id)}
            onResetProgress={() => void resetProgress(video.id)}
            onConfigure={() => setConfiguring(video)}
            onDelete={() => setDeleting(video)}
            onMoveUp={() => void move(collectionId, video.id, 'up')}
            onMoveDown={() => void move(collectionId, video.id, 'down')}
            dragHandlers={{
              onDragStart: (event) => {
                setDragId(video.id)
                event.dataTransfer.effectAllowed = 'move'
              },
              onDragOver: (event) => {
                event.preventDefault()
                if (!dragId || dragId === video.id) return
                const rect = event.currentTarget.getBoundingClientRect()
                const side = event.clientY - rect.top < rect.height / 2 ? 'before' : 'after'
                setDragOverId(video.id)
                setDragOverSide(side)
              },
              onDrop: (event) => {
                event.preventDefault()
                handleDrop(video.id)
              },
              onDragEnd: () => {
                setDragId(null)
                setDragOverId(null)
                setDragOverSide(null)
              }
            }}
          />
        ))}
      </div>

      {configuring && (
        <VideoSettingsModal video={configuring} onClose={() => setConfiguring(null)} />
      )}

      {deleting && (
        <ConfirmDialog
          title="Remover video"
          message={`Remover "${deleting.name}" desta colecao? O arquivo original nao sera apagado do disco.`}
          confirmLabel="Remover"
          danger
          onConfirm={() => void deleteVideo(deleting.id)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}
