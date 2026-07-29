import { useEffect, useMemo, useRef, useState } from 'react'
import { sourceRect, zoomAt, panBy, formatLargeur } from './lib/view.js'

const HOLD = 1100   // ms d'affichage plein d'un millesime
const FADE = 700    // ms de fondu vers le suivant

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Safari sait enregistrer en MP4 depuis la 17, ce que tout le monde sait relire.
// Ailleurs on retombe sur WebM. On demande le type au navigateur plutôt que de le
// supposer : un MediaRecorder cree avec un type non supporte leve.
function pickMime() {
  const candidats = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
  return candidats.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? ''
}

export default function Player({ epochs, buffer, view, cle, onViewChange, onRecordingChange }) {
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
  const [enreg, setEnreg] = useState(null)   // { debut, duree } pendant la capture
  const [tick, setTick] = useState(0)

  const total = epochs.length
  const fade = sobre ? 0 : FADE
  const cycle = HOLD + fade
  // Definition interne du canvas : elle suit la taille d'affichage (cf. canvasWidthFor).
  // La figer a 1200 px faisait boucler le rechargement sur telephone.
  const CANVAS_W = buffer.canvasW ?? 1200
  const canvasH = Math.round(CANVAS_W * buffer.aspect)

  // La boucle d'animation lit la vue dans une ref : la mettre dans les dépendances
  // ferait redemarrer l'effet a chaque cran de molette.
  viewRef.current = view

  // Un nouveau lieu peut avoir moins de millésimes que le précédent : sans remise à
  // zéro, la boucle lirait un index qui n'existe plus. On se cale sur le LIEU et non
  // sur le tableau : celui-ci s'enrichit pendant le chargement progressif, et repartir
  // de zéro à chaque vue reçue ferait bégayer l'animation.
  useEffect(() => {
    indexRef.current = 0
    setIndex(0)
  }, [cle])

  // L'enregistrement dure exactement total * cycle : la barre est donc determinee,
  // pas une animation decorative. On rafraichit 10 fois par seconde, ce qui suffit a
  // l'oeil sans reconstruire l'animation du canvas.
  useEffect(() => {
    if (!enreg) return
    const id = setInterval(() => setTick((t) => t + 1), 100)
    return () => clearInterval(id)
  }, [enreg])

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
  }, [onViewChange, canvasH, CANVAS_W])

  const onPointerDown = (e) => {
    // Enregistrer le pointeur d'abord : la capture est un confort et peut échouer.
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

  const zoomCentre = (facteur) =>
    onViewChange(zoomAt(viewRef.current, facteur, CANVAS_W, canvasH, CANVAS_W / 2, canvasH / 2))

  const onKeyDown = (e) => {
    const pas = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (pas) { e.preventDefault(); setPlaying(false); goTo(indexRef.current + pas) }
    if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p) }
  }

  // On enregistré un tour complet UNE fois, puis on laisse le choix : télécharger ou
  // partager. Declencher le partage direct ferait perdre le fichier a qui annule la
  // feuille native, et priverait le bureau du telechargement.
  const exporter = () => {
    const canvas = canvasRef.current
    if (!canvas?.captureStream) return
    const type = pickMime()
    if (!type) return
    if (video) URL.revokeObjectURL(video.url)
    setVideo(null)
    const duree = total * cycle + 200
    setEnreg({ debut: performance.now(), duree })
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
      setEnreg(null)
      onRecordingChange?.(false)
    }
    setPlaying(true)
    rec.start()
    setTimeout(() => rec.stop(), duree)
  }

  const partagerVideo = async () => {
    if (!video || !navigator.canShare?.({ files: [video.file] })) return
    try {
      await navigator.share({ files: [video.file], title: 'Remonter le temps' })
    } catch { /* partage annule : le lien de telechargement reste la */ }
  }

  void tick   // dépendance de rendu : c'est la minuterie qui fait avancer la barre

  if (total === 0) return null
  const annee = epochs[index]?.label ?? ''
  // Un bouton qui ne repond pas est pire qu'un bouton absent : on verifie le support
  // avant de l'afficher, plutot que d'echouer en silence au clic.
  const videoPossible =
    typeof MediaRecorder !== 'undefined' &&
    !!canvasRef.current?.captureStream &&
    !!pickMime()

  return (
    <figure className="m-0 min-w-0">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`Vue aérienne du lieu, millésime ${annee}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="block w-full max-w-full cursor-grab touch-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-[var(--color-vermillon)]"
        />

        {/* Le zoom existait déjà (molette, pincement) mais rien ne le montrait : le
            premier testeur a demandé la fonction alors qu'elle était là. Deux boutons
            sur l'image, là où l'oeil est - et une alternative cliquable au pincement,
            que tout le monde ne peut pas faire. */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => zoomCentre(1 / 1.6)}
            aria-label="Zoomer, voir plus serré"
            title="Zoomer, voir plus serré"
            className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-2xl leading-none text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoomCentre(1.6)}
            aria-label="Dézoomer, voir plus large"
            title="Dézoomer, voir plus large — les cartes anciennes apparaissent à partir de 700 m"
            className="grid h-11 w-11 place-items-center rounded-full bg-black/55 text-2xl leading-none text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            −
          </button>
        </div>

        {/* L'année est la charge émotionnelle : c'est le seul élément qui a le droit
            d'être grand. Voile en dégradé pour rester lisible sur un toit clair. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent pt-16 pb-4 pl-4 pr-4">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[clamp(2.25rem,9vw,3.75rem)] leading-[0.85] font-semibold tabular-nums tracking-[-0.02em]">
              {annee}
            </span>
            <span className="pb-1 text-xs tabular-nums text-white/70">
              {formatLargeur(view.widthM)}
            </span>
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        Les photographies aériennes de l'IGN pour ce lieu, mises bout à bout.
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
          aria-label="Choisir le millésime"
          aria-valuetext={annee}
          className="h-11 flex-1 accent-[var(--color-vermillon)]"
        />

        {videoPossible ? (
          <button
            onClick={exporter}
            className="tap h-11 shrink-0 rounded-full border border-[var(--color-filet)] px-4 text-sm transition-colors hover:border-[var(--color-vermillon)]"
          >
            Créer la vidéo
          </button>
        ) : (
          <span className="shrink-0 text-xs text-[var(--color-attenue)]">
            Export vidéo indisponible sur ce navigateur
          </span>
        )}
      </div>

      {enreg && (() => {
        const part = Math.min(1, (performance.now() - enreg.debut) / enreg.duree)
        const restant = Math.max(0, Math.ceil((enreg.duree * (1 - part)) / 1000))
        return (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-[var(--color-filet)] p-3">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>Enregistrement de la vidéo</span>
              <span className="tabular-nums text-[var(--color-attenue)]">
                encore {restant} s
              </span>
            </div>
            {/* La piste etait peinte en --color-encre, c'est-a-dire exactement la couleur
                du fond de page : invisible. Sur 4 px de haut, il ne restait qu'un mince
                trait vermillon, et le message portait seul toute l'information. */}
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-filet)]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(part * 100)}
              aria-valuetext={`${Math.round(part * 100)} %, encore ${restant} secondes`}
              aria-label="Enregistrement de la vidéo"
            >
              <div
                className="h-full rounded-full bg-[var(--color-vermillon)] transition-[width] duration-200"
                style={{ width: `${Math.max(3, part * 100)}%` }}
              />
            </div>
            {/* L'ancien message disait « l'animation doit aller au bout : laissez cet onglet
                au premier plan ». Il exprimait une contrainte technique du point de vue du
                systeme, et « onglet au premier plan » ne veut rien dire sur un telephone.
                On dit maintenant le mecanisme et la consequence. */}
            <p className="text-xs text-[var(--color-attenue)]">
              La vidéo se filme en direct, pendant que l'animation défile. Restez sur cette
              page : si vous la quittez, l'enregistrement s'arrêtera là.
            </p>
          </div>
        )
      })()}

      {video && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-filet)] p-3">
          <a
            href={video.url}
            download={video.nom}
            className="tap grid h-11 place-items-center rounded-full bg-[var(--color-vermillon)] px-5 text-sm font-medium text-[var(--color-encre)]"
          >
            Télécharger la vidéo
          </a>
          {navigator.canShare?.({ files: [video.file] }) && (
            <button
              onClick={partagerVideo}
              className="tap h-11 rounded-full border border-[var(--color-filet)] px-4 text-sm transition-colors hover:border-[var(--color-vermillon)]"
            >
              Envoyer à quelqu'un
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
