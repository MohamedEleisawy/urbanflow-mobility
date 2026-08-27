import type { ReactNode } from "react";

/**
 * Largeur de lecture commune à toutes les pages.
 *
 * Existe pour une raison simple : sans elle, chaque écran redéclarerait
 * `mx-auto max-w-5xl px-4 sm:px-6`, et deux pages finiraient par diverger d'un
 * demi-rem sans que personne ne s'en aperçoive.
 *
 * `max-w-5xl` (64rem) : au-delà, une ligne de texte devient pénible à suivre.
 */
export function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">{children}</div>;
}
