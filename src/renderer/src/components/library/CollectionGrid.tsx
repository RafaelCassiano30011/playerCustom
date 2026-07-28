import { FolderOpen, Layers, PlusCircle } from 'lucide-react'
import type { CollectionWithStats } from '@shared/types'
import { mediaUrl } from '@/lib/media'

interface CollectionGridProps {
  collections: CollectionWithStats[]
  onOpen: (id: string) => void
  onCreate: () => void
}

export function CollectionGrid({ collections, onOpen, onCreate }: CollectionGridProps): JSX.Element {
  if (collections.length === 0) {
    return (
      <div className="empty">
        <Layers size={40} />
        <div className="empty__title">Nenhuma colecao ainda</div>
        <p className="empty__text">
          Crie uma colecao para organizar seus videos como uma serie, com episodios em ordem
          personalizada.
        </p>
        <button className="btn btn--primary" onClick={onCreate}>
          <PlusCircle size={16} />
          Criar colecao
        </button>
      </div>
    )
  }

  return (
    <div className="card-grid">
      {collections.map((collection) => (
        <button key={collection.id} className="collection-card" onClick={() => onOpen(collection.id)}>
          <div className="collection-card__art">
            {collection.thumbnail ? (
              <img src={mediaUrl(collection.thumbnail)} alt="" />
            ) : (
              <FolderOpen size={30} />
            )}
          </div>
          <div className="collection-card__body">
            <div className="collection-card__name">{collection.name}</div>
            <div className="collection-card__meta">
              {collection.videoCount} video{collection.videoCount === 1 ? '' : 's'}
              {collection.videoCount > 0 &&
                ` · ${collection.completedCount}/${collection.videoCount} concluidos`}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
