// Une ressource dessinée par une boucle asynchrone ne peut être libérée qu'après
// l'arrêt de cette boucle. Centraliser l'ordre rend cet invariant testable.
export function cancelThenRelease(cancel, release, resources) {
  cancel()
  release?.(resources)
}
