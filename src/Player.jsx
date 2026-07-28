import { useEffect, useRef, useState } from 'react'

const HOLD = 1100   // ms d'affichage plein d'un millesime
const FADE = 700    // ms de fondu vers le suivant

// Lecture en fondu enchaine sur canvas. Le canvas sert aussi de source a
// l'enregistrement video : pas de ffmpeg, pas de serveur.
export default function Player({ epochs, onRecordingChange }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const indexRef = useRef(0)
  const [playing, setPlaying] = useState(true)
  const [index, setIndex] = useState(0)

  const total = epochs.length
  const cycle = HOLD + FADE

  // Un nouveau lieu peut avoir moins de millesimes que le precedent : sans remise a
  // zero, la boucle d'animation lit un index qui n'existe plus.
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
    canvas.width = epochs[0].bitmap.width
    canvas.height = epochs[0].bitmap.height

    const draw = (i, next, alpha) => {
      const current = epochs[i]
      if (!current) return
      ctx.globalAlpha = 1
      ctx.drawImage(current.bitmap, 0, 0, canvas.width, canvas.height)
      if (alpha > 0 && epochs[next]) {
        ctx.globalAlpha = alpha
        ctx.drawImage(epochs[next].bitmap, 0, 0, canvas.width, canvas.height)
        ctx.globalAlpha = 1
      }
    }

    if (!playing) {
      draw(Math.min(indexRef.current, total - 1), 0, 0)
      return
    }

    // L'index vit dans une ref, pas dans l'etat : le mettre dans les dependances
    // ferait redemarrer l'effet a chaque image.
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
  }, [epochs, playing, total, cycle])

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
        <canvas ref={canvasRef} className="block w-full" />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/65 px-3 py-1.5 text-2xl font-semibold tabular-nums backdrop-blur-sm sm:text-3xl">
          {epochs[index]?.label}
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
