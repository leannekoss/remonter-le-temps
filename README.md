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

## Avant la photo aerienne : les cartes

L'IGN a numerise et cale la **carte de Cassini** (vers 1760, avec les Archives nationales)
et la **carte d'etat-major** (vers 1840). Memes serveur, meme licence ouverte que les
orthophotos - contrairement a l'imagerie satellite, elles sont librement rediffusables.

Elles ne sont proposees qu'au-dela d'une certaine largeur de vue, parce qu'elles ont ete
dessinees a une echelle donnee : l'etat-major (1:40000) devient lisible vers 700 m,
Cassini (1:86400) vers 2 km. En dessous, on ne verrait que le grain du papier. Quand la
vue est trop serree, le site le dit et invite a dezoomer.

Sur la parcelle de reference : 8 epoques a 300 m de large, **10 a 2 km** - la frise part
alors de 1760.

Piege verifie : le filtre "dalle blanche" aurait pu rejeter des cartes dessinees,
majoritairement claires. Mesure faite - le papier ancien tombe a 0 % de pixels
quasi-blancs, contre 100 % pour une vraie dalle vide. Aucun faux rejet.

## Ce qui differe du script local

Le script `ign_gps_timelapse.py` ajoute une couche satellite via Esri Wayback
(imagerie Maxar). Elle n'est **pas** reprise ici : elle n'est pas librement
redistribuable. Le site est donc 100 % IGN, sous Licence Ouverte Etalab 2.0,
avec mention de la source.

Deux des trois filtres du script sont portes tels quels : dalle blanche no-data
(> 90 % de pixels quasi-blancs, testee sur canvas) et doublon par hash SHA-256.

Le troisieme, le filtre au poids (< 12 ko = pas de couverture), a ete **retire
volontairement**. `data.geopf.fr` tronque parfois ses reponses sous charge, et une
reponse tronquee est legere : elle passait donc pour une absence de couverture, en
silence. Constate en production le 28/07 - Cassini et l'etat-major disparaissaient
sans le moindre message, puis reapparaissaient au rechargement suivant. On decode
desormais toujours l'image : un flux coupe fait echouer le decodage, et le millesime
s'affiche comme indisponible au lieu de s'evaporer.

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

## Navigation libre

On telecharge un tampon deux fois plus large que la vue affichee, a 2400 px (1800 sur
petit ecran), puis on recadre dedans avec un `drawImage` a rectangle source. Tant que le
geste reste dans le tampon, **aucune requete reseau**. Un rechargement ne part que si la
vue sort du tampon ou reclame plus de 1,5 fois sa definition, et seulement 400 ms apres
la fin du geste.

Mesure au navigateur : molette et glisse dans le tampon = **0 requete** ; sortie du
tampon = **17 requetes**, une seule salve, sans boucle.

C'est aussi ce qui rattrape les lieux-dits mal geocodes : l'utilisateur deplace la vue
jusqu'a sa maison, ce qu'aucun geocodeur ne sait faire.

## Reste a faire

- Export MP4 plutot que WebM (ffmpeg.wasm, environ 3 Mo de plus a charger)
- Galerie publique des lieux, en opt-in explicite et arrondie a la commune
  (question de vie privee : les gens cherchent leur maison)
