import { useState } from 'react'
import { formatTimeLong, parseTime } from '@shared/time'
import { Modal } from '@/components/common/Modal'
import { Switch } from '@/components/common/Switch'
import { useLibraryStore } from '@/store/library.store'
import { toast } from '@/store/toast.store'

interface CollectionSettingsModalProps {
  collectionId: string
  episodeCount: number
  onClose: () => void
}

interface FormState {
  introStart: string
  introEnd: string
  introSkipTo: string
  nextEpisodeOffset: string
  overwrite: boolean
}

const EMPTY_FORM: FormState = {
  introStart: '',
  introEnd: '',
  introSkipTo: '',
  nextEpisodeOffset: '',
  overwrite: false
}

/**
 * Configura "pular abertura" e "proximo episodio" para a colecao inteira de
 * uma vez, em vez de exigir abrir cada episodio individualmente. Util para
 * series com abertura no mesmo tempo em todos os episodios.
 */
export function CollectionSettingsModal({
  collectionId,
  episodeCount,
  onClose
}: CollectionSettingsModalProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const applyCollectionDefaults = useLibraryStore((s) => s.applyCollectionDefaults)

  const patch = (p: Partial<FormState>): void => setForm((prev) => ({ ...prev, ...p }))

  const handleSave = async (): Promise<void> => {
    const introStart = form.introStart.trim() ? parseTime(form.introStart) : null
    const introEnd = form.introEnd.trim() ? parseTime(form.introEnd) : null
    const introSkipTo = form.introSkipTo.trim() ? parseTime(form.introSkipTo) : null
    const nextEpisodeOffset = form.nextEpisodeOffset.trim() ? Number(form.nextEpisodeOffset) : null

    if (form.introStart.trim() && introStart === null) return toast.error(new Error('Inicio da abertura invalido.'))
    if (form.introEnd.trim() && introEnd === null) return toast.error(new Error('Fim da abertura invalido.'))
    if (form.introSkipTo.trim() && introSkipTo === null) return toast.error(new Error('Destino do pulo invalido.'))
    if (introStart !== null && introEnd !== null && introEnd <= introStart) {
      return toast.error(new Error('Fim da abertura deve ser depois do inicio.'))
    }
    if (nextEpisodeOffset !== null && (Number.isNaN(nextEpisodeOffset) || nextEpisodeOffset <= 0)) {
      return toast.error(new Error('Tempo de "proximo episodio" invalido.'))
    }

    setSaving(true)
    const ok = await applyCollectionDefaults({
      collectionId,
      introStart,
      introEnd,
      introSkipTo,
      nextEpisodeOffset,
      overwrite: form.overwrite
    })
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Configurar abertura / proximo episodio"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Aplicando...' : `Aplicar aos ${episodeCount} episodios`}
          </button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)', fontSize: 12.5, lineHeight: 1.5 }}>
        Define de uma vez o tempo da abertura e o aviso de proximo episodio para todos os
        episodios desta colecao. Cada episodio ainda pode ser ajustado individualmente depois.
      </p>

      <div className="modal__grid">
        <div className="field">
          <label className="field__label" htmlFor="col-intro-start">
            Abertura aparece em
          </label>
          <input
            id="col-intro-start"
            className="input"
            placeholder={formatTimeLong(0)}
            value={form.introStart}
            onChange={(e) => patch({ introStart: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="col-intro-end">
            Some em
          </label>
          <input
            id="col-intro-end"
            className="input"
            placeholder={formatTimeLong(90)}
            value={form.introEnd}
            onChange={(e) => patch({ introEnd: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="col-intro-skip">
          Ao clicar, avancar para
        </label>
        <input
          id="col-intro-skip"
          className="input"
          placeholder={formatTimeLong(150)}
          value={form.introSkipTo}
          onChange={(e) => patch({ introSkipTo: e.target.value })}
        />
        <span className="field__hint">Se vazio, usa o fim da abertura.</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="col-next-offset">
          Proximo episodio: exibir faltando (segundos)
        </label>
        <input
          id="col-next-offset"
          className="input"
          type="number"
          min={5}
          placeholder="60"
          value={form.nextEpisodeOffset}
          onChange={(e) => patch({ nextEpisodeOffset: e.target.value })}
        />
      </div>

      <div className="settings-row" style={{ paddingTop: 4 }}>
        <div>
          <div className="settings-row__label">Sobrescrever ja configurados</div>
          <div className="settings-row__hint">
            Desligado: so preenche episodios sem abertura configurada ainda.
          </div>
        </div>
        <Switch checked={form.overwrite} onChange={(v) => patch({ overwrite: v })} />
      </div>
    </Modal>
  )
}
