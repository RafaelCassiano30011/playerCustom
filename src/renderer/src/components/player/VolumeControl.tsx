import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'

interface VolumeControlProps {
  volume: number
  muted: boolean
  onChange: (value: number) => void
  onToggleMute: () => void
}

export function VolumeControl({
  volume,
  muted,
  onChange,
  onToggleMute
}: VolumeControlProps): JSX.Element {
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.7 ? Volume1 : Volume2

  return (
    <div className="volume">
      <button
        className="icon-btn"
        onClick={onToggleMute}
        aria-label={muted ? 'Ativar som' : 'Silenciar'}
        title="Mudo (M)"
      >
        <Icon size={20} />
      </button>
      <div className="volume__slider">
        <input
          className="slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Volume"
        />
      </div>
    </div>
  )
}
