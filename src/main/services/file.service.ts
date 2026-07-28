import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { SUPPORTED_VIDEO_EXTENSIONS } from '@shared/types'
import type { MediaFileInfo } from '@shared/types'

const VIDEO_EXTENSIONS = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS)

/** Pastas que nunca contem midia do usuario mas podem ter milhares de arquivos. */
const SKIPPED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '$recycle.bin',
  'system volume information',
  '.cache',
  '.vscode',
  '.idea'
])

function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIR_NAMES.has(name.toLowerCase())
}

export function isVideoFile(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(path).slice(1).toLowerCase())
}

/** Ordena "Ep 2" antes de "Ep 10" (numerico natural). */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory() && isSkippedDir(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, depth - 1, out)
    else if (isVideoFile(full)) out.push(full)
  }
}

export const fileService = {
  /**
   * Expande caminhos: pastas viram lista recursiva de videos,
   * arquivos nao suportados sao descartados. Resultado ordenado naturalmente.
   */
  async resolve(paths: string[], maxDepth = 4): Promise<MediaFileInfo[]> {
    const files: string[] = []

    for (const path of paths) {
      try {
        const stat = await fs.stat(path)
        if (stat.isDirectory()) await walk(path, maxDepth, files)
        else if (isVideoFile(path)) files.push(path)
      } catch (error) {
        console.error('[files] caminho ignorado', path, error)
      }
    }

    const unique = [...new Set(files)].sort(naturalCompare)
    const infos: MediaFileInfo[] = []
    for (const file of unique) {
      try {
        const stat = await fs.stat(file)
        infos.push({ path: file, name: basename(file), size: stat.size })
      } catch {
        // arquivo sumiu entre a varredura e o stat: ignora
      }
    }
    return infos
  }
}
