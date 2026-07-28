// Acces aux orthophotos IGN (Geoplateforme, WMS sans cle, CORS ouvert).
// Portage navigateur du script local ign_gps_timelapse.py : meme liste de couches,
// memes filtres (dalle vide au poids, dalle blanche no-data, doublon par hash).
// La couche satellite Esri/Maxar du script n'est PAS reprise : imagerie non
// redistribuable. Ici tout est sous Licence Ouverte Etalab (mention IGN obligatoire).

const WMS = 'https://data.geopf.fr/wms-r/wms'

// (couche, format, annee de tri, libelle affiche)
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

// Emprise centree sur le point. Hauteur = 2/3 de la largeur (format paysage).
// WMS 1.3.0 en EPSG:4326 attend la bbox en lat,lon - pas l'inverse.
export function bboxAround(lat, lon, widthM) {
  const heightM = (widthM * 2) / 3
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

async function get(u, tries = 3) {
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

// Une dalle "no-data" est blanche mais pese plus que le seuil de poids : il faut
// la decoder et regarder les pixels. Constate en reel sur ORTHOPHOTOS2016 en rural.
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

// Charge un millesime. Renvoie null quand la couche ne couvre pas le point.
export async function loadEpoch(layer, fmt, label, bbox, pxW, pxH) {
  let blob = await get(url(layer, fmt, bbox, pxW, pxH))
  // Les campagnes historiques sont en 4 bandes : le JPEG echoue en ServiceException XML.
  if (blob.type.includes('xml') || blob.type.includes('text')) {
    blob = await get(url(layer, 'png', bbox, pxW, pxH))
  }
  if (blob.size < 12000) return null
  const bitmap = await createImageBitmap(blob)
  if (await isBlank(bitmap)) { bitmap.close?.(); return null }
  return { label, bitmap, hash: await digest(blob) }
}

// Charge tous les millesimes en parallele. Le navigateur limite lui-meme le nombre
// de connexions simultanees : c'est ce qui fait passer le rendu de plusieurs minutes
// (script sequentiel) a quelques secondes.
export async function loadAllEpochs(lat, lon, widthM, onProgress) {
  const bbox = bboxAround(lat, lon, widthM)
  const pxW = 1200
  const pxH = Math.round((pxW * 2) / 3)
  let done = 0
  const results = await Promise.all(
    LAYERS.map(async ([layer, fmt, year, label]) => {
      try {
        const epoch = await loadEpoch(layer, fmt, label, bbox, pxW, pxH)
        return epoch ? { ...epoch, year } : null
      } catch {
        // Echouer visible plutot que faire disparaitre une decennie en silence.
        return { year, label, error: true }
      } finally {
        onProgress?.(++done, LAYERS.length)
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
  return { epochs, failed }
}
