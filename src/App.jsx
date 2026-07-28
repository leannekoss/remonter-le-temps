import { useCallback, useEffect, useRef, useState } from 'react'
import Player from './Player.jsx'
import { loadAllEpochs } from './lib/ign.js'
import { suggest, reverse, parseCoords, isApproximate } from './lib/geocode.js'
import { bufferFor, needsRefetch, clampWidth } from './lib/view.js'

const WIDTHS = [150, 300, 500, 800]
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
  const [place, setPlace] = useState(null)      // metadonnees de geocodage, pour le message
  const [view, setView] = useState(null)        // fenetre affichee
  const [data, setData] = useState(null)        // { epochs, buffer, failed }
  const [progress, setProgress] = useState(null)
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const bootRef = useRef(false)
  const runRef = useRef(0)

  useEffect(() => {
    if (parseCoords(query)) { setOptions([]); return }
    const t = setTimeout(() => {
      suggest(query).then(setOptions).catch(() => setOptions([]))
    }, 220)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async (target, keepVisible) => {
    const run = ++runRef.current
    const buffer = bufferFor(target)
    setError('')
    if (keepVisible) setRefining(true)
    else setProgress({ done: 0, total: 1 })
    try {
      const res = await loadAllEpochs(buffer, (done, total) => {
        if (run === runRef.current && !keepVisible) setProgress({ done, total })
      })
      if (run !== runRef.current) return          // une demande plus recente a pris la main
      if (res.epochs.length === 0) {
        setError("Aucune photo aerienne ne couvre ce point. L'IGN ne couvre que la France et ses outre-mer.")
        if (!keepVisible) setData(null)
        return
      }
      setData({ epochs: res.epochs, buffer, failed: res.failed })
    } catch {
      if (run === runRef.current) setError('Le service IGN ne repond pas. Reessayez dans un instant.')
    } finally {
      if (run === runRef.current) { setProgress(null); setRefining(false) }
    }
  }, [])

  // Un geste ne declenche un telechargement que s'il sort du tampon ou reclame plus
  // de definition qu'il n'en contient - et seulement une fois la main relachee.
  useEffect(() => {
    if (!view) return
    if (!data) { load(view, false); return }
    if (!needsRefetch(view, data.buffer, CANVAS_W)) return
    const t = setTimeout(() => load(view, true), SETTLE)
    return () => clearTimeout(t)
  }, [view, data, load])

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
      return goTo({ ...coords, label, type: 'housenumber', score: 1 })
    }
    if (options[0]) { setQuery(options[0].label); setOptions([]); goTo(options[0]) }
  }

  const locate = () => {
    if (!navigator.geolocation) return setError('Votre navigateur ne sait pas se localiser.')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const label = (await reverse(coords.latitude, coords.longitude)) ?? 'Ma position'
        setQuery(label)
        goTo({ lat: coords.latitude, lon: coords.longitude, label, type: 'housenumber', score: 1 })
      },
      () => setError('Localisation refusee. Tapez plutot une adresse.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const share = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Remonter le temps</h1>
        <p className="mt-2 max-w-xl text-slate-400">
          Un lieu en France, vu du ciel, des annees 1950 a aujourd'hui. Les photos viennent
          de l'IGN, qui survole le pays depuis l'apres-guerre.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Une adresse, ou des coordonnees collees"
              className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-3 outline-none placeholder:text-slate-500 focus:border-sky-500"
            />
            {options.length > 0 && query !== options[0]?.label && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] shadow-xl">
                {options.map((o) => (
                  <li key={o.label + o.lat}>
                    <button
                      type="button"
                      onClick={() => { setQuery(o.label); setOptions([]); goTo(o) }}
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-white/5"
                    >
                      {o.label}
                      <span className="ml-2 text-xs text-slate-500">{o.context}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={locate}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-3 text-sm hover:border-slate-500"
          >
            Ma position
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
          <span>Largeur de la vue</span>
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => view && setView({ ...view, widthM: w })}
              className={`rounded-md px-3 py-1.5 tabular-nums transition ${
                view && Math.round(view.widthM) === w
                  ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40'
                  : 'bg-[var(--color-ink-soft)] hover:text-slate-200'
              }`}
            >
              {w} m
            </button>
          ))}
        </div>
      </form>

      {progress && (
        <p className="mt-6 text-sm text-slate-400">
          Chargement des millesimes... {progress.done}/{progress.total}
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </p>
      )}

      {place && isApproximate(place) && data && (
        <p className="mt-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-3 text-sm text-slate-300">
          Ce point est approximatif : sans numero de rue, on tombe sur le centre de la commune.
          Faites glisser l'image jusqu'a votre maison, et zoomez a la molette.
        </p>
      )}

      {data && view && (
        <section className="mt-8 space-y-4">
          <Player
            epochs={data.epochs}
            buffer={data.buffer}
            view={view}
            onViewChange={setView}
            onRecordingChange={setRecording}
          />

          <p className="text-xs text-slate-500">
            Faites glisser pour deplacer, molette ou pincement pour zoomer.
          </p>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              onClick={share}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-2 hover:border-slate-500"
            >
              {copied ? 'Lien copie' : 'Copier le lien de cette vue'}
            </button>
            <span className="text-slate-500">
              {data.epochs.length} millesimes trouves
              {data.failed.length > 0 && ` - ${data.failed.length} indisponibles (${data.failed.join(', ')})`}
            </span>
            {refining && <span className="text-sky-300">Affinage...</span>}
          </div>

          {recording && (
            <p className="text-sm text-sky-300">
              Enregistrement en cours, laissez l'animation tourner jusqu'au bout...
            </p>
          )}
        </section>
      )}

      <footer className="mt-14 border-t border-[var(--color-line)] pt-6 text-xs leading-relaxed text-slate-500">
        <p>
          Photos aeriennes : IGN - Geoplateforme (data.geopf.fr), sous Licence Ouverte Etalab 2.0.
          Recherche d'adresse : Base Adresse Nationale.
        </p>
        <p className="mt-2">
          L'IGN photographie la France par rotation, tous les departements ne sont pas survoles
          chaque annee : le nombre de millesimes disponibles varie selon les endroits.
          Aucune donnee n'est collectee, tout le traitement se fait dans votre navigateur.
        </p>
      </footer>
    </div>
  )
}
