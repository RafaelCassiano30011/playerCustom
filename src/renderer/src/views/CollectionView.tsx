import { useEffect, useState } from 'react'
import { Pencil, Settings2, Trash2 } from 'lucide-react'
import type { Video } from '@shared/types'
import { useLibraryStore } from '@/store/library.store'
import { useSettingsStore } from '@/store/settings.store'
import { usePlayerStore } from '@/store/player.store'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { EpisodeList } from '@/components/library/EpisodeList'
import { ImportBar } from '@/components/library/ImportBar'
import { CollectionModal } from '@/components/library/CollectionModal'
import { CollectionSettingsModal } from '@/components/library/CollectionSettingsModal'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

interface CollectionViewProps {
  collectionId: string
}

export function CollectionView({ collectionId }: CollectionViewProps): JSX.Element {
  const collections = useLibraryStore((s) => s.collections)
  const videos = useLibraryStore((s) => s.videos)
  const selectCollection = useLibraryStore((s) => s.selectCollection)
  const deleteCollection = useLibraryStore((s) => s.deleteCollection)
  const autoThumbnails = useSettingsStore((s) => s.settings.autoThumbnails)
  const open = usePlayerStore((s) => s.open)
  const activeVideo = usePlayerStore((s) => s.video)
  const fullscreen = usePlayerStore((s) => s.fullscreen)

  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [configuring, setConfiguring] = useState(false)

  const collection = collections.find((c) => c.id === collectionId)

  useEffect(() => {
    void selectCollection(collectionId)
  }, [collectionId, selectCollection])

  const handlePlay = (video: Video): void => {
    void open(video, videos)
  }

  if (!collection) {
    return <div className="scroll-area" />
  }

  return (
    <>
      {!fullscreen && (
        <header className="main__header">
          <div style={{ minWidth: 0 }}>
            <div className="main__title">{collection.name}</div>
            <div className="main__subtitle">
              {collection.videoCount} video{collection.videoCount === 1 ? '' : 's'} ·{' '}
              {collection.completedCount} concluido{collection.completedCount === 1 ? '' : 's'}
            </div>
          </div>
          <div className="main__actions">
            <ImportBar collectionId={collectionId} />
            <button
              className="icon-btn"
              onClick={() => setConfiguring(true)}
              aria-label="Configurar abertura e proximo episodio"
              title="Configurar abertura / proximo episodio para todos os episodios"
            >
              <Settings2 size={16} />
            </button>
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Editar" title="Editar colecao">
              <Pencil size={16} />
            </button>
            <button className="icon-btn" onClick={() => setDeleting(true)} aria-label="Excluir" title="Excluir colecao">
              <Trash2 size={16} />
            </button>
          </div>
        </header>
      )}

      <div className={`watch${fullscreen ? ' watch--immersive' : ''}`}>
        <VideoPlayer />
        <div className="watch__side">
          <div className="episodes">
            <div className="episodes__header">Episodios</div>
            <EpisodeList
              collectionId={collectionId}
              videos={videos}
              activeVideoId={activeVideo?.id ?? null}
              autoThumbnails={autoThumbnails}
              onPlay={handlePlay}
            />
          </div>
        </div>
      </div>

      {editing && <CollectionModal collection={collection} onClose={() => setEditing(false)} />}

      {configuring && (
        <CollectionSettingsModal
          collectionId={collectionId}
          episodeCount={collection.videoCount}
          onClose={() => setConfiguring(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir colecao"
          message={`Excluir "${collection.name}" e todos os seus ${collection.videoCount} video(s)? Os arquivos originais nao serao apagados do disco.`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => void deleteCollection(collectionId)}
          onCancel={() => setDeleting(false)}
        />
      )}
    </>
  )
}
