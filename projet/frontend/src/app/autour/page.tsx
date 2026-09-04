"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { useTraduction } from "@/components/LangueProvider";
import { messageDErreur } from "@/lib/api";
import { arretsAutourDe, type AutourReponse } from "@/lib/autour-api";
import { positionActuelle } from "@/lib/geolocalisation";
import { LIBELLES_MODES } from "@/lib/format";
import type { TransportMode } from "@/lib/types";

// =============================================================================
// « Autour de moi » (war room)
// =============================================================================
// ═══ LA QUESTION À LAQUELLE CET ÉCRAN RÉPOND ═══
//
// « Je sors de chez moi. Qu'est-ce que je peux prendre, et quand ? »
//
// Ce n'est PAS la même question qu'une recherche d'itinéraire, qui suppose de
// savoir où l'on va. Ici, on ne sait pas encore — on veut d'abord voir ce
// qu'offre le quartier.
//
// ═══ TROIS HONNÊTETÉS OBLIGATOIRES SUR CET ÉCRAN ═══
//
//   1. LES DISTANCES SONT À VOL D'OISEAU. Aucun routeur piéton n'est
//      configuré. « 180 m » peut demander 400 m de marche si une voie ferrée
//      passe entre les deux. C'est écrit.
//
//   2. LES HORAIRES SONT THÉORIQUES. Ni retard, ni suppression. C'est écrit.
//
//   3. L'ABSENCE D'HORAIRE N'EST PAS UNE ABSENCE DE SERVICE. Un réseau non
//      horodaté produit `UNKNOWN` — et l'écran dit « nous ne savons pas »,
//      jamais « plus de passage ».
//
// ⚠️ LA POSITION N'EST DEMANDÉE QU'AU CLIC. Aucune géolocalisation
// automatique au chargement : c'est une donnée sensible, et la demander sans
// geste explicite est le comportement qui apprend aux usagers à refuser
// systématiquement.
// =============================================================================

/// Pictogramme par mode. Décoratif : le libellé accompagne toujours.
const PICTOS: Partial<Record<TransportMode, string>> = {
  METRO: "🚇",
  TRAM: "🚊",
  TRAIN: "🚆",
  BUS: "🚌",
  WALK: "🚶",
  BIKE: "🚴",
};

type Etat =
  | { phase: "repos" }
  | { phase: "localisation" }
  | { phase: "chargement" }
  | { phase: "resultat"; reponse: AutourReponse }
  | { phase: "erreur"; message: string };

export default function AutourPage() {
  const { t } = useTraduction();
  const [etat, setEtat] = useState<Etat>({ phase: "repos" });

  const chercher = async () => {
    setEtat({ phase: "localisation" });

    try {
      // ⚠️ DEUX ÉTAPES DISTINCTES, DEUX MESSAGES DISTINCTS. « Localisation »
      // et « recherche » échouent pour des raisons différentes — permission
      // refusée d'un côté, réseau de l'autre — et les confondre donnerait un
      // message inutile dans les deux cas.
      const position = await positionActuelle();

      setEtat({ phase: "chargement" });

      const reponse = await arretsAutourDe(position.latitude, position.longitude);

      setEtat({ phase: "resultat", reponse });
    } catch (echec: unknown) {
      setEtat({ phase: "erreur", message: messageDErreur(echec) });
    }
  };

  return (
    <Container>
      <section className="py-10 sm:py-14">
        <h1 className="text-ink text-2xl font-semibold tracking-tight sm:text-3xl">
          {t.autourTitre}
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">{t.autourIntro}</p>

        <div className="mt-6">
          <Button
            type="button"
            onClick={chercher}
            disabled={etat.phase === "localisation" || etat.phase === "chargement"}
          >
            <span aria-hidden="true">📍</span> {t.autourActiver}
          </Button>
        </div>

        {/*
          UNE SEULE ZONE VIVANTE. `Spinner` porte `role="status"` et
          `ErrorMessage` `role="alert"` : ils s'annoncent seuls. Ce conteneur
          n'ajoute aucun `aria-live`, qui ferait tout annoncer deux fois.
        */}
        <div className="mt-8">
          {(etat.phase === "localisation" || etat.phase === "chargement") && (
            <Spinner label={t.autourRecherche} />
          )}

          {etat.phase === "erreur" && (
            <ErrorMessage title={t.autourTitre}>{etat.message}</ErrorMessage>
          )}

          {etat.phase === "resultat" && <Resultats reponse={etat.reponse} />}
        </div>
      </section>
    </Container>
  );
}

function Resultats({ reponse }: { reponse: AutourReponse }) {
  const { t } = useTraduction();

  if (reponse.stops.length === 0) {
    return (
      <EmptyState title={t.autourAucun} description={t.autourAucunDetail} />
    );
  }

  return (
    <div className="space-y-4">
      {/* ═══ LES DEUX AVERTISSEMENTS, AVANT LA LISTE ═══
          Placés APRÈS, ils seraient lus une fois la décision prise. */}
      <p className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-600">
        {t.autourDistanceVolDOiseau}
      </p>

      <p
        className={`rounded-md border px-4 py-3 text-xs ${
          reponse.departuresFreshness === "STATIC"
            ? "border-neutral-200 bg-white text-neutral-600"
            : "border-amber-300 bg-amber-50 text-amber-900"
        }`}
      >
        {reponse.departuresFreshness === "STATIC"
          ? t.autourHorairesTheoriques
          : t.autourHorairesInconnus}
      </p>

      {/* Une liste ORDONNÉE : l'ordre porte du sens — du plus proche au plus
          lointain. `uf-cascade` décale l'apparition des trois premiers. */}
      <ol className="uf-cascade space-y-3">
        {reponse.stops.map((arret) => (
          <li key={arret.id} className="uf-apparait">
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-brand text-base font-semibold">
                  {arret.name}
                </h2>

                {/* ⚠️ LA DISTANCE ET LA MARCHE ENSEMBLE. « 180 m » seul ne dit
                    pas si c'est loin ; « 3 min » seul ne dit pas si c'est
                    plausible. Les deux se contrôlent mutuellement. */}
                <p className="text-sm text-neutral-700">
                  <span className="text-ink font-medium tabular-nums">
                    {arret.distanceM} m
                  </span>{" "}
                  · {arret.walkMin} {t.autourMinutes}{" "}
                  <span aria-hidden="true">🚶</span>
                </p>
              </div>

              {arret.lines.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {arret.lines.map((ligne) => (
                    <li
                      key={ligne.id}
                      className="text-ink rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-medium"
                    >
                      <span aria-hidden="true">{PICTOS[ligne.mode] ?? "•"}</span>{" "}
                      {/* Le mode est écrit en toutes lettres pour un lecteur
                          d'écran : « 14 » seul ne dit pas s'il s'agit d'un
                          métro ou d'un bus. */}
                      <span className="sr-only">
                        {LIBELLES_MODES[ligne.mode]}{" "}
                      </span>
                      {ligne.name}
                    </li>
                  ))}
                </ul>
              )}

              {arret.nextDeparture && (
                <p className="text-eco mt-3 text-sm font-medium">
                  {arret.nextDeparture.lineName}
                  {arret.nextDeparture.headsign && (
                    <span className="font-normal text-neutral-700">
                      {" → "}
                      {arret.nextDeparture.headsign}
                    </span>
                  )}{" "}
                  · {t.autourDans}{" "}
                  <span className="tabular-nums">
                    {arret.nextDeparture.waitMin}
                  </span>{" "}
                  {t.autourMinutes}
                </p>
              )}

              {/* ⚠️ AFFICHÉ SEULEMENT QUAND LA DONNÉE EXISTE. Sur ce point
                  précis, une information fausse ne cause pas un désagrément :
                  elle laisse quelqu'un devant un quai qu'il ne peut pas
                  atteindre. */}
              {arret.pmrAccessible && (
                <p className="mt-2 text-xs text-neutral-600">
                  <span aria-hidden="true">♿</span> {t.autourPmr}
                </p>
              )}

              <p className="mt-4">
                <Link
                  href={`/recherche?destination=${encodeURIComponent(arret.name)}&lat=${arret.latitude}&lon=${arret.longitude}`}
                  className="text-brand text-sm font-medium underline underline-offset-2"
                >
                  {t.autourAllerIci}
                </Link>
              </p>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
