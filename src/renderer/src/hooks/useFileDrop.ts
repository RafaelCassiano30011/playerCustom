import { useEffect, useState } from 'react'

/**
 * Drag and drop de arquivos na janela inteira.
 * O caminho real vem de `webUtils.getPathForFile` (exposto no preload),
 * ja que `File.path` nao existe mais no Electron 32+.
 */
export function useFileDrop(onDrop: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0

    const onDragEnter = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      depth += 1
      setDragging(true)
    }

    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    const onDragLeave = (event: DragEvent): void => {
      event.preventDefault()
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }

    const onDropEvent = (event: DragEvent): void => {
      event.preventDefault()
      depth = 0
      setDragging(false)

      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return

      const paths = files
        .map((file) => {
          try {
            return window.dnd.pathForFile(file)
          } catch {
            return ''
          }
        })
        .filter(Boolean)

      if (paths.length > 0) onDrop(paths)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDropEvent)

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDropEvent)
    }
  }, [onDrop])

  return dragging
}
