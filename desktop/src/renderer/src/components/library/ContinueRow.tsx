import { Film, Play } from 'lucide-react'
import type { Video } from '@shared/types'
import { formatTime } from '@shared/time'
import { mediaUrl, videoProgress } from '@/lib/media'

interface ContinueRowProps {
  videos: Video[]
  onSelect: (video: Video) => void
}

export function ContinueRow({ videos, onSelect }: ContinueRowProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        overflowX: 'auto',
        paddingBottom: 8,
        marginBottom: 24
      }}
    >
      {videos.map((video) => {
        const progress = videoProgress(video) * 100
        return (
          <button
            key={video.id}
            onClick={() => onSelect(video)}
            style={{
              flex: '0 0 220px',
              textAlign: 'left',
              background: 'var(--bg-2)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                position: 'relative',
                aspectRatio: '16 / 9',
                background: 'var(--bg-3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-2)'
              }}
            >
              {video.thumbnail ? (
                <img
                  src={mediaUrl(video.thumbnail)}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Film size={22} />
              )}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.28)',
                  opacity: 0
                }}
                className="continue-row__play"
              >
                <Play size={26} color="#fff" />
              </div>
              <div className="progress-track" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                <div className="progress-track__fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div style={{ padding: '9px 11px' }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {video.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>
                {formatTime(video.lastPosition)} / {formatTime(video.duration)}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
