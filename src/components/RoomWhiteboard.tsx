import { useCallback, useEffect, useRef, useState } from 'react'
import { PencilSimple, Highlighter, Eraser, TextT, ArrowCounterClockwise, Trash, PaperPlaneTilt } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The room's whiteboard: the owner sketches levels, flows or ideas, then puts
 * the sketch on the table. Agents see the latest shared sketch as an image in
 * every turn after that, so a drawn support zone can steer the discussion as
 * well as a typed question.
 *
 * Two layers: a static grid underneath and the ink on top, so the eraser
 * removes ink without punching holes in the grid. Sharing flattens both.
 */

const W = 1280
const H = 720
const BG = '#0B1224'
const GRID = 'rgba(63, 216, 234, 0.07)'
const COLORS = ['#EEF2F8', '#3FD8EA', '#A88BFA', '#F3C25B', '#FB7185'] as const
const SIZES = { S: 3, M: 6, L: 12 } as const
const MAX_UNDO = 20
// Stay under the server's cap with room to spare.
const MAX_SHARE_BYTES = 420_000

type Tool = 'pen' | 'highlighter' | 'eraser' | 'text'

interface RoomWhiteboardProps {
  disabled?: boolean
  sharing?: boolean
  onShare: (dataUrl: string, note: string) => void
}

export function RoomWhiteboard({ disabled, sharing, onShare }: RoomWhiteboardProps) {
  const gridRef = useRef<HTMLCanvasElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(COLORS[1])
  const [size, setSize] = useState<keyof typeof SIZES>('M')
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [textAt, setTextAt] = useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const [textValue, setTextValue] = useState('')
  const undo = useRef<ImageData[]>([])
  const drawing = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const g = gridRef.current?.getContext('2d')
    if (!g) return
    g.fillStyle = BG
    g.fillRect(0, 0, W, H)
    g.strokeStyle = GRID
    g.lineWidth = 1
    for (let x = 0; x <= W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke() }
    for (let y = 0; y <= H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  }, [])

  const ink = () => inkRef.current?.getContext('2d') ?? null

  const snapshot = () => {
    const c = ink()
    if (!c) return
    undo.current.push(c.getImageData(0, 0, W, H))
    if (undo.current.length > MAX_UNDO) undo.current.shift()
  }

  // Pointer position in canvas pixels, whatever size the canvas is shown at.
  const toCanvas = (e: React.PointerEvent) => {
    const r = inkRef.current!.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
      left: e.clientX - r.left,
      top: e.clientY - r.top,
    }
  }

  const style = (c: CanvasRenderingContext2D, pressure: number) => {
    const base = SIZES[size] * (tool === 'highlighter' ? 3 : tool === 'eraser' ? 3 : 1)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.lineWidth = base * (tool === 'pen' ? 0.6 + pressure * 0.8 : 1)
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    c.globalAlpha = tool === 'highlighter' ? 0.35 : 1
    c.strokeStyle = color
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const p = toCanvas(e)
    if (tool === 'text') {
      setTextAt(p)
      setTextValue('')
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    snapshot()
    drawing.current = { x: p.x, y: p.y }
    const c = ink()
    if (!c) return
    style(c, e.pressure || 0.5)
    c.beginPath()
    c.moveTo(p.x, p.y)
    c.lineTo(p.x + 0.01, p.y + 0.01)
    c.stroke()
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const c = ink()
    if (!c) return
    const p = toCanvas(e)
    style(c, e.pressure || 0.5)
    c.beginPath()
    c.moveTo(drawing.current.x, drawing.current.y)
    c.lineTo(p.x, p.y)
    c.stroke()
    drawing.current = { x: p.x, y: p.y }
    setDirty(true)
  }

  const onUp = () => { drawing.current = null }

  const placeText = useCallback(() => {
    const c = ink()
    const value = textValue.trim()
    if (c && textAt && value) {
      snapshot()
      c.globalCompositeOperation = 'source-over'
      c.globalAlpha = 1
      c.fillStyle = color
      c.font = `600 ${SIZES[size] * 5 + 14}px "DM Sans", Arial, sans-serif`
      c.textBaseline = 'top'
      c.fillText(value.slice(0, 80), textAt.x, textAt.y)
      setDirty(true)
    }
    setTextAt(null)
    setTextValue('')
  }, [textAt, textValue, color, size])

  const doUndo = () => {
    const c = ink()
    const prev = undo.current.pop()
    if (c && prev) c.putImageData(prev, 0, 0)
    setDirty(undo.current.length > 0)
  }

  const clear = () => {
    const c = ink()
    if (!c) return
    snapshot()
    c.clearRect(0, 0, W, H)
    setDirty(false)
  }

  const share = () => {
    if (!gridRef.current || !inkRef.current) return
    const out = document.createElement('canvas')
    // Flatten grid + ink, at full size first, smaller if it would be too heavy.
    for (const [w, h, q] of [[W, H, 0.85], [W, H, 0.7], [960, 540, 0.7], [800, 450, 0.6]] as const) {
      out.width = w
      out.height = h
      const c = out.getContext('2d')
      if (!c) return
      c.drawImage(gridRef.current, 0, 0, w, h)
      c.drawImage(inkRef.current, 0, 0, w, h)
      const url = out.toDataURL('image/jpeg', q)
      if (url.length * 0.75 <= MAX_SHARE_BYTES) {
        onShare(url, note.trim())
        setNote('')
        return
      }
    }
  }

  const tools: Array<{ id: Tool; label: string; icon: typeof PencilSimple }> = [
    { id: 'pen', label: 'Pen', icon: PencilSimple },
    { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
    { id: 'eraser', label: 'Eraser', icon: Eraser },
    { id: 'text', label: 'Text', icon: TextT },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border/50 p-0.5">
          {tools.map(t => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={cn('h-8 w-8 rounded-md flex items-center justify-center transition-colors',
                tool === t.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              <t.icon size={16} weight={tool === t.id ? 'fill' : 'regular'} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Ink colour">
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={cn('h-6 w-6 rounded-full border-2 transition-transform', color === c ? 'border-foreground scale-110' : 'border-transparent')}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex rounded-lg border border-border/50 p-0.5 text-[11px] font-mono">
          {(Object.keys(SIZES) as Array<keyof typeof SIZES>).map(k => (
            <button
              key={k}
              type="button"
              aria-pressed={size === k}
              onClick={() => setSize(k)}
              className={cn('h-7 w-7 rounded-md', size === k ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          <Button type="button" size="sm" variant="ghost" onClick={doUndo} aria-label="Undo"><ArrowCounterClockwise size={15} /></Button>
          <Button type="button" size="sm" variant="ghost" onClick={clear} aria-label="Clear"><Trash size={15} /></Button>
        </div>
      </div>

      <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-border/50">
        <canvas ref={gridRef} width={W} height={H} className="absolute inset-0 w-full h-full" aria-hidden />
        <canvas
          ref={inkRef}
          width={W}
          height={H}
          aria-label="Whiteboard: draw or write for your agents"
          className={cn('absolute inset-0 w-full h-full touch-none', tool === 'text' ? 'cursor-text' : 'cursor-crosshair', disabled && 'opacity-60')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        {textAt && (
          <input
            autoFocus
            value={textValue}
            onChange={e => setTextValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') placeText(); if (e.key === 'Escape') setTextAt(null) }}
            onBlur={placeText}
            placeholder="Type, then Enter"
            className="absolute bg-background/80 border border-primary/50 rounded px-1.5 py-0.5 text-sm outline-none"
            style={{ left: textAt.left, top: textAt.top, color }}
          />
        )}
      </div>

      <div className="flex gap-2">
        <Input
          value={note}
          onChange={e => setNote(e.target.value.slice(0, 300))}
          placeholder="Optional note for the agents, e.g. “these are my support zones”"
          className="text-sm"
          disabled={disabled}
        />
        <Button type="button" onClick={share} disabled={disabled || sharing || !dirty} className="shrink-0">
          <PaperPlaneTilt size={15} className="mr-1.5" />
          {sharing ? 'Sharing…' : 'Share with the table'}
        </Button>
      </div>
    </div>
  )
}
