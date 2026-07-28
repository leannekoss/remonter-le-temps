import { useEffect, useRef, useState } from 'react'
import { sourceRect, zoomAt, panBy } from './lib/view.js'

const HOLD = 1100   // ms d'affichage plein d'un millesime
const FADE = 700    // ms de fondu vers le suivant
const CANVAS_W = 1200
const CANVAS_H = 800

// Lecture en fondu enchaine sur canvas, avec zoom et deplacement libres.
// Le canvas sert aussi de source a l'enregistrement video : pas de ffmpeg,
// pas de serveur, et l'export reprend le cadrage choisi par l'utilisateur.
export default function Player({ epochs, buffer, view, onViewChange, onRecordingChange }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const indexRef = useRef(0)
  const viewRef = useRef(view)
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const [playing, setPlaying] = useState(true)
  const [index, setIndex] = useState(0)

  const total = epochs.length
  const cycle = HOLD + FADE

  // La boucle d'animation lit la vue dans une ref : la mettre dans les dependances
  // ferait redemarrer l'effet a chaque cran de molette.
  viewRef.current = view

  // Un nouveau lieu peut avoir moins de millesimes que le precedent : sans remise a
  // zero, la boucle lirait un index qui n'existe plus.
  useEffect(() => {
    indexRef.current = 0
    setIndex(0)
  }, [epochs])

  const goTo = (i) => {
    indexRef.current = i
    setIndex(i)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || total === 0) return
    const ctx = canvas.getContext('2d')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H

    const draw = (i, next, alpha) => {
      const current = epochs[i]
      if (!current) return
      const { sx, sy, sw, sh } = sourceRect(viewRef.current, buffer)
      ctx.globalAlpha = 1
      ctx.drawImage(current.bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H)
      if (alpha > 0 && epochs[next]) {
        ctx.globalAlpha = alpha
        ctx.drawImage(epochs[next].bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H)
        ctx.globalAlpha = 1
      }
    }

    if (!playing) {
      draw(Math.min(indexRef.current, total - 1), 0, 0)
      return
    }

    const start = performance.now() - indexRef.current * cycle
    const tick = (now) => {
      const elapsed = (now - start) % (total * cycle)
      const i = Math.floor(elapsed / cycle)
      const inCycle = elapsed - i * cycle
      const alpha = inCycle > HOLD ? (inCycle - HOLD) / FADE : 0
      draw(i, (i + 1) % total, alpha)
      if (i !== indexRef.current) {
        indexRef.current = i
        setIndex(i)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [epochs, buffer, playing, total, cycle])

  // En pause, un geste ne relance pas la boucle : il faut redessiner a la main.
  useEffect(() => {
    if (playing || total === 0) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const current = epochs[Math.min(indexRef.current, total - 1)]
    if (!ctx || !current) return
    const { sx, sy, sw, sh } = sourceRect(view, buffer)
    ctx.globalAlpha = 1
    ctx.drawImage(current.bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, CANVAS_H)
  }, [view, buffer, playing, epochs, total, index])

  // Molette : listener non passif, sinon preventDefault est ignore et la page defile.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const toCanvas = (e) => {
      const r = canvas.getBoundingClientRect()
      const k = CANVAS_W / r.width
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }
    }
    const onWheel = (e) => {
      e.preventDefault()
      const { x, y } = toCanvas(e)
      const factor = Math.exp(e.deltaY * 0.0012)
      onViewChange(zoomAt(viewRef.current, factor, CANVAS_W, CANVAS_H, x, y))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  const canvasScale = () => {
    const r = canvasRef.current.getBoundingClientRect()
    return CANVAS_W / r.width
  }

  const onPointerDown = (e) => {
    // Enregistrer le pointeur d'abord : la capture est un confort (suivre le geste
    // hors du canvas), et elle peut echouer. Si elle levait avant l'enregistrement,
    // le deplacement ne demarrerait jamais.
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinchRef.current = null
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointeur deja relache ou capture ailleurs : le glisse marche quand meme */
    }
  }

  const onPointerMove = (e) => {
    const pts = pointersRef.current
    if (!pts.has(e.pointerId)) return
    const prev = pts.get(e.pointerId)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pts.size >= 2) {
      const [a, b] = [...pts.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current) {
        const r = canvasRef.current.getBoundingClientRect()
        const k = CANVAS_W / r.width
        const mx = ((a.x + b.x) / 2 - r.left) * k
        const my = ((a.y + b.y) / 2 - r.top) * k
        onViewChange(zoomAt(viewRef.current, pinchRef.current / dist, CANVAS_W, CANVAS_H, mx, my))
      }
      pinchRef.current = dist
      return
    }

    const k = canvasScale()
    onViewChange(panBy(viewRef.current, (e.clientX - prev.x) * k, (e.clientY - prev.y) * k, CANVAS_W))
  }

  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  const download = async () => {
    const canvas = canvasRef.current
    if (!canvas?.captureStream) return
    onRecordingChange?.(true)
    const stream = canvas.captureStream(30)
    const chunks = []
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'remonter-le-temps.webm'
      a.click()
      URL.revokeObjectURL(url)
      onRecordingChange?.(false)
    }
    setPlaying(true)
    rec.start()
    setTimeout(() => rec.stop(), total * cycle + 200)
  }

  if (total === 0) return null

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-[var(--color-line)] bg-black">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="block w-full cursor-grab touch-none active:cursor-grabbing"
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/65 px-3 py-1.5 text-2xl font-semibold tabular-nums backdrop-blur-sm sm:text-3xl">
          {epochs[index]?.label}
        </div>
        <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-black/55 px-2 py-1 text-xs tabular-nums text-slate-300 backdrop-blur-sm">
          {Math.round(view.widthM)} m de large
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-2 text-sm hover:border-slate-500"
        >
          {playing ? 'Pause' : 'Lecture'}
        </button>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={index}
          onChange={(e) => { setPlaying(false); goTo(Number(e.target.value)) }}
          className="h-1 min-w-40 flex-1 accent-sky-400"
          aria-label="Choisir le millesime"
        />
        <button
          onClick={download}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-2 text-sm hover:border-slate-500"
        >
          Telecharger la video
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {epochs.map((e, i) => (
          <button
            key={e.label}
            onClick={() => { setPlaying(false); goTo(i) }}
            className={`rounded px-2 py-1 text-xs tabular-nums transition ${
              i === index
                ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                : 'bg-[var(--color-ink-soft)] text-slate-400 hover:text-slate-200'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  )
}
