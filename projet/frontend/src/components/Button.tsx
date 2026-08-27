import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 " +
  "text-sm font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Deux variantes seulement, et c'est délibéré.
 *
 * `primary` (bleu) porte l'action principale de l'écran ; `secondary` tout le
 * reste. Une troisième variante ne se justifierait que le jour où un écran
 * offre trois actions de poids différents — cela ne s'est pas encore présenté.
 *
 * Le vert du dossier n'est PAS une variante de bouton : il désigne les
 * indicateurs carbone, pas les actions. Le détourner en bouton brouillerait
 * ce que la couleur signifie.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-neutral-300 bg-white text-ink hover:bg-neutral-50",
};

/**
 * Bouton d'action — un vrai `<button>`.
 *
 * À n'utiliser QUE pour agir sur la page (soumettre, filtrer, recalculer).
 * Pour aller ailleurs, voir `ButtonLink` : un lecteur d'écran annonce
 * « bouton » ou « lien » selon la balise, et un lien s'ouvre dans un nouvel
 * onglet au clic du milieu — pas un bouton.
 */
export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/**
 * Lien présenté comme un bouton — un vrai `<a>` via `next/link`.
 *
 * `next/link` assure la navigation côté client : pas de rechargement complet,
 * et le préchargement de la page cible.
 */
export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${BASE} ${VARIANTS[variant]} ${className}`}>
      {children}
    </Link>
  );
}
