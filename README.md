# Remonter le temps

Un lieu en France, vu du ciel, des annees 1950 a aujourd'hui. On tape une adresse,
le navigateur va chercher tous les millesimes d'orthophotos IGN qui couvrent le point
et les joue en fondu enchaine.

## Pourquoi il n'y a pas de serveur

`data.geopf.fr` repond avec `access-control-allow-origin: *`, donc le navigateur peut
interroger l'IGN directement. Tout se passe cote client : pas d'API, pas de file
d'attente, pas de base, pas de cout d'hebergement, et chaque visiteur consomme son
propre quota depuis sa propre connexion.

Mesures du 28/07/2026 :

- script Python local, sequentiel, avec la couche satellite : **657 s** pour un lieu
- les memes requetes IGN en parallele : **4,2 s**, environ 1,3 Mo transferes

## Ce qui differe du script local

Le script `ign_gps_timelapse.py` ajoute une couche satellite via Esri Wayback
(imagerie Maxar). Elle n'est **pas** reprise ici : elle n'est pas librement
redistribuable. Le site est donc 100 % IGN, sous Licence Ouverte Etalab 2.0,
avec mention de la source.

Les trois filtres du script sont portes tels quels : dalle vide au poids
(< 12 ko), dalle blanche no-data (> 90 % de pixels quasi-blancs, testee sur
canvas), doublon par hash SHA-256 du fichier.

## Fiabilite du point

La Base Adresse Nationale fait un aller-retour a **16 m** sur une adresse rurale
avec numero (mesure sur une parcelle du Lot-et-Garonne). En revanche un lieu-dit
sans numero retombe sur le centre de la commune, parfois sur une autre commune.
D'ou, dans cet ordre : adresse postale, geolocalisation du navigateur, et collage
de coordonnees Google Maps en filet de securite.

## Developpement

```bash
npm install
npm run dev
```

## Reste a faire

- Ajustement visuel du cadre a la souris avant de lancer (le vrai filet de securite
  pour les lieux-dits)
- Export MP4 plutot que WebM (ffmpeg.wasm, environ 3 Mo de plus a charger)
- Galerie publique des lieux, en opt-in explicite et arrondie a la commune
  (question de vie privee : les gens cherchent leur maison)
