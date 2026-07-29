# Prompt de revue externe — Remonter le temps

> À copier-coller dans Codex (ChatGPT) ou dans l'IDE Antigravity. Deux variantes plus bas :
> l'une pour une relecture de code sans exécution, l'autre pour un IDE qui peut lancer le projet.
> Écrit le 2026-07-29, après une journée de corrections. Le but est un **regard neuf** :
> le prompt donne assez de contexte pour être utile, et liste les faux positifs déjà écartés
> pour ne pas se les faire resservir.

---

## Variante A — Codex / ChatGPT (relecture de code, sans exécution)

Tu es un ingénieur senior chargé d'une relecture critique avant une mise en avant publique.
Le site va être partagé sur LinkedIn dans deux jours ; un défaut visible coûterait cher en
crédibilité. Sois direct, et ne signale que ce que tu peux étayer.

### Le produit

**Remonter le temps** affiche un lieu de France à travers le temps. On tape une adresse, le
site va chercher toutes les photos aériennes de l'IGN disponibles pour ce point et les
enchaîne en fondu ; en dézoomant, la carte d'état-major (~1840) puis celle de Cassini (~1760)
apparaissent. On peut en exporter une vidéo MP4.

- **100 % navigateur, aucun backend.** React 18 + Vite 6 + Tailwind v4, déployé sur Vercel.
- Le navigateur du visiteur interroge directement deux API publiques : `data.geopf.fr`
  (IGN, tuiles **WMTS**) et `api-adresse.data.gouv.fr` (Base Adresse Nationale).
- Aucun compte, aucun cookie, aucun stockage, aucun script tiers. C'est une **promesse
  affichée en pied de page** : si tu vois quoi que ce soit qui la rende fausse, c'est bloquant.
- Le contexte d'usage réel est un téléphone, dans la rue. Le mobile est le cas nominal.

### Les fichiers qui comptent

| Fichier | Rôle |
|---|---|
| `src/lib/ign.js` | Accès WMTS : table des couches, choix du niveau de zoom, assemblage des tuiles en mosaïque, déduplication |
| `src/lib/view.js` | Maths de la vue : emprise, tampon, recadrage, seuils de rechargement, formatage |
| `src/Player.jsx` | Canvas, animation en fondu, gestes (glisser/zoom/pincement), export vidéo `MediaRecorder` |
| `src/App.jsx` | Formulaire d'adresse, géocodage, orchestration du chargement, pied de page |
| `PRODUCT.md` | Le cadre produit : utilisateurs, principes, anti-références. **Lis-le d'abord.** |

### Ce qui a changé aujourd'hui (5 commits) — relis ces zones en priorité

1. **Portage du WMS vers le WMTS** (`ign.js` entièrement réécrit). Le WMS répondait
   `LayerNotDefined` de façon erratique sur des couches pourtant présentes à son
   GetCapabilities ; un lieu affichait 1 millésime sur 12.
2. **Plafond de 40 tuiles par millésime** dans `loadEpoch`. Sans lui, le coût réseau dépendait
   de la latitude : `resolution = 156543 × cos(lat) / 2^z`, donc deux villes peuvent tomber de
   part et d'autre du seuil d'arrondi et différer d'un cran — soit quatre fois plus de tuiles.
   Mesuré : Rennes 292 requêtes, Millau 1294 pour la même vue de 2 km.
3. **`canvasWidthFor` dans `view.js`** : la définition du canvas suit désormais le viewport.
   Elle était figée à 1200 px et dupliquée dans deux fichiers, ce qui faisait boucler
   `needsRefetch` à l'infini sur téléphone (51 724 requêtes mesurées).
4. **Champ d'adresse converti en combobox ARIA** (`App.jsx`) : flèches, Échap, Entrée,
   `aria-activedescendant`.
5. **Code couleur par nature de document** : champ `nature` sur chaque couche
   (`carte` / `argentique` / `couleur`), porté par la frise, la réglette et une légende.
6. **Année incrustée dans le canvas pendant l'enregistrement vidéo** (`Player.jsx`), parce
   que `MediaRecorder` capture le canvas et ne voit pas le HTML posé par-dessus.

### Ce que je te demande de chercher

Par ordre d'importance :

1. **Des bugs de correction réels** dans les zones ci-dessus — en particulier les maths de
   `view.js` et `ign.js` (conversions Web Mercator, recadrage de mosaïque, condition de
   rechargement). Une erreur de signe ou d'arrondi y est plausible et invisible à l'œil.
2. **Des fuites de la promesse de confidentialité** : tout ce qui écrirait un cookie, un
   `localStorage`, ou contacterait un domaine autre que l'origine, `data.geopf.fr` et
   `api-adresse.data.gouv.fr`.
3. **Des états morts ou trompeurs** : un bouton qui ne fait rien, un état de chargement qui
   ne se termine pas, un message qui ment sur ce qui s'est passé.
4. **Des fuites de mémoire** : les `ImageBitmap` doivent être libérés (`.close()`), les
   `requestAnimationFrame` annulés, les écouteurs retirés. L'app charge des dizaines
   d'images par lieu et l'utilisateur enchaîne les lieux.
5. **De la complexité inutile** : ce projet suit une règle de simplicité stricte. Si tu vois
   du code qui traite un cas qui ne peut pas arriver, dis-le.

### Faux positifs déjà écartés — ne me les resserre pas

- **Les `404` du WMTS sont normaux** (7 à 10 par chargement) : c'est le service qui dit
  proprement « ce millésime ne couvre pas ce point ». Ce n'est pas une erreur à corriger.
- **Retenter un `LayerNotDefined` était inutile** : mesuré, 0 couche récupérée sur 114
  requêtes avec 5 tentatives. Le sujet est clos, on n'utilise plus le WMS du tout.
- **Le nombre de millésimes varie de 8 à 12 selon le lieu.** L'IGN survole la France par
  rotation. Ce n'est pas un défaut.
- **Aucune balise `<img>` dans la page** : tout est dessiné dans un `<canvas>`. Les contrôles
  habituels sur les `alt` sont sans objet ; c'est l'`aria-label` du canvas qui porte.
- **`Math.round(view.widthM) === w` ne sélectionne aucun bouton après un zoom libre** : c'est
  voulu, un libellé affiche la largeur courante à côté.

### Contraintes à respecter dans tes propositions

- **Pas de dépendance nouvelle** sans justification forte : le bundle fait 58 ko gzippé et
  le site ne charge aucun script tiers.
- **WCAG AA** : contraste ≥ 4.5:1, cibles tactiles ≥ 44 px, `prefers-reduced-motion` respecté.
- **`PRODUCT.md` fait autorité** sur les choix de design. Son principe n°1 est « l'image est
  le produit, le reste de l'interface recule ».

Rends-moi une liste courte et priorisée. Pour chaque point : le fichier et la ligne, ce qui
casse concrètement, et le correctif que tu proposes. Si tu ne trouves rien de sérieux sur un
axe, dis-le plutôt que de meubler.

---

## Variante B — Antigravity (ou tout IDE capable de lancer le projet)

Reprends tout le contexte de la variante A, puis ajoute ceci.

### Tu peux exécuter — sers-t'en

```bash
cd ~/ign-timelapse-web
npm install
npm run build
npm run preview -- --port 4173      # puis http://localhost:4173
```

Le site interroge des API publiques sans clé : il fonctionne en local sans configuration.

### Scénarios à jouer réellement

Teste sur **390 × 844** (le cas nominal) autant que sur un écran large.

1. **Charger un lieu et compter les millésimes.** Valeurs de référence mesurées le 29/07 en
   production, tout écart est une régression :
   - `?lat=48.1173&lon=-1.6778&w=2000` (Rennes) → **12**
   - `?lat=44.0794&lon=3.0225&w=2000` (viaduc de Millau) → **11**
   - `?lat=44.56605&lon=0.73237&w=300` → **8**
2. **Compter les requêtes vers `data.geopf.fr`** sur ces trois lieux. Attendu : 220 à 300.
   Si un lieu en demande quatre fois plus qu'un autre, le plafond de tuiles a une faille.
3. **Glisser l'image.** Un petit glissé ne doit produire **aucune** requête (tampon), un grand
   une **seule** salve, puis plus rien. Une salve qui se répète est un bug bloquant.
4. **Faire tourner l'écran** et vérifier que la vue se recharge proprement.
5. **Refuser la géolocalisation** et vérifier que le site reste utilisable avec un message
   clair. ⚠️ Si tu simules l'erreur, fabrique un `GeolocationPositionError` **complet** : le
   code compare `err.code === err.PERMISSION_DENIED`, et un objet factice sans cette propriété
   produit un faux négatif (je m'y suis laissé prendre).
6. **Exporter une vidéo**, puis **extraire une image du fichier produit** et vérifier que
   l'année y figure. Vérifier que le fichier existe ne suffit pas — c'est exactement le
   défaut que j'ai laissé passer aujourd'hui.
7. **Naviguer au clavier** dans le champ d'adresse : flèches, Échap, Entrée.

### Pièges de test rencontrés — tu gagneras du temps

- **Sélecteurs ambigus** : il existe deux boutons « Utiliser ma position » (l'icône et le
  libellé). Un clic sur un sélecteur ambigu échoue **en silence** en strict mode Playwright,
  et fait conclure à tort que la fonctionnalité est cassée. Désambiguïse avec `.first()`.
- **Une capture du canvas prise pendant un fondu** paraît incomplète. C'est l'animation saisie
  en cours de transition, pas un défaut de rendu. Mesure les pixels peints plutôt que juger à
  l'œil sur une capture.
- **L'IGN met ses tuiles en cache 21 jours.** Rejouer les mêmes URLs mesure le cache, pas le
  service : utilise un lieu différent par configuration testée, et un profil navigateur neuf
  pour toute mesure de poids.
- **Une mesure de couverture n'est valide qu'au niveau de zoom réellement affiché.** Sonder
  plus grossièrement mesure le voisinage : une tuile de niveau 13 couvre 3,3 km.

Rends le même livrable que la variante A, en citant les mesures que tu as réellement obtenues.
