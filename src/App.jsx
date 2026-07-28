import { useEffect, useRef, useState } from 'react'
import Player from './Player.jsx'
import { loadAllEpochs } from './lib/ign.js'
import { suggest, reverse, parseCoords, isApproximate } from './lib/geocode.js'

const WIDTHS = [150, 300, 500, 800]

function readUrl() {
  const p = new URLSearchParams(window.location.search)
  const lat = parseFloat(p.get('lat'))
  const lon = parseFloat(p.get('lon'))
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null
  return { lat, lon, width: Number(p.get('w')) || 300, label: p.get('l') || '' }
}

export default function App() {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState([])
  const [place, setPlace] = useState(null)
  const [width, setWidth] = useState(300)
  const [epochs, setEpochs] = useState([])
  const [failed, setFailed] = useState([])
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const [copied, setCopied] = useState(false)
  const bootRef = useRef(false)

  // Autocompletion, sauf si l'utilisateur colle des coordonnees.
  useEffect(() => {
    if (parseCoords(query)) { setOptions([]); return }
    const t = setTimeout(() => {
      suggest(query).then(setOptions).catch(() => setOptions([]))
    }, 220)
    return () => clearTimeout(t)
  }, [query])

  async function run(next, w = width) {
    setPlace(next)
    setEpochs([])
    setFailed([])
    setError('')
    setProgress({ done: 0, total: 1 })
    try {
      const res = await loadAllEpochs(next.lat, next.lon, w, (done, total) =>
        setProgress({ done, total }),
      )
      setEpochs(res.epochs)
      setFailed(res.failed)
      if (res.epochs.length === 0) {
        setError("Aucune photo aerienne ne couvre ce point. L'IGN ne couvre que la France et ses outre-mer.")
      }
      const u = new URL(window.location.href)
      u.search = new URLSearchParams({
        lat: next.lat.toFixed(5), lon: next.lon.toFixed(5), w: String(w), l: next.label ?? '',
      }).toString()
      window.history.replaceState({}, '', u)
    } catch {
      setError('Le service IGN ne repond pas. Reessayez dans un instant.')
    } finally {
      setProgress(null)
    }
  }

  // Lien partage : on rejoue directement le lieu encode dans l'URL.
  useEffect(() => {
    if (bootRef.current) return
    bootRef.current = true
    const fromUrl = readUrl()
    if (fromUrl) {
      setWidth(fromUrl.width)
      setQuery(fromUrl.label)
      run({ lat: fromUrl.lat, lon: fromUrl.lon, label: fromUrl.label }, fromUrl.width)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    const coords = parseCoords(query)
    if (coords) {
      const label = (await reverse(coords.lat, coords.lon)) ?? `${coords.lat}, ${coords.lon}`
      return run({ ...coords, label })
    }
    if (options[0]) { setQuery(options[0].label); return run(options[0]) }
  }

  const locate = () => {
    if (!navigator.geolocation) return setError('Votre navigateur ne sait pas se localiser.')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const label = (await reverse(coords.latitude, coords.longitude)) ?? 'Ma position'
        setQuery(label)
        run({ lat: coords.latitude, lon: coords.longitude, label, fromGps: true })
      },
      () => setError("Localisation refusee. Tapez plutot une adresse."),
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
                      onClick={() => { setQuery(o.label); setOptions([]); run(o) }}
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
            title="Utiliser ma position"
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
              onClick={() => { setWidth(w); if (place) run(place, w) }}
              className={`rounded-md px-3 py-1.5 tabular-nums transition ${
                w === width
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

      {place && isApproximate(place) && epochs.length > 0 && (
        <p className="mt-6 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-3 text-sm text-slate-300">
          Ce point est approximatif : sans numero de rue, on tombe sur le centre de la commune.
          Pour viser juste, ouvrez Google Maps, clic droit sur le lieu exact, copiez les
          coordonnees et collez-les dans le champ ci-dessus.
        </p>
      )}

      {epochs.length > 0 && (
        <section className="mt-8 space-y-4">
          <Player epochs={epochs} onRecordingChange={setRecording} />

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              onClick={share}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-ink-soft)] px-4 py-2 hover:border-slate-500"
            >
              {copied ? 'Lien copie' : 'Copier le lien de ce lieu'}
            </button>
            <span className="text-slate-500">
              {epochs.length} millesimes trouves
              {failed.length > 0 && ` - ${failed.length} indisponibles (${failed.join(', ')})`}
            </span>
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
