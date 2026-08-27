import type { ReactNode } from "react";

/**
 * Absence de résultat — et non erreur.
 *
 * LA DISTINCTION EST LE POINT DE CE COMPOSANT. « Aucune perturbation en
 * cours » est une bonne nouvelle : le réseau fonctionne. L'afficher en rouge,
 * avec le vocabulaire d'une panne, inquiéterait l'usager sans raison. C'est
 * la même distinction qu'au backend, où un flux GTFS-RT sans alerte rend 200
 * et une liste vide, jamais une erreur.
 *
 * D'où un ton neutre, et une action proposée quand il y en a une d'utile.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-10 text-center">
      <p className="text-ink font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
