// Accès aux orthophotos IGN (Géoplateforme, sans clé, CORS ouvert).
//
// ⚠️ Ce fichier interrogeait le WMS jusqu'au 29/07/2026. Il a été porté sur le WMTS
// après une panne mesurée en production : le WMS répondait « LayerNotDefined » sur des
// couches pourtant présentes au GetCapabilities, de façon erratique et sans jamais
// guérir au bout de 5 tentatives. Rennes affichait 1 millésime sur 17 disponibles.
//
// Trois mesures ont tranché, le 29/07 :
//   - en séquentiel, une requête à la fois : 6 échecs sur 8 -> ce n'est pas la charge
//   - depuis un autre réseau (VPS, autre IP) : 3 échecs sur 6 -> ce n'est pas le client
//   - le même appel répété 10 fois : 10/10 -> l'échec est erratique, pas structurel
// Le WMTS, lui, sert des tuiles pré-calculées depuis un cache : réponses identiques
// d'un passage à l'autre sur 4 lieux testés, zéro erreur, et 17/19 couches à Rennes.
// Il est aussi la seule API de diffusion IGN sans limite de débit.
//
// Tout est sous Licence Ouverte Etalab (mention IGN obligatoire, cf. pied de page).

const WMTS = 'https://data.geopf.fr/wmts'
const TUILE = 256

// Plafond de tuiles par millésime. Calibré sur les mesures du 29/07 : une vue de 2 km
// demande environ 23 tuiles au niveau retenu, une vue de 300 m environ 35. Au-delà de 40
// on paie un cran de zoom inutile - c'est ce qui faisait exploser le coût dans le sud
// de la France. Voir le commentaire de loadEpoch.
const MAX_TUILES = 40

// Chaque couche a SON style et SA plage de niveaux : lus dans le GetCapabilities WMTS,
// pas devinés. Deux pièges qui feraient disparaître des millésimes en silence :
//   - les campagnes historiques veulent le style BDORTHOHISTORIQUE, pas « normal »
//     (« normal » y répond 400 « Style normal unknown »)
//   - zmax varie : Cassini s'arrête à 14, l'état-major à 15, les orthophotos vont à 18-19.
//     C'est l'IGN qui encode ainsi l'échelle de dessin de ses cartes anciennes.
// `nature` distingue les trois matières que le site mélange dans une même frise :
// une carte gravée de 1760, un tirage argentique de 1955 et une orthophoto couleur de 2024
// ne sont pas le même objet, et rien ne le disait. L'interface s'en sert pour colorer la
// frise — voir les tokens --color-ocre / --color-prusse / --color-vermillon dans index.css.
const O = (id, annee, label, extra = {}) =>
  ({ id, style: 'normal', format: 'image/jpeg', zmin: 6, zmax: 18, nature: 'couleur', annee, label, ...extra })

export const LAYERS = [
  O('ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', 1957, '1950-1965', { style: 'BDORTHOHISTORIQUE', format: 'image/png', nature: 'argentique', zmin: 0 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS.1965-1980', 1972, '1965-1980', { style: 'BDORTHOHISTORIQUE', format: 'image/png', nature: 'argentique', zmin: 3 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS.1980-1995', 1987, '1980-1995', { style: 'BDORTHOHISTORIQUE', format: 'image/png', nature: 'argentique', zmin: 3 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2000-2005', 2002, '2000-2005'),
  O('ORTHOIMAGERY.ORTHOPHOTOS2006-2010', 2008, '2006-2010'),
  O('ORTHOIMAGERY.ORTHOPHOTOS2011-2015', 2013, '2011-2015'),
  O('ORTHOIMAGERY.ORTHOPHOTOS2016', 2016, '2016', { zmin: 0 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2017', 2017, '2017', { zmin: 0 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2018', 2018, '2018', { zmin: 0 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2019', 2019, '2019'),
  O('ORTHOIMAGERY.ORTHOPHOTOS2020', 2020, '2020', { zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2021', 2021, '2021', { zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2022', 2022, '2022', { zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2023', 2023, '2023', { zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS2024', 2024, '2024', { zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS.ORTHO-EXPRESS.2025', 2025, '2025', { zmin: 0, zmax: 19 }),
  O('ORTHOIMAGERY.ORTHOPHOTOS.RVB-EXPRESS.2026', 2026, '2026', { zmin: 0, zmax: 19 }),
]

// Avant la photographie aérienne, il reste les cartes - numérisées et calées par l'IGN,
// donc même service et même licence ouverte que les orthophotos.
//
// Elles ont été dessinées à une échelle donnée : les afficher sur 200 m de large ne
// montre que du grain. D'où minWidthM, la largeur de vue en dessous de laquelle on ne
// les propose pas. Seuils validés à l'oeil le 28/07 sur la parcelle de référence.
export const HISTORIC = [
  O('AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 1760, 'vers 1760 - Cassini', { zmin: 0, zmax: 14, minWidthM: 2000, nature: 'carte' }),
  O('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 1840, 'vers 1840 - état-major', { zmax: 15, minWidthM: 700, nature: 'carte' }),
]

const M_PER_DEG = 111320
const rad = (d) => (d * Math.PI) / 180

// Emprise centrée sur le point. `aspect` = hauteur / largeur : 2/3 en paysage sur
// grand écran, 1.25 en portrait sur téléphone.
export function bboxAround(lat, lon, widthM, aspect = 2 / 3) {
  const dLat = (widthM * aspect) / M_PER_DEG
  const dLon = widthM / (M_PER_DEG * Math.cos(rad(lat)))
  return [lat - dLat / 2, lon - dLon / 2, lat + dLat / 2, lon + dLon / 2]
}

// Position d'un point dans la grille de tuiles, en tuiles fractionnaires (Web Mercator).
function enTuiles(lat, lon, z) {
  const n = 2 ** z
  const y = (1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2
  return { x: ((lon + 180) / 360) * n, y: y * n }
}

// Mètres par pixel du niveau z, à cette latitude.
const resolution = (lat, z) => (156543.033928 * Math.cos(rad(lat))) / 2 ** z

// Le niveau à demander. On vise la résolution de l'AFFICHAGE, pas la résolution
// maximale : le canvas fait 736 px de large sur bureau et 358 sur téléphone (mesuré),
// alors demander du 20 cm sur une vue de 2 km multiplierait les tuiles par 16 sans
// qu'un seul pixel de plus soit visible. On arrondit donc vers le bas, comme toute
// carte web, puis on borne à la plage que la couche publie réellement.
export function niveauPour(lat, widthM, pxAffiches, { zmin, zmax }) {
  const voulue = widthM / Math.max(1, pxAffiches)
  let z = zmax
  while (z > zmin && resolution(lat, z) < voulue) z--
  return Math.min(zmax, Math.max(zmin, z))
}

// Une tuile. Le 404 n'est PAS une panne : c'est le WMTS qui dit proprement « aucune
// donnée ici pour ce millésime ». C'est exactement ce que le WMS ne savait pas faire.
async function tuile(couche, z, col, row, signal) {
  const q = new URLSearchParams({
    SERVICE: 'WMTS', VERSION: '1.0.0', REQUEST: 'GetTile',
    LAYER: couche.id, STYLE: couche.style, FORMAT: couche.format,
    TILEMATRIXSET: 'PM', TILEMATRIX: String(z), TILEROW: String(row), TILECOL: String(col),
  })
  const r = await fetch(`${WMTS}?${q}`, { signal })
  if (r.status === 404) return null                       // pas de couverture, cas normal
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const type = r.headers.get('content-type') || ''
  if (!type.startsWith('image/')) throw new Error('réponse non image')
  return r.blob()
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Charge un millésime : assemble les tuiles qui couvrent l'emprise, puis recadre au
// pixel près. Renvoie null quand aucune tuile n'existe (le millésime ne couvre pas).
export async function loadEpoch(couche, bbox, pxW, pxH, signal) {
  const [lat1, lon1, lat2, lon2] = bbox
  const latC = (lat1 + lat2) / 2
  const widthM = (lon2 - lon1) * M_PER_DEG * Math.cos(rad(latC))

  // Le niveau voulu, puis un plafond de tuiles.
  //
  // ⚠️ Sans ce plafond, le coût réseau dépend de la LATITUDE. La résolution d'un niveau
  // vaut 156543 x cos(lat) / 2^z : deux lieux peuvent tomber de part et d'autre du seuil
  // d'arrondi et différer d'un cran, or un cran = quatre fois plus de tuiles.
  // Mesuré le 29/07 sur la même vue de 2 km : Rennes (48,1° N) 292 requêtes en niveau 15,
  // le viaduc de Millau (44,1° N) 1294 requêtes en niveau 16 - pour une différence de
  // netteté invisible sur un canvas de 736 px. Le sud payait 4,4 fois plus cher.
  //
  // On descend donc d'un cran tant que la mosaïque dépasse MAX_TUILES. Le coût est borné
  // quelle que soit la latitude, et l'image reste nette : le tampon fait deux fois la vue
  // affichée, et needsRefetch recharge avant que le zoom ne rende l'étirement visible.
  let z = niveauPour(latC, widthM, pxW, couche)
  let hg, bd, col0, col1, row0, row1, cols, rows
  for (;;) {
    hg = enTuiles(lat2, lon1, z)   // haut-gauche : latitude haute, longitude basse
    bd = enTuiles(lat1, lon2, z)
    col0 = Math.floor(hg.x); col1 = Math.floor(bd.x)
    row0 = Math.floor(hg.y); row1 = Math.floor(bd.y)
    cols = col1 - col0 + 1
    rows = row1 - row0 + 1
    if (cols * rows <= MAX_TUILES || z <= couche.zmin) break
    z--
  }

  // Sonde : une seule tuile, au centre, AU NIVEAU REELLEMENT AFFICHE. La plupart des
  // millesimes ne couvrent pas un point donne ; sans cette sonde on telechargeait
  // deux douzaines de tuiles par couche pour n'obtenir que des 404 - 168 requetes
  // perdues sur 441 a Rennes.
  // ⚠️ Le niveau compte : sonder plus bas ferait repondre 200 des qu'un bout du
  // voisinage est couvert (une tuile de niveau 13 couvre 3,3 km), et le millesime
  // s'afficherait vide.
  const centreCol = Math.floor((col0 + col1) / 2)
  const centreRow = Math.floor((row0 + row1) / 2)
  const centre = await tuile(couche, z, centreCol, centreRow, signal)
  if (!centre) return null

  const grille = new OffscreenCanvas(cols * TUILE, rows * TUILE)
  const ctx = grille.getContext('2d')

  const morceaux = []
  for (let c = col0; c <= col1; c++) for (let r = row0; r <= row1; r++) morceaux.push([c, r])

  const octets = []
  let posees = 0
  await Promise.all(morceaux.map(async ([c, r]) => {
    // La sonde centrale fait partie de la mosaïque : réutiliser sa réponse garde le
    // plafond réel à MAX_TUILES au lieu de télécharger cette tuile une seconde fois.
    const blob = c === centreCol && r === centreRow
      ? centre
      : await tuile(couche, z, c, r, signal)
    if (!blob) return
    const buf = await blob.arrayBuffer()
    const bmp = await createImageBitmap(new Blob([buf], { type: couche.format }))
    ctx.drawImage(bmp, (c - col0) * TUILE, (r - row0) * TUILE)
    bmp.close?.()
    octets.push(buf.byteLength)
    posees++
  }))
  if (!posees) return null

  // Recadrage : la grille déborde de l'emprise d'une fraction de tuile de chaque côté.
  const sx = (hg.x - col0) * TUILE
  const sy = (hg.y - row0) * TUILE
  const sw = (bd.x - hg.x) * TUILE
  const sh = (bd.y - hg.y) * TUILE
  const bitmap = await createImageBitmap(grille, sx, sy, Math.max(1, sw), Math.max(1, sh), {
    resizeWidth: pxW, resizeHeight: pxH, resizeQuality: 'high',
  })

  // Empreinte pour écarter deux millésimes rigoureusement identiques (l'IGN republie
  // parfois la même campagne sous deux noms). Le poids des tuiles suffit à les
  // distinguer sans relire les pixels - mais l'identifiant de couche NE doit PAS y
  // entrer, sinon deux couches ne se ressemblent jamais et la déduplication ne sert
  // plus à rien.
  const cle = `${z}|${octets.sort((a, b) => a - b).join(',')}`
  const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cle)))
  return { label: couche.label, nature: couche.nature, bitmap, hash, tuiles: posees, z }
}

// Charge tous les millésimes. `onEpoch` reçoit chaque vue dès son arrivée, déduplication
// faite : c'est ce qui permet d'afficher quelque chose au bout d'une seconde au lieu
// d'attendre les 19 couches.
//
// buffer = { lat, lon, widthM, viewWidthM, aspect, pxW, pxH } : l'emprise réellement
// téléchargée, plus large que ce qui sera affiché, pour que zoom et déplacement
// restent hors réseau.
export function closeEpochs(epochs, keep = []) {
  const gardes = new Set(keep.map((epoch) => epoch?.bitmap).filter(Boolean))
  const fermes = new Set()
  for (const epoch of epochs ?? []) {
    const bitmap = epoch?.bitmap
    if (!bitmap || gardes.has(bitmap) || fermes.has(bitmap)) continue
    bitmap.close?.()
    fermes.add(bitmap)
  }
}

export async function loadAllEpochs(buffer, onProgress, onEpoch, signal) {
  const { lat, lon, widthM, viewWidthM, aspect, pxW, pxH } = buffer
  const bbox = bboxAround(lat, lon, widthM, aspect)

  const lisibles = HISTORIC.filter((c) => viewWidthM >= c.minWidthM)
  const tropSerrees = HISTORIC.filter((c) => viewWidthM < c.minWidthM)
    .map((c) => ({ label: c.label, minWidthM: c.minWidthM }))

  const todo = [...lisibles, ...LAYERS]
  const seen = new Set()
  const acquis = []
  const transmis = []
  let done = 0
  let trouvees = 0
  try {
    const results = await Promise.all(
      todo.map(async (couche) => {
        let trouve = null
        try {
          const epoch = await loadEpoch(couche, bbox, pxW, pxH, signal)
          if (signal?.aborted) {
            epoch?.bitmap.close?.()
            signal.throwIfAborted()
          }
          if (epoch && seen.has(epoch.hash)) { epoch.bitmap.close?.(); return null }
          if (epoch) {
            seen.add(epoch.hash)
            trouvees++
            trouve = couche.label
            const complet = { ...epoch, year: couche.annee }
            acquis.push(complet)
            if (onEpoch) {
              transmis.push(complet)
              onEpoch(complet)
            }
            return complet
          }
          return null
        } catch (error) {
          if (error?.name === 'AbortError') throw error
          // Échouer visible plutôt que faire disparaître une décennie en silence.
          return { year: couche.annee, label: couche.label, error: true }
        } finally {
          // `done` = couches interrogées (l'avancement), `trouvees` = vues réellement
          // récupérées. Les confondre afficherait un compte faux : la plupart des
          // millésimes ne couvrent pas un point donné.
          onProgress?.(++done, todo.length, trouvees, trouve)
        }
      }),
    )

    const epochs = []
    const failed = []
    for (const r of results.filter(Boolean).sort((a, b) => a.year - b.year)) {
      if (r.error) { failed.push(r.label); continue }
      epochs.push(r)
    }
    return { epochs, failed, tropSerrees }
  } catch (error) {
    // Les vues déjà remises à l'interface lui appartiennent ; les autres seraient
    // orphelines si une nouvelle recherche interrompait celle-ci.
    closeEpochs(acquis, transmis)
    throw error
  }
}
