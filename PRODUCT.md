# Product

## Register

brand

## Users

Des gens qui ne cherchaient rien. Ils arrivent depuis un lien LinkedIn ou un message
d'un ami, sur leur telephone, le soir, dans le canape. Ils tapent l'adresse de la maison
de leurs parents, ou celle de leur enfance, et ils tendent l'ecran a quelqu'un d'autre.

Le travail a faire est emotionnel, pas fonctionnel : revoir un lieu qu'on connait, tel
qu'il etait avant. Personne n'a de « tache » a accomplir. La reussite se mesure au fait
qu'ils montrent l'ecran a quelqu'un, puis envoient le lien.

Corollaire : le mobile n'est pas un cas secondaire, c'est le cas nominal.

## Product Purpose

Rendre visible, en quelques secondes et sans rien installer, l'evolution d'un lieu en
France depuis la carte de Cassini (vers 1760) jusqu'aux orthophotos d'aujourd'hui, a
partir des donnees ouvertes de l'IGN.

Le site sert aussi de preuve publique du positionnement d'Henri : la donnee utile existe
souvent deja, gratuite et publique, il manque le code qui va la chercher. Il doit donc
etre bon a montrer, pas seulement utile.

## Brand Personality

**Precis, patine, pose.**

La precision vient de l'IGN : 20 cm par pixel, des dates exactes, aucune approximation
maquillee. La patine vient de la matiere : du papier grave de 1760, des tirages
argentiques des annees 50. Le pose vient de l'usage : on contemple, on ne pilote pas.

Voix : on explique sans jargon, on dit ce qu'on ne sait pas, on ne survend rien. Le
sujet est deja emouvant, il n'a pas besoin d'etre commente.

## Anti-references

- **L'outil de geomaticien.** Pas de panneau de couches, pas de nomenclature WMS
  visible, pas de vocabulaire metier. Le Geoportail et QGIS sont des contre-modeles.
- **L'app SaaS generique.** Pas d'ardoise bleutee, pas de degrades, pas de gros chiffres
  en heros, pas de cartes arrondies alignees. C'est precisement ce que le site etait
  avant cette passe, et c'est a corriger.
- **Le site de genealogie vieillot.** Le sujet est ancien, le traitement ne doit pas
  l'etre : ni sepia, ni parchemin, ni serif ornemental. La patine est dans les images,
  pas dans le decor.

## Design Principles

1. **L'image est le produit.** Toute la surface disponible lui revient. Le reste de
   l'interface recule. Sur telephone, une photo qui occupe un quart de l'ecran est un
   echec, pas une mise en page.
2. **L'annee est l'emotion.** C'est le seul element qui a le droit d'etre grand et
   affirme : c'est lui qui produit le « ah oui, c'etait avant ».
3. **Dire la verite sur les donnees.** Quand un millesime manque, on le dit. Quand un
   point est approximatif, on le dit. Ne jamais laisser croire a une couverture uniforme.
4. **Rien ne part d'ici.** Aucune collecte, aucun script tiers, polices auto-hebergees.
   La promesse de confidentialite doit etre vraie techniquement, pas seulement ecrite.
5. **Le partage est une fonction, pas un bouton en plus.** Un lien qui rejoue exactement
   le cadrage, et une video qu'on envoie en deux gestes depuis un telephone.

## Accessibility & Inclusion

WCAG AA : contraste >= 4.5:1 sur le texte courant, >= 3:1 sur le grand texte. Cibles
tactiles >= 44 px. `prefers-reduced-motion` respecte : le fondu enchaine devient une
transition immediate et la lecture ne demarre pas seule. Navigation au clavier possible
sur tous les controles. Le zoom et le deplacement ont toujours une alternative cliquable
(les largeurs predefinies), car le pincement n'est pas accessible a tout le monde.
