import type { LoginArtwork } from './loginArtworks'

export type LoginGenerationFrame = {
  width: number
  height: number
  time: number
  pointerX: number
  pointerY: number
  pressure: number
  pulseAge: number
  darkMode: boolean
}

type ArtworkLayout = {
  x: number
  y: number
  size: number
  angle: number
  depth: number
  artwork: number
}

const DESKTOP_LAYOUTS: readonly ArtworkLayout[] = [
  { x: 0.22, y: 0.43, size: 0.22, angle: -0.05, depth: 0.45, artwork: 0 },
  { x: 0.09, y: 0.2, size: 0.13, angle: -0.14, depth: 0.18, artwork: 1 },
  { x: 0.84, y: 0.74, size: 0.16, angle: 0.09, depth: 0.3, artwork: 2 },
  { x: 0.82, y: 0.29, size: 0.17, angle: 0.12, depth: 0.72, artwork: 3 },
] as const

const MOBILE_LAYOUTS: readonly ArtworkLayout[] = [
  { x: 0.18, y: 0.15, size: 0.22, angle: -0.14, depth: 0.18, artwork: 1 },
  { x: 0.82, y: 0.14, size: 0.2, angle: 0.12, depth: 0.72, artwork: 3 },
  { x: 0.5, y: 0.89, size: 0.28, angle: 0.06, depth: 0.3, artwork: 2 },
] as const

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function drawLatentFlow(ctx: CanvasRenderingContext2D, frame: LoginGenerationFrame, coreX: number, coreY: number) {
  const streamColor = frame.darkMode ? 'rgba(96, 165, 250, 0.42)' : 'rgba(37, 99, 235, 0.32)'
  const fromRight = coreX > frame.width / 2
  for (let idx = 0; idx < 26; idx += 1) {
    const progress = (frame.time * 0.00011 + idx / 26) % 1
    const startX = frame.width * (fromRight ? 1.04 : -0.04)
    const startY = frame.height * (0.22 + (idx % 7) * 0.075)
    const controlX = frame.width * (fromRight ? 0.82 : 0.18)
    const controlY = coreY + Math.sin(idx * 1.7) * frame.height * 0.16
    const inverse = 1 - progress
    const x = inverse * inverse * startX + 2 * inverse * progress * controlX + progress * progress * coreX
    const y = inverse * inverse * startY + 2 * inverse * progress * controlY + progress * progress * coreY
    const size = 2 + (idx % 3) * 1.5 + frame.pressure * 2
    ctx.fillStyle = idx % 5 === 0 ? (frame.darkMode ? '#93c5fd' : '#2563eb') : streamColor
    ctx.fillRect(x - size / 2, y - size / 2, size, size)
  }
}

function drawArtwork(
  ctx: CanvasRenderingContext2D,
  frame: LoginGenerationFrame,
  artwork: LoginArtwork,
  layout: ArtworkLayout,
  index: number,
  coreX: number,
  coreY: number,
) {
  const parallax = (layout.depth - 0.5) * 0.08
  const baseX = layout.x * frame.width
  const baseY = layout.y * frame.height
  const x = baseX + (frame.pointerX - 0.5) * frame.width * parallax
  const y = baseY + (frame.pointerY - 0.5) * frame.height * parallax
  const size = Math.min(frame.width, frame.height) * layout.size * (frame.width < 640 ? 1.5 : 1)
  const pulseDelay = index * 75
  const localPulseAge = frame.pulseAge - pulseDelay
  const pulseProgress = localPulseAge >= 0 ? clamp(localPulseAge / 820) : -1
  const automaticFront = (frame.time * 0.000055 + index * 0.23) % 1.4 - 0.2
  const resolveFront = pulseProgress >= 0 ? pulseProgress : automaticFront
  const pressure = frame.pressure

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(layout.angle + (frame.pointerX - 0.5) * 0.04 * layout.depth)
  const scale = 1 - pressure * 0.07
  ctx.scale(scale, scale)

  ctx.fillStyle = frame.darkMode ? 'rgba(0, 0, 0, 0.24)' : 'rgba(15, 23, 42, 0.08)'
  ctx.fillRect(-size / 2 + 9, -size / 2 + 12, size, size)
  ctx.fillStyle = frame.darkMode ? '#18181b' : '#ffffff'
  ctx.fillRect(-size / 2 - 5, -size / 2 - 5, size + 10, size + 10)

  ctx.save()
  ctx.beginPath()
  ctx.rect(-size / 2, -size / 2, size, size)
  ctx.clip()
  ctx.globalAlpha = 1 - pressure * 0.42
  ctx.drawImage(artwork.canvas, -size / 2, -size / 2, size, size)
  ctx.globalAlpha = 1

  const tileSize = size / 12
  artwork.tiles.forEach((tile, tileIndex) => {
    const normalizedX = (tile.x + 0.5) / 12
    const unresolved = clamp((normalizedX - resolveFront) * 4)
    const amount = Math.max(pressure * 0.95, unresolved * 0.34)
    if (amount < 0.025) return
    const jitter = pressure * 7
    const offsetX = Math.sin(tileIndex * 12.71) * jitter
    const offsetY = Math.cos(tileIndex * 8.37) * jitter
    ctx.globalAlpha = amount
    ctx.fillStyle = tile.color
    ctx.fillRect(
      -size / 2 + tile.x * tileSize + offsetX,
      -size / 2 + tile.y * tileSize + offsetY,
      tileSize + 0.6,
      tileSize + 0.6,
    )
  })
  ctx.globalAlpha = 1

  if (resolveFront >= 0 && resolveFront <= 1) {
    const sweepX = -size / 2 + resolveFront * size
    const sweep = ctx.createLinearGradient(sweepX - 18, 0, sweepX + 18, 0)
    sweep.addColorStop(0, 'rgba(255, 255, 255, 0)')
    sweep.addColorStop(0.5, frame.darkMode ? 'rgba(147, 197, 253, 0.35)' : 'rgba(255, 255, 255, 0.72)')
    sweep.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = sweep
    ctx.fillRect(sweepX - 18, -size / 2, 36, size)
  }
  ctx.restore()

  ctx.strokeStyle = frame.darkMode ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.92)'
  ctx.lineWidth = 1.2
  ctx.strokeRect(-size / 2 - 5, -size / 2 - 5, size + 10, size + 10)
  ctx.strokeStyle = frame.darkMode ? 'rgba(96, 165, 250, 0.48)' : 'rgba(37, 99, 235, 0.34)'
  ctx.strokeRect(-size / 2, -size / 2, size, size)
  ctx.restore()

  ctx.beginPath()
  ctx.moveTo(coreX, coreY)
  ctx.lineTo(x, y)
  ctx.strokeStyle = frame.darkMode ? 'rgba(96, 165, 250, 0.14)' : 'rgba(37, 99, 235, 0.1)'
  ctx.lineWidth = 1
  ctx.stroke()
}

export function drawLoginGenerationScene(
  ctx: CanvasRenderingContext2D,
  frame: LoginGenerationFrame,
  artworks: readonly LoginArtwork[],
) {
  const background = ctx.createLinearGradient(0, 0, frame.width, frame.height)
  background.addColorStop(0, frame.darkMode ? '#09090b' : '#fafafa')
  background.addColorStop(0.5, frame.darkMode ? '#111827' : '#f5f7fa')
  background.addColorStop(1, frame.darkMode ? '#0a0a0d' : '#edf2f8')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, frame.width, frame.height)

  const narrow = frame.width < 900
  const pointerCoreX = frame.pointerX * frame.width
  const pointerCoreY = frame.pointerY * frame.height
  const coreX = narrow
    ? pointerCoreX
    : pointerCoreX < frame.width / 2
      ? Math.min(pointerCoreX, frame.width / 2 - 260)
      : Math.max(pointerCoreX, frame.width / 2 + 260)
  const coreY = narrow
    ? pointerCoreY < frame.height / 2
      ? Math.min(pointerCoreY, frame.height * 0.17)
      : Math.max(pointerCoreY, frame.height * 0.83)
    : pointerCoreY
  drawLatentFlow(ctx, frame, coreX, coreY)

  const layouts = narrow ? MOBILE_LAYOUTS : DESKTOP_LAYOUTS
  layouts.forEach((layout, index) => {
    drawArtwork(ctx, frame, artworks[layout.artwork], layout, index, coreX, coreY)
  })

  ctx.save()
  ctx.translate(coreX, coreY)
  ctx.rotate(frame.time * 0.00008)
  const coreSize = 24 + frame.pressure * 9
  const cell = coreSize / 2
  ctx.fillStyle = frame.darkMode ? '#60a5fa' : '#2563eb'
  ctx.fillRect(-coreSize / 2, -coreSize / 2, cell - 1, cell - 1)
  ctx.fillStyle = frame.darkMode ? '#e4e4e7' : '#a1a1aa'
  ctx.fillRect(1, -coreSize / 2, cell - 1, cell - 1)
  ctx.fillStyle = frame.darkMode ? '#93c5fd' : '#bfdbfe'
  ctx.fillRect(-coreSize / 2, 1, cell - 1, cell - 1)
  ctx.fillStyle = frame.darkMode ? '#f8fafc' : '#ffffff'
  ctx.fillRect(1, 1, cell - 1, cell - 1)
  ctx.restore()
}
