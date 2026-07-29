// Base Adresse Nationale (gratuite, sans clé, CORS ouvert).
// Mesure du 28/07 : aller-retour a 16 m sur une adresse rurale avec numéro.
// En revanche un lieu-dit sans numéro retombe sur le centre de la commune, voire
// sur une autre commune -> d'ou le collage de coordonnées en filet de sécurité.

const BAN = 'https://api-adresse.data.gouv.fr'

export async function suggest(query, signal) {
  if (query.trim().length < 3) return []
  const q = new URLSearchParams({ q: query, limit: '5', autocomplete: '1' })
  const r = await fetch(`${BAN}/search/?${q}`, { signal })
  if (!r.ok) throw new Error('Geocodage indisponible')
  const { features } = await r.json()
  return features.map((f) => ({
    label: f.properties.label,
    context: f.properties.context,
    type: f.properties.type,
    score: f.properties.score,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }))
}

export async function reverse(lat, lon) {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) })
  const r = await fetch(`${BAN}/reverse/?${q}`)
  if (!r.ok) return null
  const { features } = await r.json()
  return features[0]?.properties.label ?? null
}

// "44.07940, 3.02250" colle depuis Google Maps (clic droit > copier les coordonnées).
// Exemple pris sur un lieu public - le viaduc de Millau : ce dépôt est public, et des
// coordonnées à cinq décimales désignent une maison au mètre près.
export function parseCoords(text) {
  const m = text.trim().match(/^(-?\d{1,3}[.,]\d+)[,;\s]+(-?\d{1,3}[.,]\d+)$/)
  if (!m) return null
  const lat = parseFloat(m[1].replace(',', '.'))
  const lon = parseFloat(m[2].replace(',', '.'))
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

// Un lieu-dit ou une commune renvoient un point approximatif : on le dit à l'utilisateur
// au lieu de laisser croire qu'on a trouvé sa maison.
export function isApproximate(place) {
  return place.type === 'municipality' || place.type === 'locality' || place.score < 0.6
}

// Le cadrage doit suivre la précision du résultat. Taper « Hanvec 29 » renvoie le centre
// de la commune : l'afficher sur 300 m ne montre que quelques toits anonymes, et le site
// paraît cassé. Retour d'un premier testeur le 28/07, sur trois communes d'affilée.
export function widthForType(type) {
  if (type === 'municipality') return 2000   // on veut voir le bourg entier
  if (type === 'locality') return 800        // hameau, lieu-dit
  if (type === 'street') return 500          // la rue et ce qui l'entoure
  return 300                                 // une adresse avec numéro : la parcelle
}
