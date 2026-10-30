import { FolderPlus, Upload } from 'lucide-react'
import { useLibraryStore } from '@/store/library.store'

interface ImportBarProps {
  collectionId: string
}

export function ImportBar({ collectionId }: ImportBarProps): JSX.Element {
  const importing = useLibraryStore((s) => s.importing)
  const importVideos = useLibraryStore((s) => s.importVideos)

  const pickFiles = async (): Promise<void> => {
    const paths = await window.api.dialog.pickVideos()
    if (paths.length > 0) void importVideos(collectionId, paths)
  }

  const pickFolder = async (): Promise<void> => {
    const paths = await window.api.dialog.pickFolder()
    if (paths.length > 0) void importVideos(collectionId, paths)
  }

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="btn" onClick={() => void pickFiles()} disabled={importing}>
        <Upload size={15} />
        Importar videos
      </button>
      <button className="btn btn--ghost" onClick={() => void pickFolder()} disabled={importing}>
        <FolderPlus size={15} />
        Importar pasta
      </button>
    </div>
  )
}
