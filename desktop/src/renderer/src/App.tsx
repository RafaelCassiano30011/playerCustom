import { useEffect, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { useLibraryStore } from '@/store/library.store'
import { useSettingsStore } from '@/store/settings.store'
import { usePlayerStore } from '@/store/player.store'
import { useCloudStore } from '@/store/cloud.store'
import { useFileDrop } from '@/hooks/useFileDrop'
import { Sidebar } from '@/components/layout/Sidebar'
import { ToastStack } from '@/components/common/ToastStack'
import { toast } from '@/store/toast.store'
import { HomeView } from '@/views/HomeView'
import { CollectionView } from '@/views/CollectionView'
import { FavoritesView } from '@/views/FavoritesView'
import { HistoryView } from '@/views/HistoryView'
import { SearchView } from '@/views/SearchView'
import { SettingsView } from '@/views/SettingsView'

export type View = 'home' | 'collection' | 'favorites' | 'history' | 'search' | 'settings'

export default function App(): JSX.Element {
  const [view, setView] = useState<View>('home')
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [ready, setReady] = useState(false)

  const collections = useLibraryStore((s) => s.collections)
  const loadCollections = useLibraryStore((s) => s.loadCollections)
  const importVideos = useLibraryStore((s) => s.importVideos)
  const loadSettings = useSettingsStore((s) => s.load)
  const initCloud = useCloudStore((s) => s.init)
  const syncFromSettings = usePlayerStore((s) => s.syncFromSettings)
  const fullscreen = usePlayerStore((s) => s.fullscreen)

  // Ao reabrir o app, volta sempre para o Inicio — o progresso de cada
  // video ja fica salvo e disponivel em "Continuar assistindo", sem precisar
  // reabrir o player automaticamente.
  useEffect(() => {
    void (async () => {
      await loadSettings()
      syncFromSettings()
      await loadCollections()
      // depois da biblioteca: o status da nuvem so decora a tela, nao atrasa
      void initCloud()
      setReady(true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return window.api.onFilesDropped((paths) => {
      if (activeCollectionId) void importVideos(activeCollectionId, paths)
      else toast.info('Abra uma colecao para importar arquivos.')
    })
  }, [activeCollectionId, importVideos])

  const handleGlobalDrop = (paths: string[]): void => {
    if (activeCollectionId && view === 'collection') {
      void importVideos(activeCollectionId, paths)
    } else {
      toast.info('Abra uma colecao para importar os arquivos arrastados.')
    }
  }
  const dragging = useFileDrop(handleGlobalDrop)

  const handleNavigate = (next: View): void => {
    setSearchTerm('')
    setView(next)
  }

  const handleSelectCollection = (id: string): void => {
    setActiveCollectionId(id)
    setView('collection')
    setSearchTerm('')
  }

  const handleSearch = (term: string): void => {
    setSearchTerm(term)
    setView(term.trim() ? 'search' : 'home')
  }

  if (!ready) {
    return (
      <div className="app">
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className={`app${fullscreen ? ' app--immersive' : ''}`}>
        <Sidebar
          view={view}
          collections={collections}
          activeCollectionId={activeCollectionId}
          onNavigate={handleNavigate}
          onSelectCollection={handleSelectCollection}
          onCreateCollection={() => setView('home')}
          onSearch={handleSearch}
          searchTerm={searchTerm}
        />

        <main className="main">
          <div className="main__body">
            {view === 'home' && <HomeView onOpenCollection={handleSelectCollection} />}
            {view === 'collection' && activeCollectionId && (
              <CollectionView collectionId={activeCollectionId} />
            )}
            {view === 'favorites' && <FavoritesView onOpenCollection={handleSelectCollection} />}
            {view === 'history' && <HistoryView onOpenCollection={handleSelectCollection} />}
            {view === 'search' && (
              <SearchView term={searchTerm} onOpenCollection={handleSelectCollection} />
            )}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>

      {dragging && (
        <div className="drop-overlay">
          <UploadCloud size={48} />
          <span>Solte os arquivos para importar</span>
        </div>
      )}

      <ToastStack />
    </div>
  )
}
