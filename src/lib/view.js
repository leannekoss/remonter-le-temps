// Conversion geographie <-> pixels pour la navigation libre.
//
// Principe : on telecharge un tampon plus large et plus fin que ce qu'on affiche,
// puis on recadre dedans. Tant que le geste reste dans le tampon, aucune requete
// reseau - juste un drawImage avec un rectangle source.
//
// vue    = { lat, lon, widthM }   la fenetre affichee (hauteur = 2/3 de la largeur)
// tampon = vue + { pxW, pxH }     ce qui a reellement ete telecharge

const M_PER_DEG = 111320
const BUFFER_RATIO = 2      // le tampon couvre 2x la largeur affichee
const MAX_UPSCALE = 1.5     // au-dela, on regrossit trop le flou -> rechargement

export const MIN_WIDTH_M = 60
export const MAX_WIDTH_M = 8000   // assez large pour que Cassini (1:86400) soit lisible

export const clampWidth = (m) => Math.min(MAX_WIDTH_M, Math.max(MIN_WIDTH_M, m))

const mPerDegLon = (lat) => M_PER_DEG * Math.cos((lat * Math.PI) / 180)

// data.geopf.fr accepte jusqu'a 5000 px de cote (sonde le 28/07), on reste tres en dessous.
// Sur petit ecran on descend a 1800 px : 4x moins d'octets pour un rendu identique.
export function bufferFor(view) {
  const pxW = typeof window !== 'undefined' && window.innerWidth < 700 ? 1800 : 2400
  return {
    lat: view.lat,
    lon: view.lon,
    widthM: view.widthM * BUFFER_RATIO,
    viewWidthM: view.widthM,   // sert a decider quelles cartes anciennes sont lisibles
    pxW,
    pxH: Math.round((pxW * 2) / 3),
  }
}

// Rectangle de l'image tampon a decouper pour afficher la vue courante.
export function sourceRect(view, buffer) {
  const pxPerM = buffer.pxW / buffer.widthM
  const dxM = (view.lon - buffer.lon) * mPerDegLon(buffer.lat)
  const dyM = (view.lat - buffer.lat) * M_PER_DEG
  const sw = view.widthM * pxPerM
  const sh = ((view.widthM * 2) / 3) * pxPerM
  return {
    sx: buffer.pxW / 2 + dxM * pxPerM - sw / 2,
    sy: buffer.pxH / 2 - dyM * pxPerM - sh / 2,   // le nord monte, les pixels descendent
    sw,
    sh,
  }
}

// Deux raisons de retelecharger : on est sorti du tampon, ou on a zoome au point
// de reclamer plus de definition qu'il n'en contient.
export function needsRefetch(view, buffer, canvasW) {
  if (!buffer) return true
  const { sx, sy, sw, sh } = sourceRect(view, buffer)
  if (sx < 0 || sy < 0 || sx + sw > buffer.pxW || sy + sh > buffer.pxH) return true
  return sw * MAX_UPSCALE < canvasW
}

// Point geographique sous un pixel donne du canvas.
export function geoAt(view, canvasW, canvasH, cx, cy) {
  const mPerPx = view.widthM / canvasW
  const dxM = (cx - canvasW / 2) * mPerPx
  const dyM = -(cy - canvasH / 2) * mPerPx
  return {
    lat: view.lat + dyM / M_PER_DEG,
    lon: view.lon + dxM / mPerDegLon(view.lat),
  }
}

// Zoom en gardant fixe le point sous le curseur.
export function zoomAt(view, factor, canvasW, canvasH, cx, cy) {
  const anchor = geoAt(view, canvasW, canvasH, cx, cy)
  const widthM = clampWidth(view.widthM * factor)
  const mPerPx = widthM / canvasW
  const dxM = (cx - canvasW / 2) * mPerPx
  const dyM = -(cy - canvasH / 2) * mPerPx
  return {
    widthM,
    lat: anchor.lat - dyM / M_PER_DEG,
    lon: anchor.lon - dxM / mPerDegLon(anchor.lat),
  }
}

// Deplacement : le contenu suit le doigt, donc le centre part en sens inverse.
export function panBy(view, dxPx, dyPx, canvasW) {
  const mPerPx = view.widthM / canvasW
  return {
    ...view,
    lat: view.lat + (dyPx * mPerPx) / M_PER_DEG,
    lon: view.lon - (dxPx * mPerPx) / mPerDegLon(view.lat),
  }
}
