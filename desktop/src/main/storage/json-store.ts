import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface JsonStoreOptions<T> {
  file: string
  defaults: T
  /** Milissegundos de debounce entre gravacoes. */
  debounceMs?: number
  /** Migra dados antigos para o formato atual. */
  migrate?: (raw: unknown) => T
}

/**
 * Armazenamento local em arquivo JSON.
 *
 * - Leitura unica na inicializacao, estado mantido em memoria (acesso O(1)).
 * - Gravacao debounced e atomica (arquivo temporario + rename).
 * - Backup `.bak` do ultimo estado valido: se o JSON corromper, recupera.
 */
export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  private dirty = false
  private readonly debounceMs: number

  constructor(private readonly options: JsonStoreOptions<T>) {
    this.debounceMs = options.debounceMs ?? 300
    this.data = this.load()
  }

  private load(): T {
    const { file, defaults, migrate } = this.options
    mkdirSync(dirname(file), { recursive: true })

    for (const candidate of [file, `${file}.bak`]) {
      if (!existsSync(candidate)) continue
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as unknown
        return migrate ? migrate(raw) : ({ ...defaults, ...(raw as T) } as T)
      } catch (error) {
        console.error(`[storage] arquivo invalido ignorado: ${candidate}`, error)
      }
    }
    return structuredClone(defaults)
  }

  get state(): T {
    return this.data
  }

  /** Aplica mutacao no estado e agenda persistencia. */
  update<R>(mutator: (state: T) => R): R {
    const result = mutator(this.data)
    this.scheduleWrite()
    return result
  }

  private scheduleWrite(): void {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.debounceMs)
  }

  /** Grava imediatamente se houver alteracao pendente. */
  flush(): void {
    if (!this.dirty) return
    const { file } = this.options
    const tmp = `${file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(this.data), 'utf-8')
      if (existsSync(file)) copyFileSync(file, `${file}.bak`)
      renameSync(tmp, file)
      this.dirty = false
    } catch (error) {
      console.error('[storage] falha ao gravar', error)
    }
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.flush()
  }
}
