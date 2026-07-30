import React from 'react'
import ReactDOM from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import './index.css'

// L'URL porte les coordonnées du lieu regardé (?lat&lon&w). Vercel Analytics envoie
// l'URL complète par défaut : la mesure d'audience emporterait donc la position, à une
// dizaine de mètres près, du domicile que le visiteur vient de chercher. On ne garde
// que le chemin. Même raison que pour le lien de partage, qui n'emporte pas le libellé.
const sansCoordonnees = (event) => {
  const url = new URL(event.url)
  url.search = ''
  return { ...event, url: url.toString() }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Analytics beforeSend={sansCoordonnees} />
  </React.StrictMode>,
)
