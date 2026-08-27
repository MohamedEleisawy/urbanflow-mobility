import type { ReactNode } from "react";

/**
 * Bloc de contenu sur fond blanc.
 *
 * Le fond de page est le gris clair du dossier (#F5F5F5) ; la carte pose
 * dessus une surface blanche. C'est ce contraste — et non une ombre portée —
 * qui délimite les blocs : plus sobre, et plus lisible en plein soleil sur un
 * téléphone.
 */
export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-neutral-200 bg-white p-5 sm:p-6">{children}</div>;
}
