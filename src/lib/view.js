// Conversion geographie <-> pixels pour la navigation libre.
//
// Principe : on telecharge un tampon plus large et plus fin que ce qu'on affiche,
// puis on recadre dedans. Tant que le geste reste dans le tampon, aucune requête
// réseau - juste un drawImage avec un rectangle source.
//
// vue    = { lat, lon, widthM }        la fenêtre affichée
// tampon = vue + { aspect, pxW, pxH }  ce qui a réellement été telecharge
//
// Le format n'est PAS une contrainte de la donnée : l'IGN rend n'importe quelle
// emprise. C'est un choix de mise en page. Sur téléphone tenu droit, une image en
// 3:2 occupe un quart de l'écran alors qu'elle EST le produit - d'ou un cadrage
// portrait en 4:5, qui est aussi le format qui passe le mieux en story.

const M_PER_DEG = 111320
const BUFFER_RATIO = 2      // le tampon couvre 2x la largeur affichee
const MAX_UPSCALE = 1.5     // au-dela, on regrossit trop le flou -> rechargement

export const MIN_WIDTH_M = 60
export const MAX_WIDTH_M = 8000   // assez large pour que Cassini (1:86400) soit lisible

export const clampWidth = (m) => Math.min(MAX_WIDTH_M, Math.max(MIN_WIDTH_M, m))

// Le zoom libre (molette, pincement) produit des largeurs quelconques : 437 m, 1 240 m.
// On les affiche arrondies, en mètres sous le kilomètre et en kilomètres au-dessus,
// avec la virgule décimale française.
//
// Cette fonction vit ici parce que DEUX endroits l'utilisent : le libellé du choix de
// largeur dans le formulaire, et l'échelle affichée sur l'image. Les laisser diverger
// donnerait « 2 km » d'un côté et « 2000 m » de l'autre pour la même vue.
export function formatLargeur(m) {
  if (m >= 1000) {
    const km = m / 1000
    return `${(km >= 10 ? Math.round(km) : Math.round(km * 10) / 10).toString().replace('.', ',')} km`
  }
  return `${Math.round(m)} m`
}

const mPerDegLon = (lat) => M_PER_DEG * Math.cos((lat * Math.PI) / 180)

// hauteur / largeur de la fenêtre affichée
export function aspectFor(viewportWidth) {
  return viewportWidth < 640 ? 1.25 : 2 / 3
}

// Définition interne du canvas. Elle était figée à 1200 px, dupliquée dans App et
// Player - et sur téléphone cela bouclait : le tampon mobile (1400 px de large, dont
// la moitie couvre la vue) ne fournit que 700 px, or needsRefetch exige
// 700 x 1.5 >= 1200. La condition restait vraie apres chaque rechargement, donc on
// rechargeait sans fin. Invisible en WMS (19 requêtes par tour), ruineux en WMTS.
// Le canvas est affiche 358 px sur telephone et 736 px sur bureau (mesure au navigateur) :
// 700 px suffisent largement sur petit ecran, ecran Retina compris.
export function canvasWidthFor(viewportWidth) {
  return viewportWidth < 640 ? 700 : 1200
}

// data.geopf.fr accepte jusqu'a 5000 px de côté (sonde le 28/07), on reste très en
// dessous. Sur petit écran on descend en définition : autant d'octets en moins sur
// un forfait mobile, pour un rendu identique a l'oeil.
export function bufferFor(view, viewportWidth) {
  const aspect = aspectFor(viewportWidth)
  const pxW = viewportWidth < 640 ? 1400 : 2400
  return {
    lat: view.lat,
    lon: view.lon,
    widthM: view.widthM * BUFFER_RATIO,
    viewWidthM: view.widthM,
    aspect,
    pxW,
    pxH: Math.round(pxW * aspect),
    canvasW: canvasWidthFor(viewportWidth),
  }
}

// Rectangle de l'image tampon a decouper pour afficher la vue courante.
export function sourceRect(view, buffer) {
  const pxPerM = buffer.pxW / buffer.widthM
  const dxM = (view.lon - buffer.lon) * mPerDegLon(buffer.lat)
  const dyM = (view.lat - buffer.lat) * M_PER_DEG
  const sw = view.widthM * pxPerM
  const sh = view.widthM * buffer.aspect * pxPerM
  return {
    sx: buffer.pxW / 2 + dxM * pxPerM - sw / 2,
    sy: buffer.pxH / 2 - dyM * pxPerM - sh / 2,   // le nord monte, les pixels descendent
    sw,
    sh,
  }
}

// Trois raisons de retelecharger : on est sorti du tampon, on a zoome au point de
// reclamer plus de définition qu'il n'en contient, ou l'écran a change de format
// (rotation du téléphone, passage mobile <-> bureau).
export function needsRefetch(view, buffer, canvasW, viewportWidth) {
  if (!buffer) return true
  if (Math.abs(buffer.aspect - aspectFor(viewportWidth)) > 0.01) return true
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
  // Une fois la borne atteinte, le zoom doit être une identité stricte. Recalculer le
  // centre malgré une largeur inchangée accumule sinon une dérive à chaque événement.
  if (widthM === view.widthM) return view
  const mPerPx = widthM / canvasW
  const dxM = (cx - canvasW / 2) * mPerPx
  const dyM = -(cy - canvasH / 2) * mPerPx
  const lat = anchor.lat - dyM / M_PER_DEG
  return {
    widthM,
    lat,
    // La conversion inverse doit employer la latitude du nouveau centre, comme geoAt
    // emploie celle du centre initial. La différence devient visible sur des zooms répétés.
    lon: anchor.lon - dxM / mPerDegLon(lat),
  }
}

// Déplacement : le contenu suit le doigt, donc le centre part en sens inverse.
export function panBy(view, dxPx, dyPx, canvasW) {
  const mPerPx = view.widthM / canvasW
  return {
    ...view,
    lat: view.lat + (dyPx * mPerPx) / M_PER_DEG,
    lon: view.lon - (dxPx * mPerPx) / mPerDegLon(view.lat),
  }
}
