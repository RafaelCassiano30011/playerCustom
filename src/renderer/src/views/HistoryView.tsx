import { useEffect, useState } from 'react'
import { Clock, Trash2 } from 'lucide-react'
import type { HistoryEntry } from '@shared/types'
import { formatDate, formatTime } from '@shared/time'
import { usePlayerStore } from '@/store/player.store'
import { toast } from '@/store/toast.store'

interface HistoryViewProps {
  onOpenCollection: (id: string) => void
}

export function HistoryView({ onOpenCollection }: HistoryViewProps): JSX.Element {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const open = usePlayerStore((s) => s.open)

  const load = (): void => {
    void window.api.history.list(200).then(setEntries)
  }

  useEffect(load, [])

  const handleClear = async (): Promise<void> => {
    try {
      await window.api.history.clear()
      setEntries([])
      toast.success('Historico limpo.')
    } catch (error) {
      toast.error(error)
    }
  }

  const handlePlay = async (entry: HistoryEntry): Promise<void> => {
    const video = await window.api.videos.get(entry.videoId)
    if (!video) {
      toast.error(new Error('Video nao encontrado (pode ter sido removido).'))
      return
    }
    const queue = await window.api.videos.byCollection(video.collectionId)
    await open(video, queue)
    onOpenCollection(video.collectionId)
  }

  return (
    <>
      <header className="main__header">
        <div>
          <div className="main__title">Historico</div>
          <div className="main__subtitle">{entries.length} registro(s)</div>
        </div>
        <div className="main__actions">
          {entries.length > 0 && (
            <button className="btn btn--ghost" onClick={() => void handleClear()}>
              <Trash2 size={15} />
              Limpar historico
            </button>
          )}
        </div>
      </header>
      <div className="scroll-area">
        {entries.length === 0 ? (
          <div className="empty">
            <Clock size={34} />
            <div className="empty__title">Sem historico ainda</div>
            <p className="empty__text">Videos assistidos aparecem aqui automaticamente.</p>
          </div>
        ) : (
          <div className="row-list">
            {entries.map((entry) => (
              <button key={entry.id} className="row" onClick={() => void handlePlay(entry)}>
                <div className="row__main">
                  <div className="row__title">{entry.videoName}</div>
                  <div className="row__sub">
                    {entry.collectionName} · parou em {formatTime(entry.position)} · {formatDate(entry.playedAt)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
