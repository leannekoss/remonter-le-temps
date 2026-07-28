// Accès aux orthophotos IGN (Géoplateforme, WMS sans clé, CORS ouvert).
// Portage navigateur du script local ign_gps_timelapse.py : même liste de couches,
// mêmes filtres (dalle vide au poids, dalle blanche no-data, doublon par hash).
// La couche satellite Esri/Maxar du script n'est PAS reprise : imagerie non
// redistribuable. Ici tout est sous Licence Ouverte Etalab (mention IGN obligatoire).

const WMS = 'https://data.geopf.fr/wms-r/wms'

// (couche, format, année de tri, libelle affiche)
export const LAYERS = [
  ['ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', 'png', 1957, '1950-1965'],
  ['ORTHOIMAGERY.ORTHOPHOTOS.1965-1980', 'png', 1972, '1965-1980'],
  ['ORTHOIMAGERY.ORTHOPHOTOS.1980-1995', 'png', 1987, '1980-1995'],
  ['ORTHOIMAGERY.ORTHOPHOTOS2000-2005', 'jpeg', 2002, '2000-2005'],
  ['ORTHOIMAGERY.ORTHOPHOTOS2006-2010', 'jpeg', 2008, '2006-2010'],
  ['ORTHOIMAGERY.ORTHOPHOTOS2011-2015', 'jpeg', 2013, '2011-2015'],
  ...Array.from({ length: 9 }, (_, i) => [
    `ORTHOIMAGERY.ORTHOPHOTOS${2016 + i}`, 'jpeg', 2016 + i, String(2016 + i),
  ]),
  ['ORTHOIMAGERY.ORTHOPHOTOS.ORTHO-EXPRESS.2025', 'jpeg', 2025, '2025'],
  ['ORTHOIMAGERY.ORTHOPHOTOS.RVB-EXPRESS.2026', 'jpeg', 2026, '2026'],
]

// Avant la photographie aérienne, il reste les cartes - numérisées et calées par l'IGN,
// donc même service, même licence ouverte que les orthophotos.
//
// Elles ont été dessinées a une échelle donnée : les afficher sur 200 m de large ne
// montre que du grain. D'ou minWidthM, la largeur de vue en dessous de laquelle on ne
// les propose pas. Mesure sur la parcelle de référence : l'état-major (1:40000) est
// déjà lisible vers 700 m, Cassini (1:86400) demande environ 2 km.
export const HISTORIC = [
  ['AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI', 'jpeg', 1760, 'vers 1760 - Cassini', 2000],
  ['GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'jpeg', 1840, 'vers 1840 - état-major', 700],
]

// Emprise centrée sur le point. `aspect` = hauteur / largeur : 2/3 en paysage sur
// grand écran, 1.25 en portrait sur téléphone.
// WMS 1.3.0 en EPSG:4326 attend la bbox en lat,lon - pas l'inverse.
export function bboxAround(lat, lon, widthM, aspect = 2 / 3) {
  const heightM = widthM * aspect
  const dLat = heightM / 111320
  const dLon = widthM / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lat - dLat / 2, lon - dLon / 2, lat + dLat / 2, lon + dLon / 2].join(',')
}

function url(layer, fmt, bbox, pxW, pxH) {
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    LAYERS: layer, CRS: 'EPSG:4326', BBOX: bbox,
    WIDTH: pxW, HEIGHT: pxH, FORMAT: `image/${fmt}`, STYLES: '',
  })
  return `${WMS}?${q}`
}

async function get(u, tries = 5) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u)
      if (r.status === 404 || r.status === 403) throw new Error(`HTTP ${r.status}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.blob()
    } catch (e) {
      last = e
      await new Promise((res) => setTimeout(res, 400 * (i + 1)))
    }
  }
  throw last
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function digest(blob) {
  return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
}

// Une dalle "no-data" est blanche mais pèse plus que le seuil de poids : il faut
// la décoder et regarder les pixels. Constaté en reel sur ORTHOPHOTOS2016 en rural.
async function isBlank(bitmap) {
  const w = 80
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w))
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let pale = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] >= 246 && data[i + 1] >= 246 && data[i + 2] >= 246) pale++
  }
  return pale / (w * h) > 0.9
}

// Charge un millésime. Renvoie null quand la couche ne couvre pas le point.
export async function loadEpoch(layer, fmt, label, bbox, pxW, pxH) {
  let blob = await get(url(layer, fmt, bbox, pxW, pxH))
  // Les campagnes historiques sont en 4 bandes : le JPEG échoue en ServiceException XML.
  if (blob.type.includes('xml') || blob.type.includes('text')) {
    blob = await get(url(layer, 'png', bbox, pxW, pxH))
  }
  // Pas de filtre au poids : data.geopf.fr tronque parfois ses réponses sous charge,
  // et une réponse tronquée est légère - elle passerait alors pour une absence de
  // couverture, en silence. On decode toujours : un flux coupé fait échouer le décodage,
  // l'erreur remonte et le millésime est affiche comme indisponible au lieu de
  // disparaître. Constaté en production le 28/07 sur Cassini et l'état-major.
  const bitmap = await createImageBitmap(blob)
  if (await isBlank(bitmap)) { bitmap.close?.(); return null }
  return { label, bitmap, hash: await digest(blob) }
}

// Charge tous les millésimes en parallèle. Le navigateur limite lui-même le nombre
// de connexions simultanées : c'est ce qui fait passer le rendu de plusieurs minutes
// (script séquentiel) a quelques secondes.
//
// buffer = { lat, lon, widthM, pxW, pxH } : l'emprise réellement téléchargée, plus
// large que ce qui sera affiche, pour que zoom et déplacement restent hors réseau.
export async function loadAllEpochs(buffer, onProgress) {
  const { lat, lon, widthM, viewWidthM, aspect, pxW, pxH } = buffer
  const bbox = bboxAround(lat, lon, widthM, aspect)

  const lisibles = HISTORIC.filter(([, , , , minW]) => viewWidthM >= minW)
  const tropSerrees = HISTORIC.filter(([, , , , minW]) => viewWidthM < minW)
    .map(([, , , label, minW]) => ({ label, minWidthM: minW }))

  const todo = [...lisibles, ...LAYERS]
  let done = 0
  let trouvees = 0
  const results = await Promise.all(
    todo.map(async ([layer, fmt, year, label]) => {
      let trouve = null
      try {
        const epoch = await loadEpoch(layer, fmt, label, bbox, pxW, pxH)
        if (epoch) { trouvees++; trouve = label }
        return epoch ? { ...epoch, year } : null
      } catch {
        // Échouer visible plutôt que faire disparaître une décennie en silence.
        return { year, label, error: true }
      } finally {
        // `done` = couches interrogées (l'avancement), `trouvees` = vues réellement
        // récupérées. Les confondre afficherait un compte faux : la plupart des
        // millésimes ne couvrent pas un point donne.
        onProgress?.(++done, todo.length, trouvees, trouve)
      }
    }),
  )

  const seen = new Set()
  const epochs = []
  const failed = []
  for (const r of results.filter(Boolean).sort((a, b) => a.year - b.year)) {
    if (r.error) { failed.push(r.label); continue }
    if (seen.has(r.hash)) { r.bitmap.close?.(); continue }
    seen.add(r.hash)
    epochs.push(r)
  }
  return { epochs, failed, tropSerrees }
}
