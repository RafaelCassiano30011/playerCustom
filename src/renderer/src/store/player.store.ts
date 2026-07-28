import { create } from 'zustand'
import { clamp, isCompleted } from '@shared/time'
import type { EmbeddedTrackInfo, ProbeResult, RepeatMode, SubtitleTrack, Video } from '@shared/types'
import { toast } from './toast.store'
import { useLibraryStore } from './library.store'
import { useSettingsStore } from './settings.store'

const EMPTY_PROBE: ProbeResult = { audio: [], subtitle: [] }

export interface AudioTrackInfo {
  id: string
  label: string
  enabled: boolean
}

interface PlayerState {
  video: Video | null
  queue: Video[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null

  playing: boolean
  currentTime: number
  duration: number
  buffered: number

  volume: number
  muted: boolean
  rate: number
  fullscreen: boolean

  shuffle: boolean
  repeat: RepeatMode
  autoPlayNext: boolean

  /** Usuario fechou o aviso de proximo episodio para este video. */
  nextDismissed: boolean
  subtitle: SubtitleTrack | null
  subtitlesEnabled: boolean
  audioTracks: AudioTrackInfo[]

  /** Faixas embutidas no arquivo (MKV/MP4) detectadas via ffprobe. */
  embeddedTracks: ProbeResult
  activeEmbeddedAudioIndex: number | null
  activeEmbeddedSubtitleIndex: number | null
  extractingSubtitle: boolean

  /**
   * Faixa de audio forcada via ffmpeg. O stream remultiplexado preserva os
   * timestamps originais (`-copyts`), entao o tempo do elemento continua
   * sendo o tempo real do video — sem deslocamento a compensar.
   */
  audioTrackIndex: number | null

  attach: (element: HTMLVideoElement | null) => void
  syncFromSettings: () => void

  open: (video: Video, queue: Video[], options?: { autoplay?: boolean }) => Promise<void>
  close: () => void

  play: () => void
  pause: () => void
  togglePlay: () => void
  seek: (time: number) => void
  seekBy: (delta: number) => void
  setVolume: (value: number) => void
  bumpVolume: (delta: number) => void
  toggleMute: () => void
  setRate: (value: number) => void
  bumpRate: (delta: number) => void
  setFullscreen: (value: boolean) => Promise<void>
  toggleFullscreen: () => Promise<void>

  toggleShuffle: () => void
  cycleRepeat: () => void
  toggleAutoPlayNext: () => void

  skipIntro: () => void
  dismissNext: () => void
  playNext: (reason?: 'user' | 'auto') => Promise<boolean>
  playPrevious: () => Promise<void>
  hasNext: () => boolean

  loadSubtitle: (path: string) => Promise<void>
  clearSubtitle: () => void
  toggleSubtitles: () => void
  setAudioTrack: (id: string) => void

  /** Troca a faixa de audio remultiplexando o arquivo via ffmpeg. */
  selectEmbeddedAudioTrack: (track: EmbeddedTrackInfo) => void
  /** Volta a reproduzir o arquivo original, sem remux. */
  resetAudioTrack: () => void
  /** Extrai (com cache) e carrega uma legenda embutida em texto (SRT/ASS/MOV_TEXT). */
  selectEmbeddedSubtitleTrack: (track: EmbeddedTrackInfo) => Promise<void>

  /** Persiste a posicao atual. `force` ignora o intervalo minimo. */
  persistProgress: (force?: boolean) => Promise<void>

  /* Handlers do elemento <video> */
  onTimeUpdate: (time: number, buffered: number) => void
  onLoadedMetadata: (duration: number, tracks: AudioTrackInfo[]) => void
  onEnded: () => void
  onError: (message: string) => void
  onPlayingChange: (playing: boolean) => void
}

/** Elemento <video> vive fora do estado reativo: mutavel e nao serializavel. */
let element: HTMLVideoElement | null = null
let pendingSeek: number | null = null
let lastPersistAt = 0
const PERSIST_INTERVAL_MS = 4000

function readAudioTracks(el: HTMLVideoElement): AudioTrackInfo[] {
  const tracks = (el as unknown as { audioTracks?: ArrayLike<Record<string, unknown>> }).audioTracks
  if (!tracks || tracks.length <= 1) return []
  return Array.from(tracks as ArrayLike<Record<string, unknown>>).map((track, index) => ({
    id: String(track.id ?? index),
    label: String(track.label || track.language || `Faixa ${index + 1}`),
    enabled: Boolean(track.enabled)
  }))
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  video: null,
  queue: [],
  status: 'idle',
  error: null,

  playing: false,
  currentTime: 0,
  duration: 0,
  buffered: 0,

  volume: 0.8,
  muted: false,
  rate: 1,
  fullscreen: false,

  shuffle: false,
  repeat: 'off',
  autoPlayNext: true,

  nextDismissed: false,
  subtitle: null,
  subtitlesEnabled: true,
  audioTracks: [],

  embeddedTracks: EMPTY_PROBE,
  activeEmbeddedAudioIndex: null,
  activeEmbeddedSubtitleIndex: null,
  extractingSubtitle: false,

  audioTrackIndex: null,

  attach: (el) => {
    element = el
    if (!el) return
    const { volume, muted, rate } = get()
    el.volume = volume
    el.muted = muted
    el.playbackRate = rate
  },

  syncFromSettings: () => {
    const s = useSettingsStore.getState().settings
    set({
      volume: s.volume,
      muted: s.muted,
      rate: s.playbackRate,
      shuffle: s.shuffle,
      repeat: s.repeat,
      autoPlayNext: s.autoPlayNext,
      subtitlesEnabled: s.subtitlesEnabled
    })
    if (element) {
      element.volume = s.volume
      element.muted = s.muted
      element.playbackRate = s.playbackRate
    }
  },

  open: async (video, queue, options) => {
    const current = get().video
    if (current && current.id !== video.id) await get().persistProgress(true)

    set({
      video,
      queue,
      status: 'loading',
      error: null,
      currentTime: video.lastPosition,
      duration: video.duration || 0,
      buffered: 0,
      nextDismissed: false,
      subtitle: null,
      audioTracks: [],
      embeddedTracks: EMPTY_PROBE,
      activeEmbeddedAudioIndex: null,
      activeEmbeddedSubtitleIndex: null,
      audioTrackIndex: null,
      playing: false
    })

    // Recomeca do zero se o video ja terminou; senao retoma de onde parou.
    const resume =
      video.status === 'completed' || isCompleted(video.lastPosition, video.duration)
        ? 0
        : video.lastPosition
    pendingSeek = resume > 1 ? resume : null

    if (element) {
      element.src = window.api.files.toMediaUrl(video.path)
      element.load()
      if (options?.autoplay !== false) {
        void element.play().catch(() => set({ playing: false }))
      }
    }

    void window.api.settings.update({ lastVideoId: video.id, lastCollectionId: video.collectionId })

    // ffprobe e a busca por legenda so rodam depois que o video ja comecou a
    // tocar: disputar disco durante a abertura atrasa o inicio da reproducao.
    // Nada aqui e necessario para o primeiro frame aparecer.
    let sideLoadsDone = false
    const deferSideLoads = (): void => {
      if (sideLoadsDone) return
      sideLoadsDone = true

      void window.api.tracks
        .probe(video.path)
        .then((probe) => {
          if (get().video?.id !== video.id) return
          const defaultAudio = probe.audio.find((t) => t.isDefault) ?? probe.audio[0]
          set({
            embeddedTracks: probe,
            activeEmbeddedAudioIndex: defaultAudio?.index ?? null
          })
        })
        .catch(() => undefined)

      if (useSettingsStore.getState().settings.subtitlesEnabled) {
        void window.api.subtitles
          .auto(video.path)
          .then((track) => {
            if (track && get().video?.id === video.id) set({ subtitle: track })
          })
          .catch(() => undefined)
      }
    }

    if (element) {
      element.addEventListener('playing', deferSideLoads, { once: true })
      // Se a reproducao nao comecar (autoplay: false, erro), roda mesmo assim.
      setTimeout(() => {
        if (get().video?.id === video.id) deferSideLoads()
      }, 4000)
    } else {
      deferSideLoads()
    }
  },

  close: () => {
    void get().persistProgress(true)
    if (element) {
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
    set({
      video: null,
      queue: [],
      status: 'idle',
      playing: false,
      currentTime: 0,
      duration: 0,
      subtitle: null,
      audioTracks: []
    })
  },

  play: () => {
    void element?.play().catch((error: unknown) => {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    })
  },
  pause: () => {
    element?.pause()
    void get().persistProgress(true)
  },
  togglePlay: () => (get().playing ? get().pause() : get().play()),

  seek: (time) => {
    if (!element) return
    const { duration, audioTrackIndex, video, playing } = get()
    const total = duration || element.duration || 0
    const target = clamp(time, 0, total > 0 ? total : time)

    // Em modo remux o stream nao aceita Range: reiniciamos o ffmpeg no
    // instante desejado. Como os timestamps sao preservados, o elemento ja
    // reporta o tempo real assim que carrega (pode ser o keyframe anterior).
    if (audioTrackIndex !== null && video) {
      set({ currentTime: target, status: 'loading' })
      element.src = window.api.files.toAudioTrackUrl(video.path, audioTrackIndex, target)
      element.load()
      if (playing) void element.play().catch(() => set({ playing: false }))
      return
    }

    element.currentTime = target
    set({ currentTime: target })
  },
  seekBy: (delta) => get().seek(get().currentTime + delta),

  setVolume: (value) => {
    const volume = clamp(value, 0, 1)
    if (element) {
      element.volume = volume
      element.muted = volume === 0
    }
    set({ volume, muted: volume === 0 })
    void useSettingsStore.getState().patch({ volume, muted: volume === 0 })
  },
  bumpVolume: (delta) => get().setVolume(get().volume + delta),

  toggleMute: () => {
    const muted = !get().muted
    if (element) element.muted = muted
    set({ muted })
    void useSettingsStore.getState().patch({ muted })
  },

  setRate: (value) => {
    const rate = clamp(value, 0.25, 4)
    if (element) element.playbackRate = rate
    set({ rate })
    void useSettingsStore.getState().patch({ playbackRate: rate })
  },
  bumpRate: (delta) => get().setRate(Number((get().rate + delta).toFixed(2))),

  setFullscreen: async (value) => {
    try {
      const active = await window.api.window.setFullscreen(value)
      set({ fullscreen: active })
    } catch (error) {
      toast.error(error)
    }
  },
  toggleFullscreen: async () => get().setFullscreen(!get().fullscreen),

  toggleShuffle: () => {
    const shuffle = !get().shuffle
    set({ shuffle })
    void useSettingsStore.getState().patch({ shuffle })
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one']
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length]
    set({ repeat })
    void useSettingsStore.getState().patch({ repeat })
  },

  toggleAutoPlayNext: () => {
    const autoPlayNext = !get().autoPlayNext
    set({ autoPlayNext })
    void useSettingsStore.getState().patch({ autoPlayNext })
  },

  skipIntro: () => {
    const { video, duration } = get()
    if (!video) return
    const target = video.introSkipTo ?? video.introEnd ?? 0
    get().seek(clamp(target, 0, duration || target))
    get().play()
  },

  dismissNext: () => set({ nextDismissed: true }),

  hasNext: () => {
    const { video, queue, repeat, shuffle } = get()
    if (!video || queue.length === 0) return false
    if (repeat === 'all' || shuffle) return queue.length > 1
    return queue.findIndex((v) => v.id === video.id) < queue.length - 1
  },

  playNext: async (reason = 'user') => {
    const { video, queue, shuffle, repeat } = get()
    if (!video || queue.length === 0) return false

    if (repeat === 'one' && reason === 'auto') {
      get().seek(0)
      get().play()
      return true
    }

    const index = queue.findIndex((v) => v.id === video.id)
    let next: Video | undefined

    if (shuffle && queue.length > 1) {
      const pool = queue.filter((v) => v.id !== video.id)
      next = pool[Math.floor(Math.random() * pool.length)]
    } else if (index >= 0 && index < queue.length - 1) {
      next = queue[index + 1]
    } else if (repeat === 'all') {
      next = queue[0]
    }

    // Ultimo da colecao sem repeticao: nada de autoplay.
    if (!next) {
      set({ playing: false })
      return false
    }

    const fresh = (await window.api.videos.get(next.id)) ?? next
    await get().open(fresh, queue)
    return true
  },

  playPrevious: async () => {
    const { video, queue, currentTime } = get()
    if (!video) return
    // Estilo VLC: nos primeiros 5s volta um episodio, depois reinicia o atual.
    if (currentTime > 5) {
      get().seek(0)
      return
    }
    const index = queue.findIndex((v) => v.id === video.id)
    const previous = index > 0 ? queue[index - 1] : null
    if (!previous) {
      get().seek(0)
      return
    }
    const fresh = (await window.api.videos.get(previous.id)) ?? previous
    await get().open(fresh, queue)
  },

  loadSubtitle: async (path) => {
    try {
      const track = await window.api.subtitles.load(path)
      if (!track) {
        toast.error(new Error('Legenda vazia ou em formato nao suportado.'))
        return
      }
      set({ subtitle: track, subtitlesEnabled: true })
      toast.success(`Legenda carregada: ${track.label}`)
    } catch (error) {
      toast.error(error)
    }
  },
  clearSubtitle: () => set({ subtitle: null }),
  toggleSubtitles: () => {
    const subtitlesEnabled = !get().subtitlesEnabled
    set({ subtitlesEnabled })
    void useSettingsStore.getState().patch({ subtitlesEnabled })
  },

  setAudioTrack: (id) => {
    if (!element) return
    const tracks = (element as unknown as { audioTracks?: ArrayLike<Record<string, unknown>> })
      .audioTracks
    if (!tracks) return
    Array.from(tracks as ArrayLike<Record<string, unknown>>).forEach((track, index) => {
      track.enabled = String(track.id ?? index) === id
    })
    set({ audioTracks: readAudioTracks(element) })
  },

  /**
   * O Chromium nao expoe `audioTracks` e nao decodifica AC3/DTS, entao a troca
   * so e possivel remultiplexando o arquivo no processo principal. Recarregamos
   * a partir do instante atual para o corte ser imperceptivel.
   */
  selectEmbeddedAudioTrack: (track) => {
    const { video, currentTime } = get()
    if (!video || !element) return

    const startAt = Math.max(0, currentTime)
    set({
      activeEmbeddedAudioIndex: track.index,
      audioTrackIndex: track.index,
      currentTime: startAt,
      status: 'loading',
      error: null
    })

    element.src = window.api.files.toAudioTrackUrl(video.path, track.index, startAt)
    element.load()
    // Trocar faixa e uma acao explicita: sempre retoma a reproducao.
    void element.play().catch(() => set({ playing: false }))
  },

  resetAudioTrack: () => {
    const { video, currentTime, playing, audioTrackIndex } = get()
    if (!video || !element || audioTrackIndex === null) return

    const resume = Math.max(0, currentTime)
    set({
      audioTrackIndex: null,
      activeEmbeddedAudioIndex: null,
      currentTime: resume,
      status: 'loading'
    })
    pendingSeek = resume > 1 ? resume : null
    element.src = window.api.files.toMediaUrl(video.path)
    element.load()
    if (playing) void element.play().catch(() => set({ playing: false }))
  },

  selectEmbeddedSubtitleTrack: async (track) => {
    const { video } = get()
    if (!video) return
    set({ extractingSubtitle: true, activeEmbeddedSubtitleIndex: track.index })
    try {
      const path = await window.api.tracks.extractSubtitle(video.path, track.index)
      if (get().video?.id !== video.id) return
      if (!path) {
        toast.error(
          new Error('Nao foi possivel extrair esta legenda (provavelmente e uma legenda de imagem).')
        )
        set({ activeEmbeddedSubtitleIndex: null })
        return
      }
      await get().loadSubtitle(path)
    } finally {
      if (get().video?.id === video.id) set({ extractingSubtitle: false })
    }
  },

  persistProgress: async (force = false) => {
    const { video, currentTime, duration } = get()
    if (!video || duration <= 0) return

    const now = Date.now()
    if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) return
    lastPersistAt = now

    try {
      const saved = await window.api.videos.saveProgress({
        videoId: video.id,
        position: currentTime,
        duration
      })
      set((state) => ({
        video: state.video?.id === saved.id ? saved : state.video,
        queue: state.queue.map((v) => (v.id === saved.id ? saved : v))
      }))
      useLibraryStore.getState().patchVideoLocal(saved)
    } catch (error) {
      console.error('[player] falha ao salvar progresso', error)
    }
  },

  onTimeUpdate: (time, buffered) => {
    set({ currentTime: time, buffered })
    void get().persistProgress()
  },

  onLoadedMetadata: (duration, tracks) => {
    const { audioTrackIndex, video } = get()

    // Em modo remux o stream nao e "seekable": mexer em currentTime falharia.
    // A posicao ja vem correta do proprio stream (timestamps preservados).
    if (audioTrackIndex !== null) {
      set({
        status: 'ready',
        audioTracks: tracks,
        duration: duration > 0 && Number.isFinite(duration) ? duration : video?.duration || 0
      })
      return
    }

    set({ duration, status: 'ready', audioTracks: tracks })
    if (pendingSeek !== null && element) {
      element.currentTime = clamp(pendingSeek, 0, duration)
      set({ currentTime: element.currentTime })
      pendingSeek = null
    }
    if (video && Math.abs((video.duration || 0) - duration) > 0.5) {
      void useLibraryStore.getState().updateVideo(video.id, { duration })
    }
  },

  onEnded: () => {
    const { video, duration, autoPlayNext, repeat } = get()
    set({ playing: false })
    if (video) {
      void window.api.videos
        .saveProgress({ videoId: video.id, position: duration, duration, completed: true })
        .then((saved) => {
          useLibraryStore.getState().patchVideoLocal(saved)
          void useLibraryStore.getState().loadCollections()
        })
        .catch(() => undefined)
    }
    if (repeat === 'one') {
      get().seek(0)
      get().play()
      return
    }
    if (autoPlayNext) void get().playNext('auto')
  },

  onError: (message) => set({ status: 'error', error: message, playing: false }),
  onPlayingChange: (playing) => set({ playing })
}))

/** Acesso ao elemento para casos pontuais (captura de miniatura). */
export function getVideoElement(): HTMLVideoElement | null {
  return element
}
