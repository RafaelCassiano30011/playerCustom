import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import type { Collection } from '@shared/types'
import { Modal } from '@/components/common/Modal'
import { useLibraryStore } from '@/store/library.store'
import { mediaUrl } from '@/lib/media'
import { toast } from '@/store/toast.store'

interface CollectionModalProps {
  collection?: Collection | null
  onClose: () => void
  onSaved?: (id: string) => void
}

export function CollectionModal({ collection, onClose, onSaved }: CollectionModalProps): JSX.Element {
  const [name, setName] = useState(collection?.name ?? '')
  const [description, setDescription] = useState(collection?.description ?? '')
  const [thumbnail, setThumbnail] = useState<string | null>(collection?.thumbnail ?? null)
  const [saving, setSaving] = useState(false)

  const createCollection = useLibraryStore((s) => s.createCollection)
  const updateCollection = useLibraryStore((s) => s.updateCollection)

  const pickThumbnail = async (): Promise<void> => {
    const path = await window.api.dialog.pickImage()
    if (path) setThumbnail(path)
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error(new Error('Nome da colecao e obrigatorio.'))
      return
    }
    setSaving(true)
    try {
      if (collection) {
        await updateCollection(collection.id, { name, description, thumbnail })
        onSaved?.(collection.id)
      } else {
        const created = await createCollection({ name, description, thumbnail })
        if (created) onSaved?.(created.id)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={collection ? 'Editar colecao' : 'Nova colecao'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="collection-name">
          Nome
        </label>
        <input
          id="collection-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Minha serie favorita"
          autoFocus
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="collection-description">
          Descricao (opcional)
        </label>
        <textarea
          id="collection-description"
          className="textarea"
          value={description ?? ''}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Sobre o que e essa colecao..."
        />
      </div>

      <div className="field">
        <span className="field__label">Miniatura (opcional)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 96,
              height: 54,
              borderRadius: 8,
              background: 'var(--bg-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              flexShrink: 0,
              color: 'var(--text-2)'
            }}
          >
            {thumbnail ? (
              <img src={mediaUrl(thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <ImageOff size={20} />
            )}
          </div>
          <button className="btn btn--ghost btn--sm" onClick={() => void pickThumbnail()} type="button">
            Escolher imagem
          </button>
          {thumbnail && (
            <button className="btn btn--ghost btn--sm" onClick={() => setThumbnail(null)} type="button">
              Remover
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
