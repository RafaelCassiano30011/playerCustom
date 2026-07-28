import { useState } from 'react'
import type { Video } from '@shared/types'
import { formatTimeLong, parseTime } from '@shared/time'
import { Modal } from '@/components/common/Modal'
import { useLibraryStore } from '@/store/library.store'
import { usePlayerStore } from '@/store/player.store'
import { toast } from '@/store/toast.store'

interface VideoSettingsModalProps {
  video: Video
  onClose: () => void
}

interface FormState {
  introStart: string
  introEnd: string
  introSkipTo: string
  nextEpisodeOffset: string
}

function toForm(video: Video): FormState {
  return {
    introStart: video.introStart !== null ? formatTimeLong(video.introStart) : '',
    introEnd: video.introEnd !== null ? formatTimeLong(video.introEnd) : '',
    introSkipTo: video.introSkipTo !== null ? formatTimeLong(video.introSkipTo) : '',
    nextEpisodeOffset:
      video.nextEpisodeOffset !== null ? String(Math.round(video.nextEpisodeOffset)) : ''
  }
}

/** Usa o instante atual do player para preencher o campo (botao "usar agora"). */
function useNowFiller(field: keyof FormState, set: (patch: Partial<FormState>) => void) {
  return () => {
    const time = usePlayerStore.getState().currentTime
    set({ [field]: formatTimeLong(time) } as Partial<FormState>)
  }
}

export function VideoSettingsModal({ video, onClose }: VideoSettingsModalProps): JSX.Element {
  const [form, setForm] = useState<FormState>(toForm(video))
  const [saving, setSaving] = useState(false)
  const updateVideo = useLibraryStore((s) => s.updateVideo)

  const patch = (p: Partial<FormState>): void => setForm((prev) => ({ ...prev, ...p }))

  const fillStart = useNowFiller('introStart', patch)
  const fillEnd = useNowFiller('introEnd', patch)
  const fillSkipTo = useNowFiller('introSkipTo', patch)

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
    const result = await updateVideo(video.id, {
      introStart,
      introEnd,
      introSkipTo,
      nextEpisodeOffset
    })
    setSaving(false)
    if (result) {
      toast.success('Configuracoes salvas.')
      onClose()
    }
  }

  return (
    <Modal
      title={`Configurar: ${video.name}`}
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
      <div>
        <div className="section-title" style={{ margin: '0 0 10px' }}>
          Pular abertura
        </div>
        <div className="modal__grid">
          <div className="field">
            <label className="field__label" htmlFor="intro-start">
              Aparece em
            </label>
            <input
              id="intro-start"
              className="input"
              placeholder="00:01:20"
              value={form.introStart}
              onChange={(e) => patch({ introStart: e.target.value })}
            />
            <button className="btn btn--ghost btn--sm" onClick={fillStart} type="button">
              Usar tempo atual
            </button>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="intro-end">
              Some em
            </label>
            <input
              id="intro-end"
              className="input"
              placeholder="00:02:10"
              value={form.introEnd}
              onChange={(e) => patch({ introEnd: e.target.value })}
            />
            <button className="btn btn--ghost btn--sm" onClick={fillEnd} type="button">
              Usar tempo atual
            </button>
          </div>
        </div>
        <div className="field" style={{ marginTop: 14 }}>
          <label className="field__label" htmlFor="intro-skip">
            Ao clicar, avancar para
          </label>
          <input
            id="intro-skip"
            className="input"
            placeholder="00:02:30"
            value={form.introSkipTo}
            onChange={(e) => patch({ introSkipTo: e.target.value })}
          />
          <span className="field__hint">Se vazio, usa o fim da abertura.</span>
          <button className="btn btn--ghost btn--sm" onClick={fillSkipTo} type="button" style={{ alignSelf: 'flex-start' }}>
            Usar tempo atual
          </button>
        </div>
      </div>

      <div>
        <div className="section-title" style={{ margin: '0 0 10px' }}>
          Proximo episodio
        </div>
        <div className="field">
          <label className="field__label" htmlFor="next-offset">
            Exibir faltando (segundos)
          </label>
          <input
            id="next-offset"
            className="input"
            type="number"
            min={5}
            placeholder="60"
            value={form.nextEpisodeOffset}
            onChange={(e) => patch({ nextEpisodeOffset: e.target.value })}
          />
          <span className="field__hint">Deixe vazio para usar o padrao das configuracoes gerais.</span>
        </div>
      </div>
    </Modal>
  )
}
