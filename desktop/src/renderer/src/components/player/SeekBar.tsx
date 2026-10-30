import { useCallback, useRef, useState } from 'react'
import { formatTime } from '@shared/time'

interface SeekBarProps {
  currentTime: number
  duration: number
  buffered: number
  /** Faixa da abertura destacada na barra. */
  intro?: { start: number; end: number } | null
  onSeek: (time: number) => void
}

export function SeekBar({
  currentTime,
  duration,
  buffered,
  intro,
  onSeek
}: SeekBarProps): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0 || duration <= 0) return 0
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      return ratio * duration
    },
    [duration]
  )

  const startDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (duration <= 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    onSeek(timeFromEvent(event.clientX))
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const time = timeFromEvent(event.clientX)
    setHover(time)
    if (dragging) onSeek(time)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const percent = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferPercent = duration > 0 ? Math.min((buffered / duration) * 100, 100) : 0
  const hoverPercent = hover !== null && duration > 0 ? (hover / duration) * 100 : 0

  return (
    <div
      className={`seekbar${dragging ? ' seekbar--active' : ''}`}
      role="slider"
      aria-label="Progresso"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={formatTime(currentTime)}
      tabIndex={0}
      onPointerDown={startDrag}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => setHover(null)}
    >
      <div className="seekbar__track" ref={trackRef}>
        <div className="seekbar__buffer" style={{ width: `${bufferPercent}%` }} />
        {intro && duration > 0 && (
          <div
            className="seekbar__intro"
            style={{
              left: `${(intro.start / duration) * 100}%`,
              width: `${((intro.end - intro.start) / duration) * 100}%`
            }}
          />
        )}
        <div className="seekbar__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="seekbar__thumb" style={{ left: `${percent}%` }} />
      {hover !== null && (
        <div className="seekbar__tooltip" style={{ left: `${hoverPercent}%` }}>
          {formatTime(hover)}
        </div>
      )}
    </div>
  )
}
