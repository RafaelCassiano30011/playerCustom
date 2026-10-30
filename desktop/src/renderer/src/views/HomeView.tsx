import { useEffect, useState } from 'react'
import { PlusCircle } from 'lucide-react'
import type { Video } from '@shared/types'
import { useLibraryStore } from '@/store/library.store'
import { usePlayerStore } from '@/store/player.store'
import { CollectionGrid } from '@/components/library/CollectionGrid'
import { CollectionModal } from '@/components/library/CollectionModal'
import { ContinueRow } from '@/components/library/ContinueRow'

interface HomeViewProps {
  onOpenCollection: (id: string) => void
}

export function HomeView({ onOpenCollection }: HomeViewProps): JSX.Element {
  const collections = useLibraryStore((s) => s.collections)
  const videos = useLibraryStore((s) => s.videos)
  const [continueWatching, setContinueWatching] = useState<Video[]>([])
  const [creating, setCreating] = useState(false)
  const open = usePlayerStore((s) => s.open)

  useEffect(() => {
    void window.api.videos.continueWatching(10).then(setContinueWatching)
  }, [videos])

  const handleResume = async (video: Video): Promise<void> => {
    const queue = await window.api.videos.byCollection(video.collectionId)
    await open(video, queue)
    onOpenCollection(video.collectionId)
  }

  return (
    <>
      <header className="main__header">
        <div>
          <div className="main__title">Inicio</div>
          <div className="main__subtitle">Suas colecoes e o que voce estava assistindo</div>
        </div>
        <div className="main__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <PlusCircle size={16} />
            Nova colecao
          </button>
        </div>
      </header>

      <div className="scroll-area">
        {continueWatching.length > 0 && (
          <>
            <div className="section-title">Continuar assistindo</div>
            <ContinueRow videos={continueWatching} onSelect={(v) => void handleResume(v)} />
          </>
        )}

        <div className="section-title">Colecoes</div>
        <CollectionGrid collections={collections} onOpen={onOpenCollection} onCreate={() => setCreating(true)} />
      </div>

      {creating && (
        <CollectionModal onClose={() => setCreating(false)} onSaved={(id) => onOpenCollection(id)} />
      )}
    </>
  )
}
