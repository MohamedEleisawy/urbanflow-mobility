"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Spinner } from "@/components/Spinner";
import { messageDErreur } from "@/lib/api";
import {
  creerAdresse,
  listerAdresses,
  modifierAdresse,
  supprimerAdresse,
  type NouvelleAdresse,
} from "@/lib/adresses-api";
import type { FavoriteAddress, FavoriteAddressType } from "@/lib/types";

// =============================================================================
// Mes adresses favorites (bloc 7)
// =============================================================================
// Le dossier les demande dans l'espace personnel : « mémoriser des adresses
// favorites (Domicile, Travail) » (§3.2.1).
//
// ═══ DEUX EMPLACEMENTS, PAS UNE LISTE ═══
//
// Le backend borne le modèle à un Domicile et un Travail par compte
// (`@@unique([userId, type])`). L'écran le reflète : DEUX BLOCS FIXES,
// toujours visibles, chacun rempli ou vide. Ce n'est pas un choix graphique —
// c'est la seule représentation honnête d'un modèle à deux places.
//
// Une liste avec un bouton « ajouter » laisserait croire qu'on peut en créer
// une troisième, et le 409 du serveur serait vécu comme un bug.
//
// ═══ AUCUN GÉOCODAGE ═══
//
// Le projet n'appelle aucun service d'adresses, et cette étape n'en introduit
// pas. L'usager saisit donc le texte ET les coordonnées. C'est demandé de
// façon explicite plutôt que déguisé derrière un champ unique qui ne
// fonctionnerait pas.
// =============================================================================

/// Libellés français des deux emplacements. Le backend rend `HOME` / `WORK` ;
/// ces mots-là ne se montrent pas à un usager.
const LIBELLES: Record<FavoriteAddressType, string> = {
  HOME: "Domicile",
  WORK: "Travail",
};

/// Ordre d'affichage — le même que celui du backend, pour que l'écran ne
/// réorganise pas ce que l'API a déjà trié.
const EMPLACEMENTS: FavoriteAddressType[] = ["HOME", "WORK"];

export function AdressesFavorites() {
  const { jeton } = useAuth();

  const [adresses, setAdresses] = useState<FavoriteAddress[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!jeton) {
      return;
    }

    // `AbortController` : quitter la page avant la réponse annule la requête
    // plutôt que de la laisser aboutir dans le vide.
    const controleur = new AbortController();

    listerAdresses(jeton, controleur.signal)
      .then((liste) => {
        setAdresses(liste);
        setErreur(null);
      })
      .catch((echec: unknown) => {
        if (controleur.signal.aborted) return;
        setErreur(messageDErreur(echec));
      });

    return () => {
      controleur.abort();
    };
  }, [jeton]);

  /**
   * Remplace UNE adresse dans l'état local, sans recharger la liste.
   *
   * La réponse du serveur EST la vérité : `POST` et `PATCH` rendent la ligne
   * telle qu'elle vient d'être persistée. Redemander la liste entière
   * coûterait un aller-retour pour réapprendre ce qu'on vient d'apprendre —
   * même raisonnement qu'`appliquerPreferences` dans `AuthProvider` (5E).
   */
  const remplacer = (enregistree: FavoriteAddress) => {
    setAdresses((precedentes) => {
      const autres = (precedentes ?? []).filter((a) => a.type !== enregistree.type);
      return [...autres, enregistree];
    });
  };

  const retirer = (id: string) => {
    setAdresses((precedentes) => (precedentes ?? []).filter((a) => a.id !== id));
  };

  return (
    <section aria-labelledby="adresses-favorites">
      <h2 id="adresses-favorites" className="text-ink text-lg font-semibold">
        Mes adresses favorites
      </h2>
      <p className="mt-1 text-sm text-neutral-600">
        Enregistrez votre domicile et votre lieu de travail pour les retrouver d&apos;un clic dans
        la recherche d&apos;itinéraire.
      </p>

      <div className="mt-3">
        {erreur ? (
          <ErrorMessage title="Vos adresses n'ont pas pu être chargées">{erreur}</ErrorMessage>
        ) : !adresses ? (
          <Spinner label="Chargement de vos adresses…" />
        ) : (
          <div className="space-y-3">
            {EMPLACEMENTS.map((type) => (
              <Emplacement
                key={type}
                type={type}
                adresse={adresses.find((a) => a.type === type) ?? null}
                jeton={jeton}
                onEnregistree={remplacer}
                onSupprimee={retirer}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Un emplacement — Domicile ou Travail
// ---------------------------------------------------------------------------

/**
 * Où en est cet emplacement.
 *
 * `confirmation` n'existe QUE pour la suppression : enregistrer est
 * réversible, supprimer efface une saisie que l'usager devrait refaire.
 */
type Etat =
  | { statut: "repos" }
  | { statut: "edition" }
  | { statut: "envoi" }
  | { statut: "confirmation" }
  | { statut: "suppression" }
  | { statut: "echec"; message: string; pendantEdition: boolean };

function Emplacement({
  type,
  adresse,
  jeton,
  onEnregistree,
  onSupprimee,
}: {
  type: FavoriteAddressType;
  adresse: FavoriteAddress | null;
  jeton: string | null;
  onEnregistree: (adresse: FavoriteAddress) => void;
  onSupprimee: (id: string) => void;
}) {
  const [etat, setEtat] = useState<Etat>({ statut: "repos" });
  const annulerRef = useRef<HTMLButtonElement>(null);

  const enEdition =
    etat.statut === "edition" ||
    etat.statut === "envoi" ||
    (etat.statut === "echec" && etat.pendantEdition);
  const enConfirmation =
    etat.statut === "confirmation" ||
    etat.statut === "suppression" ||
    (etat.statut === "echec" && !etat.pendantEdition);
  const enCours = etat.statut === "envoi" || etat.statut === "suppression";

  useEffect(() => {
    // Le focus va sur ANNULER : sur une suppression, le geste par défaut au
    // clavier ne doit rien détruire. Même règle qu'en 5G et 6-6.
    if (etat.statut === "confirmation") {
      annulerRef.current?.focus();
    }
  }, [etat.statut]);

  const enregistrer = async (saisie: NouvelleAdresse) => {
    if (!jeton) {
      return;
    }

    setEtat({ statut: "envoi" });

    try {
      // MODIFIER si la place est déjà occupée, CRÉER sinon. Le type ne change
      // jamais ici : chaque bloc est fixé à son emplacement.
      const enregistree = adresse
        ? await modifierAdresse(jeton, adresse.id, saisie)
        : await creerAdresse(jeton, saisie);

      onEnregistree(enregistree);
      setEtat({ statut: "repos" });
    } catch (echec) {
      // La saisie reste à l'écran : l'usager peut corriger sans tout ressaisir.
      setEtat({
        statut: "echec",
        message: messageDErreur(echec),
        pendantEdition: true,
      });
    }
  };

  const supprimer = async () => {
    if (!jeton || !adresse) {
      return;
    }

    setEtat({ statut: "suppression" });

    try {
      await supprimerAdresse(jeton, adresse.id);
      onSupprimee(adresse.id);
      setEtat({ statut: "repos" });
    } catch (echec) {
      setEtat({
        statut: "echec",
        message: messageDErreur(echec),
        pendantEdition: false,
      });
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-ink font-medium">{LIBELLES[type]}</h3>

          {adresse ? (
            <>
              <p className="mt-1 text-sm break-words text-neutral-700">{adresse.address}</p>
              {/* Les coordonnées sont AFFICHÉES, pas cachées : ce sont elles
                  que la recherche utilise, et l'usager les a saisies
                  lui-même. Les masquer rendrait une erreur de saisie
                  indétectable. */}
              <p className="mt-1 text-xs text-neutral-500">
                {adresse.latitude}, {adresse.longitude}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-neutral-600">Aucune adresse enregistrée.</p>
          )}
        </div>

        {!enEdition && !enConfirmation && (
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEtat({ statut: "edition" })}
              aria-label={`${adresse ? "Modifier" : "Ajouter"} l'adresse ${LIBELLES[type]}`}
            >
              {adresse ? "Modifier" : "Ajouter"}
            </Button>

            {adresse && (
              <button
                type="button"
                onClick={() => setEtat({ statut: "confirmation" })}
                // Le libellé visible est court ; le nom accessible nomme
                // l'emplacement. Un `aria-label` plutôt qu'un `sr-only` —
                // c'est la leçon du bloc 6-6, où le calcul du nom accessible
                // rognait les espaces et collait les deux morceaux.
                aria-label={`Supprimer l'adresse ${LIBELLES[type]}`}
                className="rounded-md border border-neutral-300 px-5 py-2.5 text-sm font-medium text-red-800 transition-colors hover:bg-red-50"
              >
                Supprimer
              </button>
            )}
          </div>
        )}
      </div>

      {enEdition && (
        <Formulaire
          type={type}
          adresse={adresse}
          enCours={enCours}
          erreur={etat.statut === "echec" && etat.pendantEdition ? etat.message : null}
          onAnnuler={() => setEtat({ statut: "repos" })}
          onEnregistrer={(saisie) => void enregistrer(saisie)}
        />
      )}

      {enConfirmation && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="font-medium text-red-900">Supprimer votre adresse {LIBELLES[type]} ?</p>
          <p className="mt-1 text-sm text-red-800">
            Le raccourci disparaîtra de la recherche. Vous pourrez le recréer à tout moment.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              ref={annulerRef}
              type="button"
              disabled={enCours}
              onClick={() => setEtat({ statut: "repos" })}
              className="text-ink rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Annuler
            </button>
            <button
              type="button"
              // Empêche la double soumission : le second DELETE recevrait 404
              // et afficherait une erreur pour une suppression réussie.
              disabled={enCours}
              onClick={() => void supprimer()}
              aria-label={`Confirmer la suppression de l'adresse ${LIBELLES[type]}`}
              className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enCours ? "Suppression…" : "Confirmer"}
            </button>
          </div>

          {etat.statut === "echec" && !etat.pendantEdition && (
            <p role="alert" className="mt-3 text-sm text-red-900">
              <span className="font-medium">L&apos;adresse n&apos;a pas pu être supprimée.</span>{" "}
              {etat.message}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Formulaire de saisie
// ---------------------------------------------------------------------------

function Formulaire({
  type,
  adresse,
  enCours,
  erreur,
  onAnnuler,
  onEnregistrer,
}: {
  type: FavoriteAddressType;
  adresse: FavoriteAddress | null;
  enCours: boolean;
  erreur: string | null;
  onAnnuler: () => void;
  onEnregistrer: (saisie: NouvelleAdresse) => void;
}) {
  const idAdresse = useId();
  const idLat = useId();
  const idLng = useId();
  const idAide = useId();

  // Chaînes, et non nombres : un champ numérique vide vaut `""`, que
  // `Number("")` convertit en `0` — une coordonnée parfaitement valide au
  // large du golfe de Guinée. On garde donc le texte brut et on convertit
  // à la soumission, où l'on peut refuser le vide.
  const [saisie, setSaisie] = useState({
    address: adresse?.address ?? "",
    latitude: adresse ? String(adresse.latitude) : "",
    longitude: adresse ? String(adresse.longitude) : "",
  });
  const [invalide, setInvalide] = useState<string | null>(null);

  const modifier = (champ: keyof typeof saisie, valeur: string) =>
    setSaisie((precedent) => ({ ...precedent, [champ]: valeur }));

  const soumettre = (evenement: React.FormEvent) => {
    evenement.preventDefault();

    const latitude = Number(saisie.latitude);
    const longitude = Number(saisie.longitude);

    // VALIDATION MINIMALE, et le backend reste l'autorité. On n'attrape ici
    // que ce qui ferait partir une requête certainement refusée — un champ
    // vide, un texte non numérique, des bornes évidentes.
    if (!saisie.address.trim()) {
      setInvalide("Renseignez une adresse.");
      return;
    }
    if (saisie.latitude.trim() === "" || Number.isNaN(latitude)) {
      setInvalide("La latitude doit être un nombre.");
      return;
    }
    if (saisie.longitude.trim() === "" || Number.isNaN(longitude)) {
      setInvalide("La longitude doit être un nombre.");
      return;
    }
    if (latitude < -90 || latitude > 90) {
      setInvalide("La latitude doit être comprise entre -90 et 90.");
      return;
    }
    if (longitude < -180 || longitude > 180) {
      setInvalide("La longitude doit être comprise entre -180 et 180.");
      return;
    }

    setInvalide(null);
    // ⚠️ `address` est transmis TEL QUEL, sans rognage : le backend conserve
    // exactement ce qui lui est envoyé, et l'écran ne réécrit pas la saisie
    // de l'usager.
    onEnregistrer({ type, address: saisie.address, latitude, longitude });
  };

  return (
    <form
      onSubmit={soumettre}
      noValidate
      className="mt-4 space-y-4 border-t border-neutral-200 pt-4"
    >
      <div>
        <label htmlFor={idAdresse} className="text-ink block text-sm font-medium">
          Adresse
        </label>
        <input
          id={idAdresse}
          type="text"
          value={saisie.address}
          onChange={(e) => modifier("address", e.target.value)}
          maxLength={255}
          placeholder="12 rue des Lilas"
          className="focus:border-brand mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={idLat} className="text-ink block text-sm font-medium">
            Latitude
          </label>
          <input
            id={idLat}
            type="text"
            inputMode="decimal"
            value={saisie.latitude}
            onChange={(e) => modifier("latitude", e.target.value)}
            aria-describedby={idAide}
            placeholder="48.5834"
            className="focus:border-brand mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor={idLng} className="text-ink block text-sm font-medium">
            Longitude
          </label>
          <input
            id={idLng}
            type="text"
            inputMode="decimal"
            value={saisie.longitude}
            onChange={(e) => modifier("longitude", e.target.value)}
            aria-describedby={idAide}
            placeholder="7.7452"
            className="focus:border-brand mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* L'application ne géocode pas : il faut le DIRE, plutôt que laisser
          l'usager chercher pourquoi on lui demande des chiffres. */}
      <p id={idAide} className="text-xs text-neutral-600">
        Les coordonnées sont utilisées pour lancer la recherche d&apos;itinéraire.
        L&apos;application ne les devine pas à partir de l&apos;adresse : vous pouvez les relever
        sur une carte.
      </p>

      {invalide && (
        <p role="alert" className="text-sm text-red-800">
          {invalide}
        </p>
      )}

      {erreur && (
        <p role="alert" className="text-sm text-red-800">
          <span className="font-medium">L&apos;adresse n&apos;a pas pu être enregistrée.</span>{" "}
          {erreur}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="secondary" disabled={enCours} onClick={onAnnuler}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
