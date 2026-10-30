/** Utilitarios de tempo usados na UI e na persistencia. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 3671 -> "01:01:11"; 71 -> "01:11". */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Sempre com horas: 71 -> "00:01:11". Usado nos inputs de configuracao. */
export function formatTimeLong(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Aceita "90", "01:30", "00:01:30". Retorna null se invalido. */
export function parseTime(input: string): number | null {
  const raw = input.trim()
  if (!raw) return null
  const parts = raw.split(':').map((p) => p.trim())
  if (parts.some((p) => p === '' || !/^\d+([.,]\d+)?$/.test(p))) return null
  const nums = parts.map((p) => Number(p.replace(',', '.')))
  let seconds = 0
  for (const n of nums) seconds = seconds * 60 + n
  return Number.isFinite(seconds) ? seconds : null
}

/** 0..1 */
export function progressRatio(position: number, duration: number): number {
  if (!duration || duration <= 0) return 0
  return clamp(position / duration, 0, 1)
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

/** Considera concluido a partir de 97% assistido. */
export const COMPLETION_THRESHOLD = 0.97

export function isCompleted(position: number, duration: number): boolean {
  if (!duration) return false
  return position / duration >= COMPLETION_THRESHOLD
}
