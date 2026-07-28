import { useCallback, useEffect, useRef, useState } from 'react'
import Player from './Player.jsx'
import Chargement from './Chargement.jsx'
import { loadAllEpochs } from './lib/ign.js'
import { suggest, reverse, parseCoords, isApproximate, widthForType } from './lib/geocode.js'
import { bufferFor, needsRefetch, clampWidth } from './lib/view.js'

const WIDTHS = [150, 300, 800, 2000]

// Quatre lieux ou le changement saute aux yeux : c'est la demonstration la plus courte
// du produit, un clic au lieu d'une explication. Coordonnees verifiees au geocodage
// inverse, cadrage verifie a l'image.
const EXEMPLES = [
  { label: 'Le viaduc de Millau', lat: 44.0794, lon: 3.0225, widthM: 2000, quoi: "il n'existait pas avant 2004" },
  { label: 'La Défense', lat: 48.8926, lon: 2.2358, widthM: 800, quoi: 'des usines, puis des tours' },
  { label: "L'aéroport de Roissy", lat: 49.0097, lon: 2.5479, widthM: 2000, quoi: "des champs jusqu'en 1974" },
  { label: 'Le Mont-Saint-Michel', lat: 48.6361, lon: -1.5115, widthM: 800, quoi: 'la digue a disparu' },
]
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
  const [localisation, setLocalisation] = useState(null)   // null | 'en cours' | précision en m
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth))
  const bootRef = useRef(false)
  const vueRef = useRef(null)
  const dejaDefile = useRef(false)
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
      const res = await loadAllEpochs(
        buffer,
        (done, total, trouvees, trouve) => {
          if (run !== runRef.current || keepVisible) return
          setProgress((p) => ({ done, total, trouvees, dernier: trouve ?? p?.dernier ?? null }))
        },
        // Affichage progressif : la premiere vue arrive en une seconde environ, on la
        // montre au lieu d'attendre les 19 couches. On ne le fait qu'au premier
        // chargement : pendant un affinage, remplacer l'image en cours ferait clignoter
        // la vue entre deux tampons.
        keepVisible
          ? undefined
          : (epoch) => {
              if (run !== runRef.current) return
              setData((d) => {
                const cle = `${buffer.lat},${buffer.lon},${buffer.viewWidthM}`
                const base = d && d.cle === cle ? d.epochs : []
                const epochs = [...base, epoch].sort((a, b) => a.year - b.year)
                return { cle, epochs, buffer, failed: d?.failed ?? [], tropSerrees: d?.tropSerrees ?? [] }
              })
            },
      )
      if (run !== runRef.current) return          // une demande plus recente a pris la main
      if (res.epochs.length === 0) {
        setError("Aucune photo aérienne ne couvre ce point. L'IGN couvre la France et ses outre-mer.")
        if (!keepVisible) setData(null)
        return
      }
      setData({
        cle: `${buffer.lat},${buffer.lon},${buffer.viewWidthM}`,
        epochs: res.epochs, buffer, failed: res.failed, tropSerrees: res.tropSerrees,
      })
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
      // Le libellé n'est PAS écrit dans l'URL : un lien partagé voyage loin (historique
      // du destinataire, messageries, journaux serveur) et emporterait l'adresse du
      // domicile en clair. Les coordonnées sont arrondies à 4 décimales, soit une
      // dizaine de mètres - assez pour retrouver le lieu, pas pour désigner une porte.
      const u = new URL(window.location.href)
      u.search = new URLSearchParams({
        lat: view.lat.toFixed(4), lon: view.lon.toFixed(4),
        w: String(Math.round(view.widthM)),
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
      // Les anciens liens portaient encore un libellé : on l'accepte, on ne le réémet pas.
      setQuery(fromUrl.label)
      setPlace({ label: fromUrl.label, type: 'housenumber', score: 1 })
      setView(fromUrl.view)
    }
  }, [])

  // Sur telephone, le resultat apparait sous le champ et le clavier : sans ce
  // defilement, on croit qu'il ne s'est rien passe.
  useEffect(() => {
    if (!data || dejaDefile.current || !vueRef.current) return
    dejaDefile.current = true
    const sobre = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    vueRef.current.scrollIntoView({ behavior: sobre ? 'auto' : 'smooth', block: 'start' })
  }, [data])

  const goTo = (next, widthM) => {
    dejaDefile.current = false
    setPlace(next)
    setView({ lat: next.lat, lon: next.lon, widthM: widthM ?? widthForType(next.type) })
  }

  const submit = async (e) => {
    e.preventDefault()
    const coords = parseCoords(query)
    if (coords) {
      const label = (await reverse(coords.lat, coords.lon)) ?? `${coords.lat}, ${coords.lon}`
      setTyping(false)
      return goTo({ ...coords, label, type: 'housenumber', score: 1 })
    }
    if (options[0]) {
      setTyping(false); setQuery(options[0].label); setOptions([]); return goTo(options[0])
    }
    // L'utilisateur peut valider avant que les suggestions soient revenues : on cherche
    // alors nous-memes, plutot que de ne rien faire - c'est la que le parcours cassait.
    if (query.trim().length >= 3) {
      const res = await suggest(query).catch(() => [])
      if (res[0]) { setTyping(false); setQuery(res[0].label); setOptions([]); return goTo(res[0]) }
      setError("Adresse introuvable. Essayez avec la commune, ou collez des coordonnées.")
    }
  }

  const locate = () => {
    if (!navigator.geolocation) return setError("Votre navigateur ne sait pas se localiser.")
    setLocalisation('en cours')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const label = (await reverse(coords.latitude, coords.longitude)) ?? 'Ma position'
        setTyping(false)
        setQuery(label)
        setLocalisation(Math.round(coords.accuracy))
        // Le cadrage suit la précision réelle du relevé. Au GPS d'un téléphone on est
        // à quelques mètres et 300 m se justifient ; sur un ordinateur la position
        // vient du wifi ou de l'adresse IP et peut être fausse de plusieurs kilomètres,
        // auquel cas un cadrage serré montrerait le quartier d'à côté avec aplomb.
        const p = coords.accuracy
        const largeur = p <= 20 ? 300 : p <= 100 ? 500 : p <= 1000 ? 2000 : 4000
        goTo(
          { lat: coords.latitude, lon: coords.longitude, label, type: 'housenumber', score: 1 },
          largeur,
        )
      },
      (err) => {
        setLocalisation(null)
        setError(err.code === err.PERMISSION_DENIED
          ? "Localisation refusée. Tapez plutôt une adresse."
          : "Position introuvable pour le moment. Tapez plutôt une adresse.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  // Une seule action de partage : la feuille native du téléphone quand elle existe,
  // la copie du lien sinon.
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

        <button
          type="submit"
          className="tap h-12 w-full rounded-lg bg-[var(--color-vermillon)] text-[15px] font-medium text-[var(--color-encre)] transition-opacity hover:opacity-90 sm:w-auto sm:px-8 sm:self-start"
        >
          Voir ce lieu
        </button>

        {/* Les largeurs ne pilotent rien tant qu'aucun lieu n'est choisi : les montrer
            avant, c'est offrir un bouton mort. */}
        {view && (
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
        )}
      </form>

      {!view && !progress && (
        <section className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-attenue)]">
            Tapez une adresse et l'animation se lance toute seule.
          </p>

          <button
            type="button"
            onClick={locate}
            className="tap flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-filet)] text-[15px] transition-colors hover:border-[var(--color-vermillon)] sm:w-auto sm:px-6 sm:self-start"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.6"/>
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" opacity=".45"/>
              <path d="M10 .8v2.4M10 16.8v2.4M.8 10h2.4M16.8 10h2.4" stroke="currentColor" strokeWidth="1.6"/>
            </svg>
            {localisation === 'en cours' ? 'Localisation...' : 'Utiliser ma position'}
          </button>

          <p className="text-sm text-[var(--color-attenue)]">
            Ou commencez par un lieu qui a beaucoup changé :
          </p>
          <ul className="flex flex-col gap-1">
            {EXEMPLES.map((ex) => (
              <li key={ex.label}>
                <button
                  type="button"
                  onClick={() => { setTyping(false); setQuery(ex.label); goTo(ex, ex.widthM) }}
                  className="tap flex w-full items-baseline gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface)]"
                >
                  <span className="font-medium text-[var(--color-craie)]">{ex.label}</span>
                  <span className="text-sm text-[var(--color-attenue)]">{ex.quoi}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <section ref={vueRef} className="flex min-w-0 scroll-mt-4 flex-col gap-4">
          <Player
            epochs={data.epochs}
            buffer={data.buffer}
            cle={data.cle}
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
              {data.epochs.length} millésime{data.epochs.length > 1 ? 's' : ''}
              {data.failed.length > 0 &&
                ` - ${data.failed.length === 1 ? 'un millésime indisponible' : `${data.failed.length} millésimes indisponibles`} (${data.failed.join(', ')})`}
              {refining && ' - affinage...'}
            </span>
          </div>

          <p className="text-sm text-[var(--color-attenue)]">
            Faites glisser l'image pour vous déplacer. Les boutons + et − changent l'échelle, comme la molette et le pincement.
          </p>

          {typeof localisation === 'number' && localisation > 100 && (
            <p className="rounded-lg border border-[var(--color-filet)] px-4 py-3 text-sm">
              Votre appareil situe votre position à environ {localisation >= 1000
                ? `${(localisation / 1000).toFixed(1)} km`
                : `${localisation} m`} près - c'est courant sur un ordinateur, qui se
              repère au wifi plutôt qu'au GPS. La vue est élargie en conséquence :
              déplacez-la et zoomez pour tomber juste.
            </p>
          )}

          {place && isApproximate(place) && (
            <p className="rounded-lg border border-[var(--color-filet)] px-4 py-3 text-sm">
              {place.type === 'municipality'
                ? "Vous avez cherché une commune : la vue est centrée sur le bourg. Zoomez et faites glisser l'image pour trouver l'endroit qui vous intéresse."
                : "Ce point est approximatif : sans numéro de rue, on tombe à côté. Zoomez et faites glisser l'image jusqu'à votre maison."}
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
        </p>
        <p className="mt-2">
          Ce site ne stocke rien, n'a pas de serveur et ne charge aucun script tiers : tout
          le traitement se fait dans votre navigateur. Il interroge en revanche deux services
          publics directement depuis votre appareil, qui reçoivent donc vos requêtes : la Base
          Adresse Nationale reçoit l'adresse que vous tapez, ou votre position si vous
          l'autorisez, et l'IGN reçoit les coordonnées de la vue affichée. Ce qu'ils en
          conservent relève de leurs propres conditions.
        </p>
      </footer>
    </div>
  )
}
