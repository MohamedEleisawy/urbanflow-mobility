/**
 * Indicateur de chargement.
 *
 * ACCESSIBILITÉ : une animation seule n'informe personne au lecteur d'écran.
 * `role="status"` annonce la zone comme un message d'état, et le libellé —
 * visuellement masqué par `sr-only`, mais bien présent dans le DOM — dit ce
 * qui se passe. Le cercle lui-même est `aria-hidden` : il est décoratif.
 */
export function Spinner({ label = "Chargement en cours…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-neutral-600">
      <span
        aria-hidden="true"
        className="border-brand h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
