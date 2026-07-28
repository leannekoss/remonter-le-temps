import { useEffect, useMemo, useRef, useState } from 'react'
import { sourceRect, zoomAt, panBy } from './lib/view.js'

const HOLD = 1100   // ms d'affichage plein d'un millesime
const FADE = 700    // ms de fondu vers le suivant
const CANVAS_W = 1200

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Safari sait enregistrer en MP4 depuis la 17, ce que tout le monde sait relire.
// Ailleurs on retombe sur WebM. On demande le type au navigateur plutot que de le
// supposer : un MediaRecorder cree avec un type non supporte leve.
function pickMime() {
  const candidats = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return candidats.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
}

export default function Player({ epochs, buffer, view, onViewChange, onRecordingChange }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const indexRef = useRef(0)
  const viewRef = useRef(view)
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const sobre = useMemo(reduceMotion, [])
  const [playing, setPlaying] = useState(!sobre)
  const [index, setIndex] = useState(0)
  const [video, setVideo] = useState(null)

  const total = epochs.length
  const fade = sobre ? 0 : FADE
  const cycle = HOLD + fade
  const canvasH = Math.round(CANVAS_W * buffer.aspect)

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
    const clamped = Math.max(0, Math.min(total - 1, i))
    indexRef.current = clamped
    setIndex(clamped)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || total === 0) return
    const ctx = canvas.getContext('2d')
    canvas.width = CANVAS_W
    canvas.height = canvasH

    const draw = (i, next, alpha) => {
      const current = epochs[i]
      if (!current) return
      const { sx, sy, sw, sh } = sourceRect(viewRef.current, buffer)
      ctx.globalAlpha = 1
      ctx.drawImage(current.bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, canvasH)
      if (alpha > 0 && epochs[next]) {
        ctx.globalAlpha = alpha
        ctx.drawImage(epochs[next].bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, canvasH)
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
      const alpha = fade > 0 && inCycle > HOLD ? (inCycle - HOLD) / fade : 0
      draw(i, (i + 1) % total, alpha)
      if (i !== indexRef.current) {
        indexRef.current = i
        setIndex(i)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [epochs, buffer, playing, total, cycle, fade, canvasH])

  // En pause, un geste ne relance pas la boucle : il faut redessiner a la main.
  useEffect(() => {
    if (playing || total === 0) return
    const ctx = canvasRef.current?.getContext('2d')
    const current = epochs[Math.min(indexRef.current, total - 1)]
    if (!ctx || !current) return
    const { sx, sy, sw, sh } = sourceRect(view, buffer)
    ctx.globalAlpha = 1
    ctx.drawImage(current.bitmap, sx, sy, sw, sh, 0, 0, CANVAS_W, canvasH)
  }, [view, buffer, playing, epochs, total, index, canvasH])

  // Molette : listener non passif, sinon preventDefault est ignore et la page defile.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const k = CANVAS_W / r.width
      onViewChange(zoomAt(viewRef.current, Math.exp(e.deltaY * 0.0012), CANVAS_W, canvasH,
        (e.clientX - r.left) * k, (e.clientY - r.top) * k))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onViewChange, canvasH])

  const onPointerDown = (e) => {
    // Enregistrer le pointeur d'abord : la capture est un confort et peut echouer.
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinchRef.current = null
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* le glisse marche quand meme */ }
  }

  const onPointerMove = (e) => {
    const pts = pointersRef.current
    if (!pts.has(e.pointerId)) return
    const prev = pts.get(e.pointerId)
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const r = canvasRef.current.getBoundingClientRect()
    const k = CANVAS_W / r.width

    if (pts.size >= 2) {
      const [a, b] = [...pts.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current) {
        onViewChange(zoomAt(viewRef.current, pinchRef.current / dist, CANVAS_W, canvasH,
          ((a.x + b.x) / 2 - r.left) * k, ((a.y + b.y) / 2 - r.top) * k))
      }
      pinchRef.current = dist
      return
    }
    onViewChange(panBy(viewRef.current, (e.clientX - prev.x) * k, (e.clientY - prev.y) * k, CANVAS_W))
  }

  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  const onKeyDown = (e) => {
    const pas = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (pas) { e.preventDefault(); setPlaying(false); goTo(indexRef.current + pas) }
    if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
  }

  // On enregistre un tour complet UNE fois, puis on laisse le choix : telecharger ou
  // partager. Declencher le partage direct ferait perdre le fichier a qui annule la
  // feuille native, et priverait le bureau du telechargement.
  const exporter = () => {
    const canvas = canvasRef.current
    if (!canvas?.captureStream) return
    const type = pickMime()
    if (!type) return
    if (video) URL.revokeObjectURL(video.url)
    setVideo(null)
    onRecordingChange?.(true)
    const chunks = []
    const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type })
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm'
      const blob = new Blob(chunks, { type })
      const nom = `remonter-le-temps.${ext}`
      setVideo({
        url: URL.createObjectURL(blob),
        nom,
        ext,
        poids: Math.round(blob.size / 1048576 * 10) / 10,
        file: new File([blob], nom, { type }),
      })
      onRecordingChange?.(false)
    }
    setPlaying(true)
    rec.start()
    setTimeout(() => rec.stop(), total * cycle + 200)
  }

  const partagerVideo = async () => {
    if (!video || !navigator.canShare?.({ files: [video.file] })) return
    try {
      await navigator.share({ files: [video.file], title: 'Remonter le temps' })
    } catch { /* partage annule : le lien de telechargement reste la */ }
  }

  if (total === 0) return null
  const annee = epochs[index]?.label ?? ''

  return (
    <figure className="m-0 min-w-0">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Vue aerienne du lieu, millesime ${annee}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="block w-full max-w-full cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--color-vermillon)]"
        />

        {/* L'annee est la charge emotionnelle : c'est le seul element qui a le droit
            d'etre grand. Voile en degrade pour rester lisible sur un toit clair. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent pt-16 pb-4 pl-4 pr-4">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[clamp(2.25rem,9vw,3.75rem)] leading-[0.85] font-semibold tabular-nums tracking-[-0.02em]">
              {annee}
            </span>
            <span className="pb-1 text-xs tabular-nums text-white/70">
              {Math.round(view.widthM)} m
            </span>
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        Timelapse des photographies aeriennes de l'IGN pour ce lieu.
      </figcaption>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Mettre en pause' : 'Lancer la lecture'}
          className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[var(--color-filet)] text-[var(--color-craie)] transition-colors hover:border-[var(--color-vermillon)]"
        >
          {playing ? (
            <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><rect x="1" y="1" width="4" height="14" fill="currentColor"/><rect x="9" y="1" width="4" height="14" fill="currentColor"/></svg>
          ) : (
            <svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M2 1l11 7-11 7z" fill="currentColor"/></svg>
          )}
        </button>

        <input
          type="range"
          min={0}
          max={total - 1}
          value={index}
          onChange={(e) => { setPlaying(false); goTo(Number(e.target.value)) }}
          aria-label="Choisir le millesime"
          className="h-11 flex-1 accent-[var(--color-vermillon)]"
        />

        <button
          onClick={exporter}
          className="tap h-11 shrink-0 rounded-full border border-[var(--color-filet)] px-4 text-sm transition-colors hover:border-[var(--color-vermillon)]"
        >
          Creer la video
        </button>
      </div>

      {video && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-filet)] p-3">
          <a
            href={video.url}
            download={video.nom}
            className="tap grid h-11 place-items-center rounded-full bg-[var(--color-vermillon)] px-5 text-sm font-medium text-[var(--color-encre)]"
          >
            Telecharger la video
          </a>
          {navigator.canShare?.({ files: [video.file] }) && (
            <button
              onClick={partagerVideo}
              className="tap h-11 rounded-full border border-[var(--color-filet)] px-4 text-sm transition-colors hover:border-[var(--color-vermillon)]"
            >
              Envoyer a quelqu'un
            </button>
          )}
          <span className="text-xs text-[var(--color-attenue)]">
            {video.ext.toUpperCase()}, {video.poids} Mo
          </span>
        </div>
      )}

      {/* La frise nommee est confortable a la souris, mais elle ferait seize cibles
          minuscules sur telephone : la reglette ci-dessus y suffit. */}
      <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
        {epochs.map((e, i) => (
          <button
            key={e.label}
            onClick={() => { setPlaying(false); goTo(i) }}
            aria-current={i === index}
            className={`h-9 rounded px-2.5 text-xs tabular-nums transition-colors ${
              i === index
                ? 'bg-[var(--color-vermillon)] text-[var(--color-encre)]'
                : 'text-[var(--color-attenue)] hover:text-[var(--color-craie)]'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
    </figure>
  )
}
