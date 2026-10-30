// Gera build/icon.ico (multi-tamanho) e build/icon.png a partir de build/icon.svg.
// Sem dependencias externas: usa o Chromium do Electron para rasterizar o SVG
// em canvas e empacota os PNGs em um container ICO escrito a mao.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const BUILD_DIR = __dirname
const SVG = fs.readFileSync(path.join(BUILD_DIR, 'icon.svg'), 'utf-8')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

function packIco(images) {
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // tipo 1 = icone
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const bodies = []

  images.forEach((img, i) => {
    const base = i * 16
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, base + 0) // largura (0 = 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, base + 1) // altura
    dir.writeUInt8(0, base + 2) // paleta
    dir.writeUInt8(0, base + 3) // reservado
    dir.writeUInt16LE(1, base + 4) // planos
    dir.writeUInt16LE(32, base + 6) // bits por pixel
    dir.writeUInt32LE(img.data.length, base + 8)
    dir.writeUInt32LE(offset, base + 12)
    offset += img.data.length
    bodies.push(img.data)
  })

  return Buffer.concat([header, dir, ...bodies])
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64')

  const images = []
  for (const size of SIZES) {
    const base64 = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image()
      img.src = ${JSON.stringify(dataUrl)}
      await img.decode()
      const c = document.createElement('canvas')
      c.width = ${size}; c.height = ${size}
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, ${size}, ${size})
      ctx.drawImage(img, 0, 0, ${size}, ${size})
      return c.toDataURL('image/png').split(',')[1]
    })()`)
    images.push({ size, data: Buffer.from(base64, 'base64') })
  }

  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), packIco(images))
  const png256 = images.find((i) => i.size === 256)
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png256.data)

  console.log('OK icon.ico (' + SIZES.join(',') + ') + icon.png gerados')
  app.exit(0)
}).catch((e) => {
  console.error('FALHA', e)
  app.exit(1)
})
