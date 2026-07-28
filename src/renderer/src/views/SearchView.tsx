import { useEffect, useState } from 'react'
import { Film, FolderOpen, SearchX } from 'lucide-react'
import type { SearchResult, Video } from '@shared/types'
import { formatTime } from '@shared/time'
import { usePlayerStore } from '@/store/player.store'

interface SearchViewProps {
  term: string
  onOpenCollection: (id: string) => void
}

export function SearchView({ term, onOpenCollection }: SearchViewProps): JSX.Element {
  const [result, setResult] = useState<SearchResult>({ collections: [], videos: [] })
  const open = usePlayerStore((s) => s.open)

  useEffect(() => {
    let active = true
    void window.api.search(term).then((r) => {
      if (active) setResult(r)
    })
    return () => {
      active = false
    }
  }, [term])

  const handlePlay = async (video: Video): Promise<void> => {
    const queue = await window.api.videos.byCollection(video.collectionId)
    await open(video, queue)
    onOpenCollection(video.collectionId)
  }

  const empty = result.collections.length === 0 && result.videos.length === 0

  return (
    <>
      <header className="main__header">
        <div>
          <div className="main__title">Resultados para &quot;{term}&quot;</div>
          <div className="main__subtitle">
            {result.collections.length} colecao(oes) · {result.videos.length} video(s)
          </div>
        </div>
      </header>

      <div className="scroll-area">
        {empty ? (
          <div className="empty">
            <SearchX size={34} />
            <div className="empty__title">Nada encontrado</div>
            <p className="empty__text">Tente outro termo de busca.</p>
          </div>
        ) : (
          <>
            {result.collections.length > 0 && (
              <>
                <div className="section-title">Colecoes</div>
                <div className="row-list" style={{ marginBottom: 24 }}>
                  {result.collections.map((collection) => (
                    <button key={collection.id} className="row" onClick={() => onOpenCollection(collection.id)}>
                      <FolderOpen size={16} color="var(--text-2)" />
                      <div className="row__main">
                        <div className="row__title">{collection.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {result.videos.length > 0 && (
              <>
                <div className="section-title">Videos</div>
                <div className="row-list">
                  {result.videos.map((video) => (
                    <button key={video.id} className="row" onClick={() => void handlePlay(video)}>
                      <Film size={16} color="var(--text-2)" />
                      <div className="row__main">
                        <div className="row__title">{video.name}</div>
                        <div className="row__sub">{formatTime(video.duration)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
