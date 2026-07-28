import { app, BrowserWindow } from 'electron'
import { statSync } from 'node:fs'
import { registerMediaProtocol, registerMediaScheme } from './protocol'
import { closeStorage, initStorage } from './storage/database'
import { registerIpcHandlers } from './ipc/register'
import { isVideoFile } from './services/file.service'
import { createWindow, getMainWindow } from './window'
import { IPC } from '@shared/ipc'

/**
 * Filtra a linha de comando para arquivos de video reais.
 *
 * Sem isso, `electron .` (usado em dev) manda "." como se fosse midia
 * arrastada, e o renderer importa o projeto inteiro — incluindo node_modules.
 * So aceitamos caminhos que sejam arquivo e tenham extensao de video.
 */
function mediaFilesFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((arg) => {
    if (arg.startsWith('-') || !isVideoFile(arg)) return false
    try {
      return statSync(arg).isFile()
    } catch {
      return false
    }
  })
}

// Uma instancia so: a segunda foca a janela existente e repassa os arquivos.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  registerMediaScheme()

  app.on('second-instance', (_event, argv) => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
    const files = mediaFilesFromArgv(argv)
    if (files.length > 0) window.webContents.send(IPC.eventFilesDropped, files)
  })

  app.whenReady().then(() => {
    initStorage()
    registerMediaProtocol()
    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Garante que o ultimo estado pendente va para o disco antes de sair.
  app.on('before-quit', () => closeStorage())
}
