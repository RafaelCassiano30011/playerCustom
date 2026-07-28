import { memo } from 'react'
import { CheckCircle2, Film, GripVertical, Heart, MoreVertical, Play } from 'lucide-react'
import type { Video } from '@shared/types'
import { formatTime } from '@shared/time'
import { mediaUrl, videoProgress } from '@/lib/media'
import { MenuItem, PlayerMenu } from '@/components/player/PlayerMenu'
import { useThumbnailOnVisible } from '@/hooks/useThumbnailOnVisible'

interface EpisodeItemProps {
  video: Video
  index: number
  active: boolean
  dragOver: 'before' | 'after' | null
  autoThumbnails: boolean
  onPlay: () => void
  onToggleFavorite: () => void
  onResetProgress: () => void
  onConfigure: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  dragHandlers: {
    onDragStart: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDrop: (event: React.DragEvent) => void
    onDragEnd: () => void
  }
  dragging: boolean
}

function EpisodeItemImpl({
  video,
  index,
  active,
  dragOver,
  autoThumbnails,
  onPlay,
  onToggleFavorite,
  onResetProgress,
  onConfigure,
  onDelete,
  onMoveUp,
  onMoveDown,
  dragHandlers,
  dragging
}: EpisodeItemProps): JSX.Element {
  const progress = videoProgress(video) * 100

  const classes = [
    'episode',
    active && 'episode--active',
    dragging && 'episode--dragging',
    dragOver === 'before' && 'episode--drop-before',
    dragOver === 'after' && 'episode--drop-after'
  ]
    .filter(Boolean)
    .join(' ')

  const thumbRef = useThumbnailOnVisible(video, autoThumbnails)

  return (
    <div
      className={classes}
      onClick={onPlay}
      onDragOver={dragHandlers.onDragOver}
      onDrop={dragHandlers.onDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
    >
      <span
        className="episode__handle"
        draggable
        onDragStart={dragHandlers.onDragStart}
        onDragEnd={dragHandlers.onDragEnd}
        onClick={(e) => e.stopPropagation()}
        title="Arrastar para reordenar"
      >
        <GripVertical size={15} />
      </span>

      <div className="episode__thumb" ref={thumbRef}>
        {video.thumbnail ? (
          <img src={mediaUrl(video.thumbnail)} alt="" />
        ) : (
          <Film size={18} color="var(--text-2)" />
        )}
        <span className="episode__index">{index + 1}</span>
        {progress > 0 && (
          <div className="episode__thumb-progress" style={{ width: `${progress}%` }} />
        )}
      </div>

      <div className="episode__info">
        <span className="episode__name">{video.name}</span>
        <span className="episode__meta">
          {video.duration > 0 && <span>{formatTime(video.duration)}</span>}
          {video.status === 'completed' && (
            <span className="badge badge--ok">
              <CheckCircle2 size={11} /> Concluido
            </span>
          )}
          {video.status === 'in_progress' && <span className="badge badge--progress">Em andamento</span>}
        </span>
      </div>

      <div className="episode__actions" onClick={(e) => e.stopPropagation()}>
        <button
          className={`icon-btn${video.favorite ? ' fav-on' : ''}`}
          onClick={onToggleFavorite}
          aria-label="Favorito"
          title="Favoritar"
        >
          <Heart size={15} fill={video.favorite ? 'currentColor' : 'none'} />
        </button>
        <button className="icon-btn" onClick={onPlay} aria-label="Reproduzir" title="Reproduzir">
          <Play size={15} />
        </button>
        <PlayerMenu icon={<MoreVertical size={15} />} label="Mais opcoes">
          {(close) => (
            <>
              <MenuItem
                label="Mover para cima"
                onClick={() => {
                  onMoveUp()
                  close()
                }}
              />
              <MenuItem
                label="Mover para baixo"
                onClick={() => {
                  onMoveDown()
                  close()
                }}
              />
              <MenuItem
                label="Configurar abertura / proximo"
                onClick={() => {
                  onConfigure()
                  close()
                }}
              />
              {video.lastPosition > 0 && (
                <MenuItem
                  label="Reiniciar progresso"
                  onClick={() => {
                    onResetProgress()
                    close()
                  }}
                />
              )}
              <MenuItem
                label="Remover da colecao"
                onClick={() => {
                  onDelete()
                  close()
                }}
              />
            </>
          )}
        </PlayerMenu>
      </div>
    </div>
  )
}

export const EpisodeItem = memo(EpisodeItemImpl)
