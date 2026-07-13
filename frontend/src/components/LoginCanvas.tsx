import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { createLoginArtworks } from '../lib/loginArtworks'
import { drawLoginGenerationScene } from '../lib/loginCanvas'

type MotionState = {
  x: number
  y: number
  targetX: number
  targetY: number
  pressure: number
  targetPressure: number
  pulseStartedAt: number | null
}

export default function LoginCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motionRef = useRef<MotionState>({
    x: 0.22,
    y: 0.48,
    targetX: 0.22,
    targetY: 0.48,
    pressure: 0,
    targetPressure: 0,
    pulseStartedAt: null,
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const artworks = createLoginArtworks()

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const colorMedia = window.matchMedia('(prefers-color-scheme: dark)')
    let reducedMotion = media.matches
    let darkMode = colorMedia.matches
    let width = 0
    let height = 0
    let frame = 0
    let previousTime = performance.now()

    const draw = (time: number) => {
      if (!width || !height) {
        if (!reducedMotion) frame = requestAnimationFrame(draw)
        return
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const motion = motionRef.current
      const elapsedScale = Math.min((time - previousTime) / 16.67, 3)
      previousTime = time
      const pointerResponse = 1 - Math.pow(0.9, elapsedScale)
      const pressureResponse = 1 - Math.pow(0.76, elapsedScale)
      motion.x += (motion.targetX - motion.x) * pointerResponse
      motion.y += (motion.targetY - motion.y) * pointerResponse
      motion.pressure += (motion.targetPressure - motion.pressure) * pressureResponse

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawLoginGenerationScene(ctx, {
        width,
        height,
        time: reducedMotion ? 0 : time,
        pointerX: reducedMotion ? 0.34 : motion.x,
        pointerY: reducedMotion ? 0.48 : motion.y,
        pressure: reducedMotion ? 0 : motion.pressure,
        pulseAge: motion.pulseStartedAt === null ? -1 : time - motion.pulseStartedAt,
        darkMode,
      }, artworks)
      if (motion.pulseStartedAt !== null && time - motion.pulseStartedAt > 1400) {
        motion.pulseStartedAt = null
      }

      if (!reducedMotion) frame = requestAnimationFrame(draw)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === width && rect.height === height) return
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      if (reducedMotion) draw(performance.now())
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    if (!reducedMotion) frame = requestAnimationFrame(draw)

    const handleMotionChange = () => {
      reducedMotion = media.matches
      cancelAnimationFrame(frame)
      frame = 0
      previousTime = performance.now()
      if (reducedMotion) draw(previousTime)
      else frame = requestAnimationFrame(draw)
    }
    media.addEventListener('change', handleMotionChange)
    const handleColorChange = () => {
      darkMode = colorMedia.matches
      if (reducedMotion) draw(performance.now())
    }
    colorMedia.addEventListener('change', handleColorChange)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      media.removeEventListener('change', handleMotionChange)
      colorMedia.removeEventListener('change', handleColorChange)
    }
  }, [])

  const updatePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    motionRef.current.targetX = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    motionRef.current.targetY = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    updatePointer(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    motionRef.current.targetPressure = 1
    motionRef.current.pulseStartedAt = null
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    motionRef.current.targetPressure = 0
    motionRef.current.pulseStartedAt = performance.now()
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full cursor-crosshair touch-pan-y"
      onPointerMove={updatePointer}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => {
        if (motionRef.current.targetPressure) return
        motionRef.current.targetX = 0.22
        motionRef.current.targetY = 0.48
      }}
      aria-hidden="true"
    />
  )
}
