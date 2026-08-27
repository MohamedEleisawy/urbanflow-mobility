import type { ReactNode } from "react";

/**
 * Échec réel : requête refusée, serveur injoignable, saisie invalide.
 *
 * `role="alert"` fait annoncer le message immédiatement par un lecteur
 * d'écran, sans attendre que l'usager atteigne la zone — c'est justement ce
 * qu'on attend d'une erreur, et ce qu'il ne faudrait PAS faire pour un
 * contenu ordinaire.
 *
 * LA COULEUR N'EST JAMAIS SEULE PORTEUSE DE SENS : le rouge est doublé d'un
 * titre explicite, faute de quoi un usager daltonien ne distinguerait pas ce
 * bloc d'un encadré d'information (WCAG 1.4.1).
 *
 * Le message vient de `messageDErreur()` : jamais une trace d'exécution.
 */
export function ErrorMessage({
  title = "Une erreur est survenue",
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-5 py-4">
      <p className="font-medium text-red-900">{title}</p>
      <p className="mt-1 text-sm text-red-800">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
