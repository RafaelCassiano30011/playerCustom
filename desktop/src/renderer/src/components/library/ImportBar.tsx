import { CloudUpload, FolderPlus, Loader2, Upload } from 'lucide-react'
import { useLibraryStore } from '@/store/library.store'
import { useCloudStore } from '@/store/cloud.store'

interface ImportBarProps {
  collectionId: string
}

export function ImportBar({ collectionId }: ImportBarProps): JSX.Element {
  const importing = useLibraryStore((s) => s.importing)
  const importVideos = useLibraryStore((s) => s.importVideos)

  const signedIn = useCloudStore((s) => s.status.signedIn)
  const uploads = useCloudStore((s) => s.uploads)
  const upload = useCloudStore((s) => s.upload)

  const enviando = uploads.some((u) => u.state === 'uploading')
  const enviandoPercentual = Math.round(
    (uploads.find((u) => u.state === 'uploading')?.fraction ?? 0) * 100
  )

  const pickForUpload = async (): Promise<void> => {
    const paths = await window.api.dialog.pickVideos()
    if (paths.length > 0) void upload(collectionId, paths)
  }

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
      {signedIn && (
        <button
          className="btn btn--ghost"
          onClick={() => void pickForUpload()}
          disabled={enviando}
          title="Envia para a nuvem e deixa disponivel na TV"
        >
          {enviando ? <Loader2 size={15} className="spin" /> : <CloudUpload size={15} />}
          {enviando ? `Enviando ${enviandoPercentual}%` : 'Enviar para a nuvem'}
        </button>
      )}
    </div>
  )
}
