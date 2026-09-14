import { useEffect, useRef } from 'react'

interface DataStream {
  x: number
  y: number
  speed: number
  length: number
  opacity: number
  color: string
  angle: number
}

interface Pulse {
  x: number
  y: number
  radius: number
  maxRadius: number
  speed: number
  opacity: number
  color: string
}

const STREAM_COUNT = 8

// Trails fade this much per frame. Too low and old strokes pile up into a
// visible web across the page, which competes with the data on top of it.
const TRAIL_FADE = 0.14

export function DataFlowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const dataStreams: DataStream[] = []
    const pulses: Pulse[] = []
    const colors = ['rgba(0, 243, 255,', 'rgba(157, 0, 255,', 'rgba(100, 150, 255,']

    for (let i = 0; i < STREAM_COUNT; i++) {
      dataStreams.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        speed: Math.random() * 1.2 + 0.4,
        length: Math.random() * 70 + 40,
        opacity: Math.random() * 0.13 + 0.06,
        color: colors[Math.floor(Math.random() * colors.length)],
        angle: Math.random() * Math.PI * 2
      })
    }

    const createPulse = () => {
      if (Math.random() > 0.996) {
        pulses.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 0,
          maxRadius: Math.random() * 90 + 70,
          speed: Math.random() * 2 + 1,
          opacity: 0.18,
          color: colors[Math.floor(Math.random() * colors.length)]
        })
      }
    }

    let animationFrameId: number

    const animate = () => {
      ctx.fillStyle = `rgba(18, 18, 35, ${TRAIL_FADE})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      dataStreams.forEach(stream => {
        stream.x += Math.cos(stream.angle) * stream.speed
        stream.y += Math.sin(stream.angle) * stream.speed

        if (stream.x < -stream.length) stream.x = canvas.width + stream.length
        if (stream.x > canvas.width + stream.length) stream.x = -stream.length
        if (stream.y < -stream.length) stream.y = canvas.height + stream.length
        if (stream.y > canvas.height + stream.length) stream.y = -stream.length

        const tailX = stream.x - Math.cos(stream.angle) * stream.length
        const tailY = stream.y - Math.sin(stream.angle) * stream.length

        const gradient = ctx.createLinearGradient(tailX, tailY, stream.x, stream.y)
        gradient.addColorStop(0, stream.color + ' 0)')
        gradient.addColorStop(0.5, stream.color + ' ' + stream.opacity * 0.6 + ')')
        gradient.addColorStop(1, stream.color + ' ' + stream.opacity + ')')

        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.5
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(stream.x, stream.y)
        ctx.stroke()

        ctx.fillStyle = stream.color + ' ' + stream.opacity + ')'
        ctx.beginPath()
        ctx.arc(stream.x, stream.y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      })

      createPulse()

      pulses.forEach((pulse, index) => {
        pulse.radius += pulse.speed
        pulse.opacity -= 0.004

        if (pulse.opacity <= 0 || pulse.radius >= pulse.maxRadius) {
          pulses.splice(index, 1)
          return
        }

        ctx.strokeStyle = pulse.color + ' ' + pulse.opacity + ')'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2)
        ctx.stroke()
      })

      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}
