"use client";

import { useTraduction } from "@/components/LangueProvider";
import { LIBELLES_MODES } from "@/lib/format";
import type { Capacites } from "@/lib/capacites-api";
import type { TransportMode } from "@/lib/types";

// =============================================================================
// Filtres de modes (refondus au sprint soutenance)
// =============================================================================
// ═══ CE QUI N'ALLAIT PAS DANS LA VERSION PRÉCÉDENTE ═══
//
// Elle affichait les six modes sur une seule ligne, les indisponibles en gris
// avec une infobulle. À l'usage, sur l'Eurométropole, cela donnait :
//
//     [Tram] [Métro] [Train] [Bus] [Vélo] [Marche]
//        ✓     gris    gris     ✓    gris    gris
//
// Quatre boutons gris sur six. L'usager y lisait une application à moitié
// cassée, alors que quatre de ces modes n'ont tout simplement rien à faire là
// — et pour TROIS RAISONS DIFFÉRENTES, que le même gris confondait :
//
//   1. MÉTRO, TRAIN — n'existent pas sur ce réseau. Rien ne les rendra
//      disponibles ici.
//   2. VÉLO — existerait si un routeur cyclable était configuré. C'est un
//      manque de DÉPLOIEMENT, pas de territoire.
//   3. MARCHE — est TOUJOURS disponible, et ne peut simplement pas être
//      écartée : elle relie l'origine à l'arrêt et l'arrêt à la destination.
//      La griser était le plus absurde des quatre.
//
// ═══ CE QUI LES REMPLACE ═══
//
// Les modes RÉELLEMENT filtrables en haut, comme des interrupteurs. Les autres
// dans un repli, avec le motif de chacun. Un usager curieux l'ouvre ; les
// autres voient une rangée de boutons qui marchent tous.
//
// ⚠️ CE FILTRE NE MENT PAS SUR CE QU'IL FAIT. Il masque des itinéraires DÉJÀ
// calculés ; il ne relance aucune recherche. C'est écrit sous les boutons.
// =============================================================================

/// Pictogramme par mode. Décoratif : le libellé est TOUJOURS écrit à côté.
const PICTOS: Record<TransportMode, string> = {
  WALK: "🚶",
  BUS: "🚌",
  TRAM: "🚊",
  METRO: "🚇",
  TRAIN: "🚆",
  BIKE: "🚴",
  ESCOOTER: "🛴",
  CAR: "🚗",
};

/**
 * L'ordre d'affichage, du plus structurant au plus accessoire.
 *
 * Fixe et non alphabétique : « Tram, Bus, Vélo » se lit comme une hiérarchie
 * de réseau, « Bus, Tram, Vélo » comme une liste.
 */
const ORDRE: TransportMode[] = ["TRAM", "METRO", "TRAIN", "BUS", "BIKE"];

/// Modes qui dépendent d'un ROUTEUR configuré, non du réseau de transport.
const MODES_ROUTES = new Set<TransportMode>(["BIKE"]);

export interface FiltresModesProps {
  /**
   * Modes de transport présents dans le réseau, ou `null` tant qu'on l'ignore.
   *
   * Vient de `GET /api/stops/modes`, donc du réseau RÉELLEMENT chargé.
   */
  disponibles: readonly TransportMode[] | null;

  /**
   * Ce que cette installation sait faire, ou `null` tant qu'on l'ignore.
   *
   * ⚠️ `null` EST TRAITÉ COMME « RIEN N'EST CONFIGURÉ ». Le doute se tranche
   * du côté de l'honnêteté : proposer un filtre vélo sans routeur enverrait
   * l'usager vers une liste vide sans explication.
   */
  capacites: Capacites | null;

  /// Modes que l'usager a explicitement écartés.
  exclus: ReadonlySet<TransportMode>;

  onBasculer: (mode: TransportMode) => void;
}

export function FiltresModes({
  disponibles,
  capacites,
  exclus,
  onBasculer,
}: FiltresModesProps) {
  const { t } = useTraduction();

  // Tant que le réseau n'a pas répondu, on n'affiche rien : des boutons qui
  // changeraient d'état une seconde plus tard seraient plus déroutants que
  // leur absence.
  if (disponibles === null) {
    return null;
  }

  const presents = new Set(disponibles);

  /**
   * Un mode est filtrable si sa source existe.
   *
   * ⚠️ DEUX SOURCES DISTINCTES, ET IL FAUT LES GARDER DISTINCTES. Le tram
   * dépend du RÉSEAU importé ; le vélo dépend d'un ROUTEUR configuré. Les
   * confondre ferait apparaître un filtre vélo parce que le tram circule.
   */
  const filtrable = (mode: TransportMode): boolean =>
    MODES_ROUTES.has(mode)
      ? capacites?.bikeRouting.status === "CONFIGURED"
      : presents.has(mode);

  const actifs = ORDRE.filter(filtrable);
  const absents = ORDRE.filter((mode) => !filtrable(mode));

  return (
    <section aria-labelledby="filtres-modes" className="space-y-2">
      <h2 id="filtres-modes" className="text-ink text-sm font-medium">
        {t.filtresModes}
      </h2>

      {/* `flex-wrap` plutôt qu'un défilement horizontal : sur un écran de
          375 px, quatre boutons tiennent sur deux lignes, et une liste qui
          défile cache des options que l'usager ne pensera pas à chercher. */}
      <div className="flex flex-wrap gap-2">
        {actifs.map((mode) => {
          const actif = !exclus.has(mode);

          return (
            <button
              key={mode}
              type="button"
              // ⚠️ `aria-pressed` : c'est un INTERRUPTEUR, pas une navigation.
              // Un lecteur d'écran annonce « activé » / « désactivé » sans
              // dépendre de la couleur.
              aria-pressed={actif}
              onClick={() => onBasculer(mode)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                actif
                  ? "border-brand bg-brand text-white"
                  : "text-ink border-neutral-300 bg-white hover:bg-neutral-50"
              }`}
            >
              <span aria-hidden="true">{PICTOS[mode]}</span>{" "}
              {LIBELLES_MODES[mode]}
            </button>
          );
        })}
      </div>

      {/* Dire ce que le filtre fait RÉELLEMENT. Sans cette phrase, un usager
          qui décoche « Bus » attendrait une nouvelle recherche. */}
      <p className="text-xs text-neutral-600">{t.filtresAide}</p>

      {/* ═══ CE QUI N'EST PAS LÀ, ET POURQUOI ═══
          ⚠️ UN `<details>` REPLIÉ, ET NON DES BOUTONS GRIS. L'information
          reste accessible — masquer ces modes laisserait croire qu'ils
          n'existent pas — mais elle ne monopolise plus la moitié de la
          rangée. */}
      {absents.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-600">
            {t.filtresAutresModes}
          </summary>

          <ul className="mt-2 space-y-1.5 text-neutral-600">
            {absents.map((mode) => (
              <li key={mode}>
                <span aria-hidden="true">{PICTOS[mode]}</span>{" "}
                <span className="text-ink font-medium">
                  {LIBELLES_MODES[mode]}
                </span>{" "}
                —{" "}
                {MODES_ROUTES.has(mode)
                  ? t.motifRoutageAbsent
                  : t.motifAbsentDuReseau}
              </li>
            ))}

            {/* ⚠️ LA MARCHE FIGURE ICI ET NON PARMI LES FILTRES. Elle n'est
                pas indisponible : elle est INÉCARTABLE. Tout itinéraire en
                comporte, et l'exclure viderait la liste quoi qu'on choisisse.
                La griser, comme le faisait la version précédente, laissait
                croire à une panne. */}
            <li>
              <span aria-hidden="true">{PICTOS.WALK}</span>{" "}
              <span className="text-ink font-medium">
                {LIBELLES_MODES.WALK}
              </span>{" "}
              — {t.marcheToujoursIncluse}
            </li>
          </ul>
        </details>
      )}
    </section>
  );
}
