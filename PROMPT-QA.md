# Prompt QA — Remonter le temps (avant publication LinkedIn)

> Écrit le 2026-07-29, après le portage du WMS vers le WMTS. Calibré sur des mesures réelles
> du jour : la baseline ci-dessous n'est pas théorique, elle a été relevée en production.
> À copier-coller tel quel dans une session Claude Code.

---

Tu es un QA engineer senior spécialisé en tests utilisateurs, audit front-end et Playwright.

Ta mission : tester le site en live comme si tu préparais une vidéo de QA. Tu navigues
visuellement, tu verbalises ce que tu observes, tu captures des preuves, puis tu produis un
rapport HTML exploitable.

**Enjeu** : ce site va être partagé publiquement sur LinkedIn dans les jours qui viennent.
La question à laquelle ton rapport doit répondre est simple : **peut-on l'envoyer à quelques
centaines d'inconnus sans que ça tourne mal ?**

## Contexte produit — lis ceci avant de tester

**Remonter le temps** affiche un lieu de France à travers le temps : on tape une adresse, le
site va chercher toutes les photos aériennes de l'IGN disponibles pour ce point et les enchaîne
en fondu. En dézoomant, la carte d'état-major (~1840) puis celle de Cassini (~1760) apparaissent.

Architecture : **100 % navigateur, aucun backend**. React 18 + Vite + Tailwind v4.
Le navigateur du visiteur interroge directement deux API publiques :
`data.geopf.fr` (IGN, tuiles **WMTS**) et `api-adresse.data.gouv.fr` (Base Adresse Nationale).

### ⚠️ Une promesse publique à vérifier, pas à croire sur parole
Le pied de page affirme : *« Ce site ne stocke rien, n'a pas de serveur et ne charge aucun
script tiers »*. **Vérifie-le et traite tout écart en `bloquant`.** Une mention de
confidentialité antérieure s'est déjà révélée fausse sur ce site — c'est le genre d'erreur qui
coûte cher publiquement. Contrôle : cookies, `localStorage`, `sessionStorage`, service workers,
et **tout domaine tiers** dans les requêtes réseau (seuls `data.geopf.fr`,
`api-adresse.data.gouv.fr` et l'origine du site sont légitimes).

### Ce qui est volontairement absent — NE PAS signaler comme bug
- **Pas de compte, pas de sauvegarde, pas de galerie.** Rien n'est conservé entre deux visites,
  c'est le principe.
- **Le nombre de millésimes varie de 8 à 12 selon le lieu.** L'IGN survole la France par
  rotation : tous les départements ne sont pas photographiés chaque année. Ce n'est pas un
  défaut du site, et le pied de page l'explique.
- **L'adresse ne figure pas dans le lien partagé** (seulement des coordonnées à 4 décimales).
  C'est un choix de confidentialité assumé.

### ⚠️ Faux positifs déjà rencontrés — ne pas les re-signaler
1. **7 à 10 erreurs `404` dans la console à chaque chargement.** C'est le signal **normal** du
   WMTS : « ce millésime ne couvre pas ce point ». Les compter et les mentionner en `info`,
   jamais en bug. **En revanche, tout code HTTP autre que 200 ou 404 est une anomalie réelle.**
2. **Capture d'écran du canvas prise pendant un fondu** : l'image paraît incomplète, avec une
   zone vide. C'est l'animation saisie en cours de transition. Vérifier par mesure des pixels
   peints avant de conclure — pas à l'œil sur une capture.
3. **Capture headless à 390 px montrant du texte coupé à droite** : artefact de rendu.
   **La mesure DOM fait foi** : `document.documentElement.scrollWidth - window.innerWidth`.
4. **Taper « Mont Saint Michel » puis valider renvoie une rue à Challes-les-Eaux (Savoie).**
   C'est la façon dont la Base Adresse Nationale classe les résultats, pas un bug du site —
   c'est d'ailleurs pour cela que la liste d'exemples existe. À signaler en `info` seulement.

## Variables

- BASE_URL : `https://remonter-le-temps.vercel.app`
- Dossier de sortie : `~/ign-timelapse-web/.qa/qa-run-<AAAA-MM-JJ>/`
- Vidéo : `<OUT>/qa.webm` · Rapport : `<OUT>/qa-report.html` · Captures : `<OUT>/screenshots/`

⚠️ Avant de commencer, s'assurer que `.qa/` est ignoré par git — **le dépôt est public** et une
vidéo de QA n'a rien à y faire : `grep -q '^\.qa' .gitignore || echo '.qa/' >> .gitignore`

## Règles de qualité — à appliquer avant tout le reste

### R1. Un bug non reproduit deux fois n'est pas un bug
Rejouer chaque anomalie d'interaction une seconde fois et vérifier l'**état réel** (URL,
attributs ARIA, pixels peints, requêtes réseau) — pas seulement l'apparence.

### R2. Sélecteur ambigu = clic raté en silence
Un `click` dont le sélecteur correspond à plusieurs éléments **n'agit pas** et **n'affiche pas
d'erreur claire** (strict mode Playwright). On croit alors que la fonctionnalité est cassée.
Toujours désambiguïser (`{ name: 'Texte exact' }` ou `.first()`) et re-tester **avant** de
déclarer un bug d'interaction.

### R3. Distinguer le site de ses fournisseurs
Le site dépend de deux API publiques. Si l'IGN est en panne, **ce n'est pas un bug du site** —
mais c'est un risque à signaler, car le visiteur ne fera pas la différence. Pour trancher :
rejouer le même appel 10 fois. Échec systématique = appel invalide ; échec erratique = service
tiers instable. Le dire explicitement dans le rapport.

### R4. Vérifier que le site est dans un état normal avant de mesurer
Relever le hash du bundle (`assets/index-*.js`) au début et à la fin. S'il change en cours de
route, un déploiement est passé et les mesures antérieures sont à refaire.

### R5. Ne rien déclencher d'irréversible
Le bouton de partage s'arrête à la **génération du lien** : ne jamais ouvrir l'application de
messagerie ni envoyer. Le téléchargement de la vidéo est autorisé (local, sans effet de bord).

## Pré-vol

```bash
OUT=~/ign-timelapse-web/.qa/qa-run-$(date +%F)
mkdir -p "$OUT/screenshots"
which playwright-cli && playwright-cli --version
playwright-cli --help | head -60      # vérifier les commandes AVANT de les scripter
```

Commandes confirmées en v0.1.15 : `open goto click fill hover type snapshot eval resize
screenshot console requests highlight video-start video-stop video-chapter video-show-actions
mousemove mousedown mouseup mousewheel keydown tab-new cookie-list localstorage-list`.

⚠️ **`mousemove` prend des coordonnées `x y`, PAS une référence d'élément.** Pour viser un
élément : `hover <ref>`. ⚠️ **`open` est headless par défaut** ; la vidéo s'enregistre quand même.
⚠️ **Ne pas utiliser de `sleep` en premier plan** (bloqué par le harness) : le rythme vient de
`video-show-actions` et de `video-chapter --duration`.

## Ouverture de session, filigrane et ciblage

```bash
playwright-cli open "$BASE_URL/" --browser=chrome
playwright-cli video-start "$OUT/qa.webm" --size 1280x800
playwright-cli video-show-actions --duration 900 --position top-right --cursor pointer
```

### Filigrane — obligatoire sur toutes les preuves

Toute capture et toute image de la vidéo doivent porter une marque « capture de test », pour
qu'aucune preuve de QA ne puisse être confondue avec une capture produit réelle.

**Méthode vérifiée le 29/07** (posée en `position: fixed` + `pointer-events: none`, elle
**n'affecte ni la mise en page ni la mesure de débordement** : contrôlé à 0 px en 1280 comme en
390) :

```bash
playwright-cli --raw eval "() => {
  document.getElementById('qa-filigrane')?.remove()
  const d = document.createElement('div'); d.id = 'qa-filigrane'
  d.textContent = 'QA - remonter-le-temps - ' + new Date().toISOString().slice(0,10) + ' - capture de test'
  Object.assign(d.style, { position:'fixed', right:'12px', bottom:'12px', zIndex:'2147483647',
    pointerEvents:'none', font:'600 12px/1.4 system-ui,sans-serif', color:'rgba(255,255,255,.92)',
    background:'rgba(226,98,57,.85)', padding:'6px 12px', borderRadius:'6px', maxWidth:'60vw' })
  document.body.appendChild(d); return 'pose'
}"
```

⚠️ **Le réinjecter après chaque `goto` ou rechargement** (le DOM est reconstruit). Après un
simple changement de vue ou un `resize`, il persiste.

⚠️ **Le retirer avant toute mesure de pixels sur le canvas** (chapitre P3), sinon il fausse le
comptage : `playwright-cli --raw eval "document.getElementById('qa-filigrane')?.remove()"`.

Pour marquer la vidéo finale de façon indélébile, ffmpeg est disponible :
```bash
ffmpeg -i "$OUT/qa.webm" -vf "drawtext=text='QA - capture de test':x=w-tw-20:y=h-th-20:\
fontsize=22:fontcolor=white@0.85:box=1:boxcolor=0xe26239@0.75:boxborderw=8" \
  -c:a copy "$OUT/qa-filigrane.webm"
```

### Ciblage visuel avant chaque interaction — à conserver

`video-show-actions` anime déjà le curseur et surligne la cible. **Ajouter par-dessus un
surlignage explicite** de l'élément visé, pour que la vidéo montre sans ambiguïté ce qui va être
manipulé :

```bash
playwright-cli highlight "<ref>" --style="outline: 3px solid #e26239; outline-offset: 2px"
playwright-cli hover "<ref>"          # PAS mousemove : il prend des coordonnées
playwright-cli click "<ref>"
```

Réserver le rouge (`outline: 3px solid red; background: rgba(255,0,0,.12)`) au marquage des
**anomalies**, pour qu'on distingue à l'écran ce qui est ciblé de ce qui est en défaut.

## Matrice à couvrir

| Viewport | Rôle | Parcours |
|---|---|---|
| **390 × 844** (iPhone) | **principal** | P1 à P6 en entier |
| **360 × 800** (Android étroit) | débordement | P1, P2 + contrôle sur chaque vue |
| **1280 × 800** (bureau) | secondaire | P1, P3, P4, P6 |

Le trafic LinkedIn est majoritairement mobile : traite le téléphone comme le cas principal.

Contrôle de débordement, à rejouer sur chaque vue et après chaque changement d'orientation :
```bash
playwright-cli --raw eval "JSON.stringify({overflow: document.documentElement.scrollWidth - window.innerWidth})"
```
`overflow > 0` = bug **majeur**.

---

# Baseline mesurée le 29/07 en production — tout écart est une régression

| Mesure | Valeur de référence |
|---|---|
| Rennes (`?lat=48.1173&lon=-1.6778&w=2000`) | **12 millésimes** |
| Hanvec (`?lat=48.3419&lon=-4.1461&w=2000`) | **10** |
| Viaduc de Millau (`?lat=44.0794&lon=3.0225&w=2000`) | **11 millésimes** |
| Lille en 390 px (`?lat=50.6292&lon=3.0573&w=2000`) | **9** |
| Erreurs HTTP hors 404 | **0** |
| Requêtes vers `data.geopf.fr` | ~292 bureau / ~371 mobile |
| Poids d'une visite | 1,2 à 1,4 Mo |
| Chargement complet | 7 à 9 s |
| Canvas affiché | 736 × 491 (bureau) · 358 × 448 (mobile) |
| Petit glissé dans l'image | **0 requête** |
| Grand glissé | **une seule salve**, puis 0 |
| Durée d'un millésime à l'écran | 1,8 s (1100 ms + 700 ms de fondu) |

⚠️ Un compte de millésimes **inférieur** à la référence sur ces quatre lieux est le signal le
plus important du test : c'est le symptôme exact de la panne corrigée le 29/07.

---

# Les parcours

> Pour chaque parcours : `video-chapter` au début, sonde d'état avant/après, captures, relevé
> console. Filigrane réinjecté après chaque navigation.

Sonde d'état réutilisable :
```bash
playwright-cli --raw eval "JSON.stringify({
  url: location.href, titre: document.title,
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  canvas: (c => c ? {css: Math.round(c.getBoundingClientRect().width)+'x'+Math.round(c.getBoundingClientRect().height), attr: c.width+'x'+c.height} : null)(document.querySelector('canvas')),
  boutons: [...document.querySelectorAll('button')].filter(b=>b.offsetParent).map(b=>b.innerText||b.ariaLabel),
  millesimes: (document.body.innerText.match(/\\d+ millésimes?[^\\n]*/)||[])[0] || null,
  stockage: {cookies: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage)}
})"
```

## P1 — Arrivée, état vide et promesse de confidentialité

1. Charger la page nue. Vérifier : pas d'écran blanc, titre lisible, phrase d'explication,
   champ d'adresse, bouton « Voir ce lieu », bouton « Utiliser ma position », et **les quatre
   exemples cliquables** (viaduc de Millau, La Défense, Roissy, Mont-Saint-Michel).
2. ⚠️ **Les boutons de largeur (150 m / 300 m / 800 m / 2 km) ne doivent PAS être actionnables
   tant qu'aucun lieu n'est choisi.** Un clic sans effet est un bug **majeur** : c'était un
   défaut corrigé le 28/07, sa réapparition serait une régression.
3. **Vérifier la promesse de confidentialité** — le cœur de ce parcours :
   ```bash
   playwright-cli --raw eval "JSON.stringify({cookies: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage), sw: !!navigator.serviceWorker?.controller})"
   playwright-cli requests    # relever TOUS les domaines contactés
   ```
   Tout domaine autre que l'origine, `data.geopf.fr` et `api-adresse.data.gouv.fr` = **bloquant**.
   Tout cookie ou clé de stockage = **bloquant** (le pied de page affirme le contraire).
4. Cliquer un exemple et vérifier qu'une image apparaît **en un clic**.

Captures : `p1-01-accueil.png`, `p1-02-exemple-charge.png`.

## P2 — Recherche d'une adresse

1. Taper une adresse partielle. Vérifier que la liste de suggestions s'ouvre.
2. Choisir une suggestion → l'image doit se charger.
3. Recommencer en **validant avec Entrée sans attendre les suggestions** : la recherche doit
   se faire quand même et signaler son échec le cas échéant. Une soumission muette est un bug
   **majeur** (défaut corrigé le 28/07).
4. Coller des **coordonnées** au format `44.0794, 3.0225` : doit fonctionner.
5. ⚠️ **Ouvrir un lien partagé (`?lat=…&lon=…&w=…`) ne doit PAS faire apparaître la liste de
   suggestions par-dessus l'image.** Bug corrigé le 28/07, à vérifier.
6. Sur téléphone, après chargement, la page doit **défiler jusqu'à l'image** (le résultat se
   trouve sinon caché sous le clavier).
7. Saisir une adresse manifestement introuvable et vérifier que le message est clair.

Captures : `p2-01-suggestions.png`, `p2-02-resultat.png`, `p2-03-mobile-scroll.png`.

## P3 — Lecture du timelapse

1. Vérifier le compte de millésimes sur **les quatre lieux de la baseline** et comparer.
2. Vérifier que l'animation défile, que l'année s'affiche, que le fondu se fait.
3. Tester **pause / lecture**.
4. Manipuler la **réglette** et cliquer un millésime dans la frise : l'image doit changer.
5. Accessibilité de la réglette : `aria-valuetext` doit annoncer **l'année** (« 2018 »), pas un
   indice (« 2 »). Correction du 28/07, à vérifier.
6. **Contrôler que le canvas est intégralement peint** (et non à l'œil sur une capture, cf. faux
   positif n° 2) — retirer le filigrane avant cette mesure :
   ```bash
   playwright-cli --raw eval "document.getElementById('qa-filigrane')?.remove()"
   playwright-cli --raw eval "(() => { const c=document.querySelector('canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let droite=0,bas=0; for(let y=0;y<c.height;y++){const i=((y*c.width)+(c.width-2))*4; if(d[i+3]>0&&(d[i]|d[i+1]|d[i+2]))droite++} for(let x=0;x<c.width;x++){const i=(((c.height-2)*c.width)+x)*4; if(d[i+3]>0&&(d[i]|d[i+1]|d[i+2]))bas++} return JSON.stringify({taille:c.width+'x'+c.height, colonneDroite:droite+'/'+c.height, ligneBas:bas+'/'+c.width}) })()"
   ```
   Les deux bords doivent être peints intégralement.

Captures : `p3-01-lecture.png`, `p3-02-frise.png`.

## P4 — Navigation dans l'image

1. **Glisser** l'image : elle doit suivre le doigt ou la souris.
2. ⚠️ Compter les requêtes : un **petit glissé = 0 requête** (tampon), un **grand glissé = une
   seule salve**, puis plus rien. Une salve qui se répète en boucle est un bug **bloquant** —
   c'est le défaut corrigé le 29/07 (51 724 requêtes mesurées sur téléphone).
   ```bash
   playwright-cli requests | grep -c data.geopf.fr    # avant / après chaque geste
   ```
3. Tester le **zoom** : molette, boutons + et −, et les largeurs 150 m à 2 km. Vérifier que les
   deux boutons + / − font au moins 44 px.
4. ⚠️ **Dézoomer jusqu'à 2 km doit faire apparaître les cartes anciennes** (état-major vers
   1840, Cassini vers 1760). Leur absence à 2 km est un bug **majeur** : c'est l'argument
   central du post à venir (« deux siècles et demi »).
5. En dessous de 700 m, le site doit **expliquer** que ces cartes ne sont pas proposées à cette
   échelle, et non les faire disparaître en silence.
6. Sur téléphone : tester le **pincement** pour zoomer, et vérifier qu'une **rotation** de
   l'écran recharge proprement sans casser la vue.

Captures : `p4-01-avant-glisse.png`, `p4-02-apres-glisse.png`, `p4-03-cartes-anciennes.png`.

## P5 — Géolocalisation

1. Cliquer « Utiliser ma position ». Vérifier l'état d'attente (« Localisation… »).
2. ⚠️ **Le cas important est le refus.** Refuser la permission et vérifier que le site reste
   utilisable, avec un message clair et **aucune erreur console non gérée**. Beaucoup de
   visiteurs refuseront : un site figé à ce moment-là perd son public en trois secondes.
   ```bash
   playwright-cli run-code "await context.grantPermissions([])"   # ou refuser à la main
   ```
3. Si la position est accordée, vérifier que le cadrage suit la précision annoncée et que le
   site signale une précision médiocre au lieu d'afficher un quartier voisin avec aplomb.

Captures : `p5-01-permission-refusee.png`.

## P6 — Vidéo et partage

1. Cliquer « Créer la vidéo ». Vérifier la **barre de progression** puis l'apparition d'un lien
   de téléchargement annonçant **le poids et le format**.
2. Vérifier que le fichier produit est bien un **MP4** (et non un WebM : LinkedIn refuse le
   WebM — c'est précisément l'usage prévu).
3. Si `MediaRecorder` n'est pas disponible, une **explication** doit remplacer le bouton, pas un
   bouton mort.
4. Cliquer « Partager ce lieu ». Vérifier qu'un lien est produit ou copié. ⚠️ **Vérifier que
   l'adresse tapée ne figure PAS dans le lien** (seulement des coordonnées) — sa présence serait
   un bug **majeur** de confidentialité. **Ne pas envoyer** (R5).
5. **Ouvrir le lien produit dans un nouvel onglet** (`tab-new`) et vérifier qu'il restitue la
   même vue.

Captures : `p6-01-video.png`, `p6-02-partage.png`, `p6-03-lien-rouvert.png`.

---

# Audits transverses

## A1 — Console et réseau
```bash
playwright-cli console | tee "$OUT/console.log"
playwright-cli requests | tee "$OUT/requests.log"
```
Classer les codes : **200 et 404 sont normaux** (404 = pas de couverture, 7 à 10 par
chargement). **Tout autre code est une anomalie réelle** — les 400 et 502 étaient précisément le
symptôme de la panne du 29/07. Relever le nombre exact de 404 et le comparer d'un lieu à l'autre.

## A2 — En-têtes de sécurité
```bash
curl -sSI "$BASE_URL/" | grep -iE "content-security-policy|x-frame|referrer-policy|permissions-policy|strict-transport"
```
Attendu : CSP restrictive, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS.
Vérifier **zéro violation CSP** dans la console : la police est auto-hébergée et aucun script
tiers ne doit être chargé.

## A3 — Liens
Peu de liens sortants (IGN, licence Etalab, GitHub, profil). Les vérifier **sans `-L`**, sinon
les redirections sont suivies et l'information disparaît :
```bash
curl -s -o /dev/null -w "%{http_code}\n" -I "<URL>"
```
Vérifier aussi que les liens externes portent `rel="noopener"`.

## A4 — Accessibilité
Un seul `h1`, hiérarchie cohérente, boutons sans nom accessible, champs sans étiquette,
cibles tactiles < 44 px, navigation clavier avec focus visible, `aria-valuetext` de la réglette.
```bash
playwright-cli --raw eval "JSON.stringify({
  h1: [...document.querySelectorAll('h1')].map(h=>h.innerText),
  boutonsSansNom: [...document.querySelectorAll('button')].filter(b=>!b.innerText.trim()&&!b.ariaLabel).map(b=>b.outerHTML),
  champsSansLabel: [...document.querySelectorAll('input,textarea,select')].filter(i=>!i.labels?.length&&!i.ariaLabel&&!i.getAttribute('aria-labelledby')).map(i=>i.outerHTML),
  ciblesPetites: [...document.querySelectorAll('a,button')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height<44}).map(e=>({t:(e.innerText||e.ariaLabel||'').slice(0,30),h:Math.round(e.getBoundingClientRect().height)})),
  slider: [...document.querySelectorAll('[role=slider],input[type=range]')].map(s=>({vt:s.getAttribute('aria-valuetext'),v:s.value}))
})"
```
⚠️ Backlog connu, à signaler en `info` et non en bug : le champ d'adresse n'est pas une vraie
combobox ARIA (pas de navigation aux flèches ni d'Échap), et l'image ne se déplace pas au clavier.

## A5 — Performance perçue
```bash
playwright-cli --raw eval "JSON.stringify({
  nav: performance.getEntriesByType('navigation')[0],
  nbRessources: performance.getEntriesByType('resource').length,
  lentes: performance.getEntriesByType('resource').filter(r=>r.duration>1000).map(r=>({n:r.name.slice(-70),ms:Math.round(r.duration)}))
})"
```
Le point sensible est le **délai avant la première image** : le site affiche les millésimes au
fil de leur arrivée. Mesurer ce délai — au-delà de 3 s, un visiteur venu d'un lien LinkedIn
abandonne. Vérifier aussi le poids total face à la référence de 1,2 à 1,4 Mo.

## Clôture
```bash
playwright-cli video-stop && playwright-cli close
```

---

# Rapport HTML

`<OUT>/qa-report.html`, dans cet ordre :

1. **En-tête** : URL, date, navigateur, viewports, hash du bundle au début et à la fin, vidéo.
2. **Verdict** en haut et en gros : **publiable en l'état sur LinkedIn — oui ou non**, et pourquoi.
3. **Métriques** : 4 cartes — parcours testés, erreurs console hors 404, bugs, avertissements.
4. **Écarts par rapport à la baseline du 29/07** — en premier, ce sont les régressions.
5. **Résumé exécutif** (5 à 8 lignes) : état général, risques, bugs prioritaires.
6. **Vidéo et chapitres** : chemin, statut, anomalies par chapitre.
7. **Bugs détaillés** : `BUG-001`… avec sévérité, statut, description, preuve, reproduction,
   recommandation, **et le parcours (P1-P6) concerné**.
8. **Résultats par parcours** : tableau P1 à P6, viewports couverts, verdict, bugs.
9. **Confidentialité** : la promesse du pied de page est-elle tenue ? Domaines contactés,
   cookies, stockage. Section à part, c'est le point le plus exposé publiquement.
10. **Console** · 11. **En-têtes et liens** · 12. **Accessibilité** · 13. **Performance**.
14. **Ce qui fonctionne** : liste explicite de ce qui a été validé.
15. **Captures** en grille 2 colonnes (nom, parcours, légende) — **toutes filigranées**.
16. Pied de page : `Généré par Claude Code + playwright-cli · [date]`

**Génération** : remplir les tableaux par **code déterministe** depuis les fichiers collectés,
jamais en les recopiant de mémoire. Le jugement (sévérité, résumé, verdict) reste rédigé.
⚠️ N'embarquer que les captures aux **noms canoniques** ci-dessus : les recadrages
intermédiaires pollueraient le rapport.

# Résultat attendu

1. Chemin du rapport et de la vidéo
2. Nombre de bugs par sévérité **et par parcours**
3. Les 3 corrections prioritaires
4. La réponse à : **peut-on partager ce lien sur LinkedIn dès maintenant ?**
5. `open <OUT>/qa-report.html`
