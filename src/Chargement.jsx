// Le chargement dure quelques secondes et c'est le premier contact avec le site :
// autant qu'il raconte ce qui se passe vraiment. « 16/17 » ne veut rien dire pour
// qui arrive de LinkedIn ; « 9 vues retrouvées sur 19 » se comprend sans explication.
//
// Les formules sont tirées de la matière - le tirage photo, la gravure, la pellicule -
// et pas de blagues plaquées : le ton du site est posé, le sujet se suffit.

const ETAPES = [
  { jusqu: 0.15, texte: "On demande à l'IGN de ressortir ses archives" },
  { jusqu: 0.35, texte: 'On remonte la pellicule' },
  { jusqu: 0.6, texte: 'On développe les photos' },
  { jusqu: 0.85, texte: 'On tire les épreuves' },
  { jusqu: 1.01, texte: 'On met les années dans le bon ordre' },
]

const ETAPES_ANCIENNES = { jusqu: 0.5, texte: 'On dépoussière les planches de Cassini' }

export default function Chargement({ done, total, trouvees, dernier, cartesAnciennes }) {
  const part = total > 0 ? done / total : 0
  const etape =
    cartesAnciennes && part > 0.2 && part < 0.5
      ? ETAPES_ANCIENNES
      : (ETAPES.find((e) => part < e.jusqu) ?? ETAPES[ETAPES.length - 1])

  return (
    <div className="flex flex-col gap-2">
      <p aria-hidden="true" className="text-[var(--color-craie)]">
        {etape.texte}
        <span className="text-[var(--color-attenue)]">...</span>
      </p>

      <div
        className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label="Récupération des vues aériennes"
      >
        <div
          className="h-full rounded-full bg-[var(--color-vermillon)] transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(4, part * 100)}%` }}
        />
      </div>

      {/* On annonce ce qu'on a REELLEMENT trouve, pas le nombre de couches interrogees :
          la plupart des millesimes ne couvrent pas un point donne, et afficher
          l'avancement comme un resultat laisserait croire a une couverture uniforme. */}
      <p className="text-sm text-[var(--color-attenue)]" role="status">
        {/* total vaut 0 le temps du tout premier aller-retour : ne pas afficher
            « on regarde 0 epoques » pendant cette fraction de seconde. */}
        {done === 0 && (total > 0
          ? `On regarde ${total} époques, de 1760 à aujourd'hui.`
          : 'On regarde ce qui existe à cet endroit.')}
        {done > 0 && trouvees === 0 && "Rien pour l'instant à cet endroit."}
        {trouvees > 0 &&
          `${trouvees} vue${trouvees > 1 ? 's' : ''} retrouvée${trouvees > 1 ? 's' : ''}${
            dernier ? ` - la dernière : ${dernier}` : ''
          }`}
      </p>
    </div>
  )
}
