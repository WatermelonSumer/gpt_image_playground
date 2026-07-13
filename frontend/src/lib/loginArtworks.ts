export type ArtworkTile = {
  x: number
  y: number
  color: string
}

export type LoginArtwork = {
  canvas: HTMLCanvasElement
  tiles: readonly ArtworkTile[]
}

const SIZE = 480
const TILE_COUNT = 12

function drawArtwork(ctx: CanvasRenderingContext2D, index: number) {
  if (index === 0) {
    const sky = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    sky.addColorStop(0, '#dbeafe')
    sky.addColorStop(1, '#f8fafc')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.fillStyle = '#1e3a8a'
    ctx.beginPath()
    ctx.moveTo(54, 420)
    ctx.lineTo(178, 92)
    ctx.lineTo(292, 420)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(37, 99, 235, 0.72)'
    ctx.beginPath()
    ctx.moveTo(210, 420)
    ctx.lineTo(336, 38)
    ctx.lineTo(436, 420)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#fb7185'
    ctx.fillRect(88, 252, 154, 168)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.86)'
    ctx.lineWidth = 8
    ctx.strokeRect(128, 286, 224, 118)
    return
  }

  if (index === 1) {
    const backdrop = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    backdrop.addColorStop(0, '#111827')
    backdrop.addColorStop(1, '#1d4ed8')
    ctx.fillStyle = backdrop
    ctx.fillRect(0, 0, SIZE, SIZE)
    const colors = ['#93c5fd', '#f8fafc', '#4ade80', '#60a5fa']
    colors.forEach((color, idx) => {
      ctx.save()
      ctx.translate(238, 244)
      ctx.rotate(idx * 1.48 + 0.2)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, -18)
      ctx.bezierCurveTo(82, -126, 178, -64, 104, 24)
      ctx.bezierCurveTo(58, 80, 22, 52, 0, -18)
      ctx.fill()
      ctx.restore()
    })
    ctx.fillStyle = '#fbbf24'
    ctx.fillRect(216, 222, 44, 44)
    return
  }

  if (index === 2) {
    const backdrop = ctx.createLinearGradient(0, 0, SIZE, SIZE)
    backdrop.addColorStop(0, '#ffe4e6')
    backdrop.addColorStop(1, '#bfdbfe')
    ctx.fillStyle = backdrop
    ctx.fillRect(0, 0, SIZE, SIZE)
    const bands = [
      { color: '#2563eb', y: 118, height: 96 },
      { color: '#fb7185', y: 214, height: 112 },
      { color: '#f8fafc', y: 322, height: 86 },
    ]
    bands.forEach((band, idx) => {
      ctx.fillStyle = band.color
      ctx.beginPath()
      ctx.moveTo(0, band.y)
      ctx.bezierCurveTo(110, band.y - 58, 264, band.y + 68, SIZE, band.y - 26 + idx * 12)
      ctx.lineTo(SIZE, band.y + band.height)
      ctx.bezierCurveTo(330, band.y + band.height + 44, 142, band.y + band.height - 42, 0, band.y + band.height + 18)
      ctx.closePath()
      ctx.fill()
    })
    return
  }

  const backdrop = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  backdrop.addColorStop(0, '#f4f4f5')
  backdrop.addColorStop(1, '#dbeafe')
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.save()
  ctx.translate(240, 244)
  ctx.rotate(-0.28)
  const glass = ctx.createLinearGradient(-120, -140, 120, 140)
  glass.addColorStop(0, 'rgba(255, 255, 255, 0.92)')
  glass.addColorStop(0.45, 'rgba(96, 165, 250, 0.62)')
  glass.addColorStop(1, 'rgba(37, 99, 235, 0.22)')
  ctx.fillStyle = glass
  ctx.fillRect(-112, -142, 224, 284)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 7
  ctx.strokeRect(-112, -142, 224, 284)
  ctx.fillStyle = '#1d4ed8'
  ctx.fillRect(-62, -78, 124, 156)
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(-30, -34, 60, 68)
  ctx.restore()
}

export function createLoginArtworks() {
  return Array.from({ length: 4 }, (_, index): LoginArtwork => {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建登录页图片画布')
    drawArtwork(ctx, index)

    const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data
    const tiles = Array.from({ length: TILE_COUNT * TILE_COUNT }, (_, tileIndex): ArtworkTile => {
      const x = tileIndex % TILE_COUNT
      const y = Math.floor(tileIndex / TILE_COUNT)
      const sampleX = Math.min(SIZE - 1, Math.floor((x + 0.5) * SIZE / TILE_COUNT))
      const sampleY = Math.min(SIZE - 1, Math.floor((y + 0.5) * SIZE / TILE_COUNT))
      const offset = (sampleY * SIZE + sampleX) * 4
      return {
        x,
        y,
        color: `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`,
      }
    })
    return { canvas, tiles }
  })
}
