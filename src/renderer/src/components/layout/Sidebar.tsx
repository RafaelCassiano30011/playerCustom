import { Clapperboard, Clock, Heart, Home, Search, Settings, PlusCircle } from 'lucide-react'
import type { CollectionWithStats } from '@shared/types'
import type { View } from '@/App'

interface SidebarProps {
  view: View
  collections: CollectionWithStats[]
  activeCollectionId: string | null
  onNavigate: (view: View) => void
  onSelectCollection: (id: string) => void
  onCreateCollection: () => void
  onSearch: (term: string) => void
  searchTerm: string
}

export function Sidebar({
  view,
  collections,
  activeCollectionId,
  onNavigate,
  onSelectCollection,
  onCreateCollection,
  onSearch,
  searchTerm
}: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <Clapperboard size={22} />
        <span>playerCustom</span>
      </div>

      <div className="sidebar__search">
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar videos e colecoes..."
            value={searchTerm}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      <nav className="sidebar__nav">
        <button
          className={`nav-item${view === 'home' ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate('home')}
        >
          <Home size={16} />
          Inicio
        </button>
        <button
          className={`nav-item${view === 'favorites' ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate('favorites')}
        >
          <Heart size={16} />
          Favoritos
        </button>
        <button
          className={`nav-item${view === 'history' ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate('history')}
        >
          <Clock size={16} />
          Historico
        </button>
      </nav>

      <div className="sidebar__section">
        <span>Colecoes</span>
        <button className="icon-btn" onClick={onCreateCollection} aria-label="Nova colecao" title="Nova colecao">
          <PlusCircle size={16} />
        </button>
      </div>

      <div className="sidebar__list">
        {collections.map((collection) => (
          <button
            key={collection.id}
            className={`nav-item${
              view === 'collection' && activeCollectionId === collection.id ? ' nav-item--active' : ''
            }`}
            onClick={() => onSelectCollection(collection.id)}
            title={collection.name}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {collection.name}
            </span>
            <span className="nav-item__count">{collection.videoCount}</span>
          </button>
        ))}
        {collections.length === 0 && (
          <span style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-2)' }}>
            Nenhuma colecao criada.
          </span>
        )}
      </div>

      <div className="sidebar__footer">
        <button
          className={`nav-item${view === 'settings' ? ' nav-item--active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={16} />
          Configuracoes
        </button>
      </div>
    </aside>
  )
}
