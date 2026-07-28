// Base Adresse Nationale (gratuite, sans clé, CORS ouvert).
// Mesure du 28/07 : aller-retour a 16 m sur une adresse rurale avec numéro.
// En revanche un lieu-dit sans numéro retombe sur le centre de la commune, voire
// sur une autre commune -> d'ou le collage de coordonnées en filet de sécurité.

const BAN = 'https://api-adresse.data.gouv.fr'

export async function suggest(query) {
  if (query.trim().length < 3) return []
  const q = new URLSearchParams({ q: query, limit: '5', autocomplete: '1' })
  const r = await fetch(`${BAN}/search/?${q}`)
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

// "44.56605, 0.73237" colle depuis Google Maps (clic droit > copier les coordonnées).
export function parseCoords(text) {
  const m = text.trim().match(/^(-?\d{1,3}[.,]\d+)[,;\s]+(-?\d{1,3}[.,]\d+)$/)
  if (!m) return null
  const lat = parseFloat(m[1].replace(',', '.'))
  const lon = parseFloat(m[2].replace(',', '.'))
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

// Un lieu-dit ou une commune renvoient un point approximatif : on le dit a l'utilisateur
// au lieu de laisser croire qu'on a trouve sa maison.
export function isApproximate(place) {
  return place.type === 'municipality' || place.type === 'locality' || place.score < 0.6
}
