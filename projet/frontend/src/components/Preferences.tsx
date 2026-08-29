"use client";

import { useId, useState, type FormEvent } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import { formaterCo2 } from "@/lib/format";
import { enregistrerPreferences, type MiseAJourPreferences } from "@/lib/preferences-api";
import type {
  LanguagePreference,
  ThemePreference,
  TransportMode,
  User,
  UserPreferences,
} from "@/lib/types";

// =============================================================================
// Préférences de mobilité (bloc 5E-3)
// =============================================================================
// AUCUN APPEL DE LECTURE ICI. `GET /api/users/me` renvoie déjà les
// préférences, et `AuthProvider` a chargé ce profil au démarrage : les valeurs
// affichées viennent de `useAuth().utilisateur.preferences`. Refaire une
// requête pour une donnée déjà en mémoire coûterait un aller-retour et
// créerait une seconde source de vérité.
//
// SIX CHAMPS, PAS UN DE PLUS — exactement les colonnes de `UserPreferences`.
// Aucune préférence n'est inventée.
// =============================================================================

/// Libellés français des modes. La VALEUR envoyée reste l'énumération du
/// backend : traduire l'affichage ne doit jamais traduire les données.
const MODES: { valeur: TransportMode; libelle: string }[] = [
  { valeur: "WALK", libelle: "Marche" },
  { valeur: "BIKE", libelle: "Vélo" },
  { valeur: "BUS", libelle: "Bus" },
  { valeur: "TRAM", libelle: "Tram" },
  { valeur: "METRO", libelle: "Métro" },
  { valeur: "ESCOOTER", libelle: "Trottinette" },
  { valeur: "CAR", libelle: "Voiture" },
];

const THEMES: { valeur: ThemePreference; libelle: string }[] = [
  { valeur: "SYSTEM", libelle: "Comme mon appareil" },
  { valeur: "LIGHT", libelle: "Clair" },
  { valeur: "DARK", libelle: "Sombre" },
];

const LANGUES: { valeur: LanguagePreference; libelle: string }[] = [
  { valeur: "FR", libelle: "Français" },
  { valeur: "EN", libelle: "Anglais" },
];

/**
 * Où en est l'enregistrement.
 *
 * « succes » n'est atteint QU'APRÈS la réponse HTTP : afficher une
 * confirmation avant reviendrait à promettre ce qu'on ne sait pas encore.
 */
type EtatEnvoi =
  | { statut: "repos" }
  | { statut: "envoi" }
  | { statut: "succes" }
  | { statut: "echec"; message: string };

/// Valeurs du formulaire. Le budget est une CHAÎNE : un champ numérique vidé
/// ne vaut pas zéro, et confondre les deux effacerait un objectif.
interface Saisie {
  co2BudgetWeekly: string;
  preferredModes: TransportMode[];
  pmrMode: boolean;
  notificationsEnabled: boolean;
  language: LanguagePreference;
  theme: ThemePreference;
}

/**
 * Traduit les préférences du serveur en valeurs de formulaire.
 *
 * ⚠️ `?? ""` ET NON `|| ""` sur le budget : **zéro est une valeur**. Un
 * objectif « zéro émission » est parfaitement légitime, et `||` le
 * transformerait en champ vide — l'usager verrait son objectif disparaître à
 * chaque affichage.
 */
function versSaisie(preferences: UserPreferences | null): Saisie {
  return {
    co2BudgetWeekly:
      preferences?.co2BudgetWeekly === undefined ? "" : String(preferences.co2BudgetWeekly),
    preferredModes: preferences?.preferredModes ?? [],
    pmrMode: preferences?.pmrMode ?? false,
    notificationsEnabled: preferences?.notificationsEnabled ?? true,
    language: preferences?.language ?? "FR",
    theme: preferences?.theme ?? "SYSTEM",
  };
}

/**
 * Attend que le profil soit chargé, PUIS monte le formulaire.
 *
 * ⚠️ CE GARDE N'EST PAS DÉCORATIF, ET LE BUG QU'IL CORRIGE EST INSTRUCTIF.
 * `AuthProvider` résout `GET /users/me` de façon asynchrone : au tout premier
 * rendu, `utilisateur` est encore `null`. Un formulaire initialisé à ce
 * moment-là — même avec un `useState` paresseux — se remplirait de valeurs
 * vides et ne se corrigerait JAMAIS, l'initialisation ne se rejouant pas.
 *
 * La parade idiomatique n'est pas un effet de synchronisation, qui écraserait
 * une saisie en cours : c'est de ne monter le formulaire qu'une fois la donnée
 * disponible. La `key` le remonte si l'usager change — une session ne doit
 * jamais hériter des réglages de la précédente.
 */
export function Preferences() {
  const { utilisateur } = useAuth();

  if (!utilisateur) {
    return (
      <section aria-labelledby="preferences">
        <h2 id="preferences" className="text-ink text-lg font-semibold">
          Mes préférences
        </h2>
        <div className="mt-3">
          <Spinner label="Chargement de vos préférences…" />
        </div>
      </section>
    );
  }

  return <FormulairePreferences key={utilisateur.id} utilisateur={utilisateur} />;
}

function FormulairePreferences({ utilisateur }: { utilisateur: User }) {
  const { jeton, appliquerPreferences } = useAuth();

  // Initialisation paresseuse SÛRE : le composant parent garantit que le
  // profil est chargé avant ce montage. Aucun effet de synchronisation n'est
  // donc nécessaire — et il serait nuisible, puisqu'il écraserait une saisie
  // en cours à chaque changement du profil.
  const [saisie, setSaisie] = useState<Saisie>(() => versSaisie(utilisateur.preferences));
  const [etat, setEtat] = useState<EtatEnvoi>({ statut: "repos" });

  const idBudget = useId();
  const idBudgetAide = useId();
  const idModes = useId();
  const idLangue = useId();
  const idTheme = useId();

  const premiereFois = !utilisateur.preferences;
  const enCours = etat.statut === "envoi";

  // Le budget est le seul champ sans valeur par défaut côté Prisma : le
  // backend REFUSE de créer des préférences sans lui, et refuse d'en inventer
  // un. On valide donc avant d'envoyer, plutôt que d'aller chercher un 400.
  const budget = Number(saisie.co2BudgetWeekly);
  const budgetVide = saisie.co2BudgetWeekly.trim() === "";
  const budgetInvalide = !budgetVide && (Number.isNaN(budget) || budget < 0);
  const budgetManquant = premiereFois && budgetVide;
  const peutEnvoyer = !enCours && !budgetInvalide && !budgetManquant;

  // DEUX MESSAGES, DEUX TONS — et la distinction n'est pas cosmétique.
  //
  // Un budget INVALIDE fait suite à une saisie : c'est une erreur, elle est
  // annoncée comme telle (`role="alert"`).
  //
  // Un budget ABSENT sur un compte neuf, en revanche, n'est la faute de
  // personne : l'usager vient d'arriver et n'a rien tapé. Le crier en rouge
  // avant le moindre geste serait agressif et le ferait douter d'un bug. On
  // l'explique donc comme une CONSIGNE, sans rôle live.
  const erreurBudget = budgetInvalide ? "Indiquez un nombre positif de grammes." : null;
  const consigneBudget = budgetManquant
    ? "Renseignez ce champ pour créer vos préférences : il n'a pas de valeur par défaut."
    : null;

  const basculerMode = (mode: TransportMode) => {
    setSaisie((precedente) => ({
      ...precedente,
      preferredModes: precedente.preferredModes.includes(mode)
        ? precedente.preferredModes.filter((m) => m !== mode)
        : [...precedente.preferredModes, mode],
    }));
    // Toute modification efface la confirmation précédente : laisser
    // « Préférences enregistrées » à l'écran pendant qu'on change un champ
    // laisserait croire que le changement est déjà sauvegardé.
    setEtat({ statut: "repos" });
  };

  const modifier = <C extends keyof Saisie>(champ: C, valeur: Saisie[C]) => {
    setSaisie((precedente) => ({ ...precedente, [champ]: valeur }));
    setEtat({ statut: "repos" });
  };

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();

    if (!jeton || !peutEnvoyer) {
      return;
    }

    setEtat({ statut: "envoi" });

    const modifications: MiseAJourPreferences = {
      preferredModes: saisie.preferredModes,
      pmrMode: saisie.pmrMode,
      notificationsEnabled: saisie.notificationsEnabled,
      language: saisie.language,
      theme: saisie.theme,
      // Omis quand le champ est vide ET que des préférences existent déjà :
      // un PATCH ne décrit que ce qui change, et envoyer `NaN` serait refusé.
      ...(budgetVide ? {} : { co2BudgetWeekly: budget }),
    };

    try {
      const enregistrees = await enregistrerPreferences(jeton, modifications);

      // LA RÉPONSE FAIT FOI. Le serveur peut avoir appliqué des valeurs par
      // défaut du schéma à la création : on réaffiche ce qu'il a retenu, pas
      // ce qu'on croyait avoir envoyé.
      setSaisie(versSaisie(enregistrees));
      appliquerPreferences(enregistrees);
      setEtat({ statut: "succes" });
    } catch (echec) {
      // LES VALEURS SAISIES RESTENT À L'ÉCRAN : `setSaisie` n'est pas
      // touché. Les remettre à leur état d'origine ferait perdre à l'usager
      // tout ce qu'il vient de taper, en punition d'une panne réseau.
      setEtat({ statut: "echec", message: messageDErreur(echec) });
    }
  };

  return (
    <section aria-labelledby="preferences">
      <h2 id="preferences" className="text-ink text-lg font-semibold">
        Mes préférences
      </h2>

      <div className="mt-3">
        <Card>
          <form onSubmit={(e) => void soumettre(e)} noValidate className="space-y-6">
            {/* --- Budget carbone ------------------------------------- */}
            <div>
              <label htmlFor={idBudget} className="text-ink block text-sm font-medium">
                Budget carbone hebdomadaire
              </label>
              <input
                id={idBudget}
                type="number"
                inputMode="numeric"
                min={0}
                step={100}
                value={saisie.co2BudgetWeekly}
                onChange={(e) => modifier("co2BudgetWeekly", e.target.value)}
                aria-describedby={idBudgetAide}
                aria-invalid={erreurBudget !== null}
                className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none sm:w-64"
              />
              <p id={idBudgetAide} className="mt-1.5 text-sm text-neutral-600">
                {/* L'UNITÉ EST ÉCRITE, PAS DEVINÉE. Le backend stocke des
                    GRAMMES : la saisie est donc en grammes, et l'équivalent
                    en kilogrammes n'est affiché qu'à titre indicatif, une
                    fois le nombre valide. */}
                En grammes de CO₂ par semaine
                {!budgetVide && !budgetInvalide && <> — soit {formaterCo2(budget)}</>}.
              </p>
              {consigneBudget && (
                // Ni rouge, ni `role="alert"` : une consigne, pas un reproche.
                <p className="mt-1 text-sm text-neutral-700">{consigneBudget}</p>
              )}

              {erreurBudget && (
                // Celle-ci suit forcément une saisie : elle est annoncée
                // immédiatement, car c'est elle qui bloque l'envoi.
                <p role="alert" className="mt-1 text-sm text-red-800">
                  {erreurBudget}
                </p>
              )}
            </div>

            {/* --- Modes favoris --------------------------------------- */}
            <fieldset>
              {/* `fieldset`/`legend` et non un simple titre : c'est ce qui
                  fait annoncer « Modes de transport favoris » avant chaque
                  case à un lecteur d'écran. */}
              <legend id={idModes} className="text-ink text-sm font-medium">
                Modes de transport favoris
              </legend>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                {MODES.map(({ valeur, libelle }) => (
                  <label key={valeur} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={saisie.preferredModes.includes(valeur)}
                      onChange={() => basculerMode(valeur)}
                      className="accent-brand h-4 w-4"
                    />
                    {libelle}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* --- Options ------------------------------------------- */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saisie.pmrMode}
                  onChange={(e) => modifier("pmrMode", e.target.checked)}
                  className="accent-brand h-4 w-4"
                />
                Privilégier les arrêts accessibles en fauteuil roulant
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saisie.notificationsEnabled}
                  onChange={(e) => modifier("notificationsEnabled", e.target.checked)}
                  className="accent-brand h-4 w-4"
                />
                Recevoir les notifications de perturbation
              </label>
            </div>

            {/* --- Affichage ------------------------------------------ */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={idTheme} className="text-ink block text-sm font-medium">
                  Thème
                </label>
                <select
                  id={idTheme}
                  value={saisie.theme}
                  onChange={(e) => modifier("theme", e.target.value as ThemePreference)}
                  className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none"
                >
                  {THEMES.map(({ valeur, libelle }) => (
                    <option key={valeur} value={valeur}>
                      {libelle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor={idLangue} className="text-ink block text-sm font-medium">
                  Langue
                </label>
                <select
                  id={idLangue}
                  value={saisie.language}
                  onChange={(e) => modifier("language", e.target.value as LanguagePreference)}
                  className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none"
                >
                  {LANGUES.map(({ valeur, libelle }) => (
                    <option key={valeur} value={valeur}>
                      {libelle}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/*
              HONNÊTETÉ SUR CE QUI N'EST PAS ENCORE FAIT.

              Le modèle porte `theme` et `language`, et le choix est bel et
              bien enregistré. Mais l'application n'a AUCUNE traduction et
              AUCUN thème sombre : `globals.css` le dit noir sur blanc.
              Laisser croire le contraire serait un mensonge d'interface —
              l'usager choisirait « Anglais », ne verrait rien changer, et
              conclurait que l'application est cassée.
            */}
            <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
              <span className="font-medium">Ces deux réglages sont enregistrés</span> mais ne
              modifient pas encore l&apos;affichage : le thème sombre et la traduction anglaise ne
              sont pas encore réalisés.
            </p>

            {/* --- Envoi ---------------------------------------------- */}
            <div className="flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:flex-row sm:items-center">
              <Button
                type="submit"
                // Désactivé pendant l'envoi : sans cela, un double clic
                // lancerait deux PATCH concurrents, et la réponse la plus
                // lente écraserait la plus rapide.
                disabled={!peutEnvoyer}
                className="w-full sm:w-auto"
              >
                {enCours ? "Enregistrement…" : "Enregistrer les préférences"}
              </Button>

              {/* PAS d'`aria-live` SUR CE CONTENEUR. `role="status"` et
                  `role="alert"` SONT déjà des zones live : les imbriquer
                  ferait annoncer chaque message deux fois, une fois poliment
                  et une fois par-dessus la lecture en cours. C'est l'erreur
                  commise puis corrigée au bloc 5C-3.

                  `status` pour un succès — il n'interrompt pas — et `alert`
                  pour un échec, qui doit être entendu tout de suite. */}
              <div className="text-sm">
                {etat.statut === "succes" && (
                  <p role="status" className="text-eco font-medium">
                    ✓ Préférences enregistrées.
                  </p>
                )}
                {etat.statut === "echec" && (
                  <p role="alert" className="text-red-800">
                    <span className="font-medium">Échec de l&apos;enregistrement.</span>{" "}
                    {etat.message}
                  </p>
                )}
              </div>
            </div>
          </form>
        </Card>
      </div>
    </section>
  );
}
