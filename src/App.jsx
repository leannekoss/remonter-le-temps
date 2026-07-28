import { useCallback, useEffect, useRef, useState } from 'react'
import Player from './Player.jsx'
import Chargement from './Chargement.jsx'
import { loadAllEpochs } from './lib/ign.js'
import { suggest, reverse, parseCoords, isApproximate } from './lib/geocode.js'
import { bufferFor, needsRefetch, clampWidth } from './lib/view.js'

const WIDTHS = [150, 300, 800, 2000]
const CANVAS_W = 1200
const SETTLE = 400   // ms d'immobilite avant de retelecharger apres un geste

function readUrl() {
  const p = new URLSearchParams(window.location.search)
  const lat = parseFloat(p.get('lat'))
  const lon = parseFloat(p.get('lon'))
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  return { view: { lat, lon, widthM: clampWidth(Number(p.get('w')) || 300) }, label: p.get('l') || '' }
}

export default function App() {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState([])
  const [typing, setTyping] = useState(false)
  const [place, setPlace] = useState(null)      // metadonnees de geocodage, pour le message
  const [view, setView] = useState(null)        // fenetre affichee
  const [data, setData] = useState(null)        // { epochs, buffer, failed, tropSerrees }
  const [progress, setProgress] = useState(null)
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [shared, setShared] = useState(false)
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth))
  const bootRef = useRef(false)
  const runRef = useRef(0)

  // La rotation du téléphone change le format de la vue, donc le tampon a retelecharger.
  useEffect(() => {
    let t
    const onResize = () => { clearTimeout(t); t = setTimeout(() => setVw(window.innerWidth), 250) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t) }
  }, [])

  // On ne propose des adresses que si l'utilisateur tape vraiment. Sans ce garde-fou,
  // un lien partage (qui arrive avec un libelle dans l'URL) ouvre la liste tout seul
  // et recouvre l'image des l'arrivee.
  useEffect(() => {
    if (!typing || parseCoords(query)) { setOptions([]); return }
    const t = setTimeout(() => {
      suggest(query).then(setOptions).catch(() => setOptions([]))
    }, 220)
    return () => clearTimeout(t)
  }, [query, typing])

  const load = useCallback(async (target, keepVisible, viewportWidth) => {
    const run = ++runRef.current
    const buffer = bufferFor(target, viewportWidth)
    setError('')
    if (keepVisible) setRefining(true)
    else setProgress({ done: 0, total: 0, trouvees: 0, dernier: null })
    try {
      const res = await loadAllEpochs(buffer, (done, total, trouvees, trouve) => {
        if (run !== runRef.current || keepVisible) return
        setProgress((p) => ({ done, total, trouvees, dernier: trouve ?? p?.dernier ?? null }))
      })
      if (run !== runRef.current) return          // une demande plus recente a pris la main
      if (res.epochs.length === 0) {
        setError("Aucune photo aérienne ne couvre ce point. L'IGN couvre la France et ses outre-mer.")
        if (!keepVisible) setData(null)
        return
      }
      setData({ epochs: res.epochs, buffer, failed: res.failed, tropSerrees: res.tropSerrees })
    } catch {
      if (run === runRef.current) setError("Le service de l'IGN ne répond pas. Réessayez dans un instant.")
    } finally {
      if (run === runRef.current) { setProgress(null); setRefining(false) }
    }
  }, [])

  // Un geste ne déclenche un telechargement que s'il sort du tampon, reclame plus de
  // définition, ou si le format d'écran a change - et seulement la main relachee.
  useEffect(() => {
    if (!view) return
    if (!data) { load(view, false, vw); return }
    if (!needsRefetch(view, data.buffer, CANVAS_W, vw)) return
    const t = setTimeout(() => load(view, true, vw), SETTLE)
    return () => clearTimeout(t)
  }, [view, data, vw, load])

  // L'URL suit la vue, pour que le lien partage rejoue exactement le cadrage.
  useEffect(() => {
    if (!view) return
    const t = setTimeout(() => {
      const u = new URL(window.location.href)
      u.search = new URLSearchParams({
        lat: view.lat.toFixed(5), lon: view.lon.toFixed(5),
        w: String(Math.round(view.widthM)), l: place?.label ?? '',
      }).toString()
      window.history.replaceState({}, '', u)
    }, SETTLE)
    return () => clearTimeout(t)
  }, [view, place])

  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    const fromUrl = readUrl()
    if (fromUrl) {
      setQuery(fromUrl.label)
      setPlace({ label: fromUrl.label, type: 'housenumber', score: 1 })
      setView(fromUrl.view)
    }
  }, [])

  const goTo = (next, widthM) => {
    setPlace(next)
    setView({ lat: next.lat, lon: next.lon, widthM: widthM ?? view?.widthM ?? 300 })
  }

  const submit = async (e) => {
    e.preventDefault()
    const coords = parseCoords(query)
    if (coords) {
      const label = (await reverse(coords.lat, coords.lon)) ?? `${coords.lat}, ${coords.lon}`
      setTyping(false)
      return goTo({ ...coords, label, type: 'housenumber', score: 1 })
    }
    if (options[0]) { setTyping(false); setQuery(options[0].label); setOptions([]); goTo(options[0]) }
  }

  const locate = () => {
    if (!navigator.geolocation) return setError("Votre navigateur ne sait pas se localiser.")
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const label = (await reverse(coords.latitude, coords.longitude)) ?? 'Ma position'
        setTyping(false)
        setQuery(label)
        goTo({ lat: coords.latitude, lon: coords.longitude, label, type: 'housenumber', score: 1 })
      },
      () => setError("Localisation refusée. Tapez plutôt une adresse."),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Une seule action de partage : la feuille native du téléphone quand elle existe,
  // la copié du lien sinon.
  const partager = async () => {
    const payload = {
      title: 'Remonter le temps',
      text: place?.label ? `${place.label}, vu du ciel depuis 1950` : 'Ce lieu, vu du ciel depuis 1950',
      url: window.location.href,
    }
    if (navigator.share) {
      try { await navigator.share(payload); return } catch { /* annule */ }
    }
    await navigator.clipboard.writeText(window.location.href)
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  const champ = 'w-full rounded-lg border border-[var(--color-filet)] bg-[var(--color-surface)] px-4 py-3 text-[16px] outline-none placeholder:text-[var(--color-attenue)] focus:border-[var(--color-vermillon)]'

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-6 sm:py-12">
      <header>
        <h1 className="text-[clamp(1.75rem,6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
          Remonter le temps
        </h1>
        <p className="mt-2 max-w-[60ch] text-[var(--color-attenue)]">
          Un lieu en France à travers le temps : les photos aériennes de l'IGN depuis 1950,
          et en dézoomant, la carte d'état-major du XIX<sup>e</sup> siècle puis celle de Cassini.
        </p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => { setTyping(true); setQuery(e.target.value) }}
              placeholder="Une adresse en France"
              aria-label="Adresse ou coordonnées"
              className={champ}
            />
            {options.length > 0 && query !== options[0]?.label && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-filet)] bg-[var(--color-surface)] shadow-2xl">
                {options.map((o) => (
                  <li key={o.label + o.lat}>
                    <button
                      type="button"
                      onClick={() => { setTyping(false); setQuery(o.label); setOptions([]); goTo(o) }}
                      className="block w-full px-4 py-3 text-left text-sm hover:bg-white/5"
                    >
                      {o.label}
                      <span className="ml-2 text-xs text-[var(--color-attenue)]">{o.context}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={locate}
            aria-label="Utiliser ma position"
            className="tap grid h-[50px] w-[50px] shrink-0 place-items-center rounded-lg border border-[var(--color-filet)] transition-colors hover:border-[var(--color-vermillon)]"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.6"/>
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" opacity=".45"/>
              <path d="M10 .8v2.4M10 16.8v2.4M.8 10h2.4M16.8 10h2.4" stroke="currentColor" strokeWidth="1.6"/>
            </svg>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => view && setView({ ...view, widthM: w })}
              aria-pressed={!!view && Math.round(view.widthM) === w}
              className={`tap h-11 rounded-lg px-3 text-sm tabular-nums transition-colors ${
                view && Math.round(view.widthM) === w
                  ? 'bg-[var(--color-vermillon)] font-medium text-[var(--color-encre)]'
                  : 'text-[var(--color-attenue)] hover:text-[var(--color-craie)]'
              }`}
            >
              {w >= 1000 ? `${w / 1000} km` : `${w} m`}
            </button>
          ))}
        </div>
      </form>

      {progress && (
        <Chargement
          done={progress.done}
          total={progress.total}
          trouvees={progress.trouvees}
          dernier={progress.dernier}
          cartesAnciennes={!!view && view.widthM >= 700}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-[var(--color-vermillon)]/40 bg-[var(--color-vermillon)]/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}

      {data && view && (
        <section className="flex min-w-0 flex-col gap-4">
          <Player
            epochs={data.epochs}
            buffer={data.buffer}
            view={view}
            onViewChange={setView}
            onRecordingChange={setRecording}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={partager}
              className="tap h-11 rounded-full bg-[var(--color-vermillon)] px-5 text-sm font-medium text-[var(--color-encre)]"
            >
              {shared ? 'Lien copié' : 'Partager ce lieu'}
            </button>
            <span className="text-sm text-[var(--color-attenue)]">
              {data.epochs.length} millésimes
              {data.failed.length > 0 && `, ${data.failed.length} indisponibles`}
              {refining && ' - affinage...'}
            </span>
          </div>

          {recording && (
            <p role="status" className="text-sm text-[var(--color-vermillon)]">
              Enregistrement en cours, laissez l'animation aller au bout.
            </p>
          )}

          <p className="text-sm text-[var(--color-attenue)]">
            Faites glisser l'image pour vous déplacer, pincez ou utilisez la molette pour zoomer.
          </p>

          {place && isApproximate(place) && (
            <p className="rounded-lg border border-[var(--color-filet)] px-4 py-3 text-sm">
              Ce point est approximatif : sans numéro de rue, on tombe sur le centre de la
              commune. Faites glisser l'image jusqu'à votre maison.
            </p>
          )}

          {data.tropSerrees?.length > 0 && (
            <p className="rounded-lg border border-[var(--color-filet)] px-4 py-3 text-sm">
              Avant la photo aérienne, il y a les cartes. Dézoomez pour les faire apparaître :{' '}
              {data.tropSerrees.map((m) => `${m.label} à partir de ${m.minWidthM} m`).join(', ')}.
              Elles ont été dessinées à une échelle donnée ; plus près, on ne verrait que le
              grain du papier.
            </p>
          )}
        </section>
      )}

      <footer className="mt-auto border-t border-[var(--color-filet)] pt-5 text-xs leading-relaxed text-[var(--color-attenue)]">
        <p className="mb-3 text-sm text-[var(--color-craie)]">
          Fait avec amour par{' '}
          <a
            href="https://www.linkedin.com/in/henricasalis/"
            target="_blank"
            rel="noopener noreferrer"
            className="tap inline-block underline decoration-[var(--color-vermillon)] decoration-2 underline-offset-4 transition-colors hover:text-[var(--color-vermillon)]"
          >
            Henri Casalis
          </a>
        </p>
        <p>
          Photographies aériennes, carte d'état-major et carte de Cassini : Institut national
          de l'information géographique et forestière (IGN), via data.geopf.fr, sous Licence
          Ouverte Etalab 2.0. Cassini numérisée avec les Archives nationales. Données mises à
          jour en 2026. Recherche d'adresse : Base Adresse Nationale.
        </p>
        <p className="mt-2">
          L'IGN photographie la France par rotation : tous les départements ne sont pas
          survolés chaque année, le nombre de millésimes varie donc selon les endroits.
          Aucune donnée n'est collectée, aucun script tiers n'est chargé, tout le traitement
          se fait dans votre navigateur.
        </p>
      </footer>
    </div>
  )
}
