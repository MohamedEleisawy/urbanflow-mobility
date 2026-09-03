"use client";

import { useEffect, useId, useRef, useState } from "react";
import { messageDErreur } from "@/lib/api";
import { rechercherAdresses } from "@/lib/geocoding-api";
import type { AdresseTrouvee } from "@/lib/types";

// =============================================================================
// Champ de recherche d'adresse (Phase 3A)
// =============================================================================
// ═══ LA DISTINCTION QUI STRUCTURE TOUT CE FICHIER ═══
//
//   le TEXTE TAPÉ  ≠  le POINT SÉLECTIONNÉ
//
// L'usager tape « tour », voit des propositions, en choisit une : ce sont les
// COORDONNÉES de cette proposition qui comptent, jamais son texte. Confondre
// les deux serait la faute de conception classique de ce genre de champ —
// l'interface enverrait au moteur d'itinéraire des coordonnées qui ne
// correspondent plus à ce que l'usager lit à l'écran.
//
// D'où la règle centrale : **modifier le texte INVALIDE la sélection**. Le
// bouton « Rechercher » redevient alors inactif, et l'usager doit choisir de
// nouveau. C'est un cran plus strict que ce qu'on voit ailleurs, et c'est
// délibéré : mieux vaut redemander un clic que partir sur un mauvais point.
//
// ═══ POURQUOI UN DÉBOUNCE LONG ═══
//
// Nominatim est un service public gratuit, plafonné à une requête par
// seconde. Une recherche à chaque frappe le saturerait — et nous ferait
// bloquer, à juste titre. 700 ms après la dernière frappe : assez court pour
// paraître vivant, assez long pour qu'une saisie complète ne produise qu'un
// ou deux appels.
// =============================================================================

/**
 * Un point utilisable par le moteur d'itinéraire.
 *
 * `origine` sert uniquement à l'affichage — dire d'où vient ce point. Le
 * moteur, lui, ne reçoit que les coordonnées.
 */
export interface PointChoisi {
  label: string;
  latitude: number;
  longitude: number;
  /**
   * D'où vient ce point. Sert uniquement à l'affichage et à savoir si la
   * géolocalisation est encore pertinente — le moteur, lui, ne reçoit que les
   * coordonnées.
   *
   * `arret` : choisi d'un clic sur la carte.
   */
  origine: "adresse" | "favori" | "position" | "arret";
}

/// Délai après la dernière frappe avant d'interroger le serveur.
const DEBOUNCE_MS = 700;

/// En deçà, le backend refuse en 400 : autant ne pas partir.
const LONGUEUR_MINIMALE = 3;

type Etat =
  | { statut: "repos" }
  | { statut: "recherche" }
  | { statut: "resultats"; items: AdresseTrouvee[]; attribution: string }
  | { statut: "echec"; message: string };

export function ChampAdresse({
  libelle,
  placeholder,
  valeur,
  onChoisir,
  actions,
}: {
  libelle: string;
  placeholder: string;
  /** Point actuellement retenu, ou `null` si rien n'est sélectionné. */
  valeur: PointChoisi | null;
  /**
   * Appelé avec le point choisi, ou `null` dès que la sélection cesse d'être
   * valable. Le parent ne doit JAMAIS conserver un point après un `null`.
   */
  onChoisir: (point: PointChoisi | null) => void;
  /** Boutons secondaires — « Ma position », favoris. Rendus sous le champ. */
  actions?: React.ReactNode;
}) {
  const idChamp = useId();
  const idListe = useId();
  const idEtat = useId();

  const [texte, setTexte] = useState(valeur?.label ?? "");
  const [etat, setEtat] = useState<Etat>({ statut: "repos" });
  const [ouvert, setOuvert] = useState(false);
  const [surligne, setSurligne] = useState(-1);

  const conteneur = useRef<HTMLDivElement>(null);

  // Le parent peut imposer une valeur — un favori, la position GPS. Le champ
  // s'aligne alors sur elle, sans relancer de recherche.
  //
  // ⚠️ AJUSTÉ PENDANT LE RENDU, et non dans un effet. C'est le motif que la
  // documentation de React prescrit pour « réagir au changement d'une prop » :
  // un effet déclencherait un second rendu visible, et le compilateur React
  // l'interdit (`react-hooks/set-state-in-effect`) — la même règle qui avait
  // déjà orienté `AuthProvider` (5A-3).
  const [valeurVue, setValeurVue] = useState(valeur);

  if (valeur !== valeurVue) {
    setValeurVue(valeur);

    if (valeur) {
      setTexte(valeur.label);
      setEtat({ statut: "repos" });
      setOuvert(false);
    }
  }

  // --- Recherche différée ---------------------------------------------------
  useEffect(() => {
    const saisie = texte.trim();

    // Rien à chercher : ni requête, ni liste ouverte. Une sélection en place
    // signifie que le texte affiché EST celle-ci — on ne la recherche pas.
    //
    // ⚠️ On se contente de NE RIEN PLANIFIER. La remise à l'état de repos est
    // faite par `modifierTexte`, c'est-à-dire dans le gestionnaire
    // d'événement : appeler `setEtat` ici déclencherait un rendu en cascade.
    if (saisie.length < LONGUEUR_MINIMALE || valeur?.label === texte) {
      return;
    }

    const controleur = new AbortController();
    const minuteur = setTimeout(() => {
      setEtat({ statut: "recherche" });

      rechercherAdresses(saisie, controleur.signal)
        .then((reponse) => {
          if (controleur.signal.aborted) return;
          setEtat({
            statut: "resultats",
            items: reponse.items,
            attribution: reponse.attribution,
          });
          setOuvert(true);
          setSurligne(-1);
        })
        .catch((echec: unknown) => {
          if (controleur.signal.aborted) return;
          setEtat({ statut: "echec", message: messageDErreur(echec) });
          setOuvert(true);
        });
    }, DEBOUNCE_MS);

    return () => {
      // Une frappe de plus annule la requête précédente : elle ne servirait
      // qu'à afficher des propositions périmées.
      clearTimeout(minuteur);
      controleur.abort();
    };
  }, [texte, valeur]);

  // Un clic hors du champ referme la liste, comme n'importe quel menu.
  useEffect(() => {
    if (!ouvert) return;

    const auClic = (evenement: MouseEvent) => {
      if (!conteneur.current?.contains(evenement.target as Node)) {
        setOuvert(false);
      }
    };

    document.addEventListener("mousedown", auClic);
    return () => document.removeEventListener("mousedown", auClic);
  }, [ouvert]);

  const items = etat.statut === "resultats" ? etat.items : [];

  const modifierTexte = (nouveau: string) => {
    setTexte(nouveau);

    // Sous le seuil, il n'y aura aucune recherche : on efface donc les
    // propositions précédentes ici même, plutôt que dans l'effet.
    if (nouveau.trim().length < LONGUEUR_MINIMALE) {
      setEtat({ statut: "repos" });
      setOuvert(false);
    }

    // ⚠️ LA RÈGLE CENTRALE. Toucher au texte périme la sélection : sans cela,
    // on pourrait lancer une recherche vers « Tour Eiffel » en affichant
    // « Gare du N » dans le champ.
    if (valeur) {
      onChoisir(null);
    }
  };

  const selectionner = (item: AdresseTrouvee) => {
    onChoisir({ ...item, origine: "adresse" });
    setTexte(item.label);
    setOuvert(false);
    setEtat({ statut: "repos" });
  };

  const auClavier = (evenement: React.KeyboardEvent<HTMLInputElement>) => {
    if (evenement.key === "Escape") {
      setOuvert(false);
      return;
    }

    if (!ouvert || items.length === 0) {
      return;
    }

    if (evenement.key === "ArrowDown") {
      evenement.preventDefault();
      setSurligne((precedent) => (precedent + 1) % items.length);
      return;
    }

    if (evenement.key === "ArrowUp") {
      evenement.preventDefault();
      setSurligne((precedent) => (precedent <= 0 ? items.length - 1 : precedent - 1));
      return;
    }

    if (evenement.key === "Enter" && surligne >= 0) {
      // `preventDefault` : sans lui, la touche soumettrait le formulaire de
      // recherche alors que l'usager voulait seulement choisir une adresse.
      evenement.preventDefault();
      selectionner(items[surligne]);
    }
  };

  return (
    <div ref={conteneur} className="relative">
      <label htmlFor={idChamp} className="text-ink block text-sm font-medium">
        {libelle}
      </label>

      <input
        id={idChamp}
        type="text"
        value={texte}
        onChange={(e) => modifierTexte(e.target.value)}
        onKeyDown={auClavier}
        onFocus={() => items.length > 0 && setOuvert(true)}
        placeholder={placeholder}
        autoComplete="off"
        // `combobox` + `listbox` : le motif ARIA d'un champ à propositions.
        // Il est écrit à la main parce qu'aucun élément HTML natif ne fait
        // « saisie libre AVEC suggestions distantes » — `<datalist>` s'en
        // approche mais ne permet ni état de chargement, ni message d'erreur,
        // ni sélection au clavier maîtrisée.
        role="combobox"
        aria-expanded={ouvert}
        aria-controls={idListe}
        aria-autocomplete="list"
        aria-activedescendant={surligne >= 0 ? `${idListe}-${surligne}` : undefined}
        aria-describedby={idEtat}
        className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-3 text-base outline-none"
      />

      {/* État annoncé aux lecteurs d'écran ET visible : « 3 propositions »
          n'a pas à être deviné en parcourant la liste. */}
      <p id={idEtat} role="status" className="mt-1 text-xs text-neutral-600">
        {etat.statut === "recherche" && "Recherche en cours…"}
        {etat.statut === "resultats" &&
          (etat.items.length === 0
            ? "Aucun lieu ne correspond. Essayez une autre formulation."
            : `${etat.items.length} proposition${etat.items.length > 1 ? "s" : ""}.`)}
        {etat.statut === "echec" && etat.message}
        {etat.statut === "repos" &&
          (valeur
            ? `Lieu retenu : ${valeur.label}.`
            : "Saisissez au moins trois caractères, puis choisissez une proposition.")}
      </p>

      {ouvert && etat.statut === "resultats" && etat.items.length > 0 && (
        <ul
          id={idListe}
          role="listbox"
          aria-label={`Propositions pour ${libelle}`}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-neutral-300 bg-white shadow-lg"
        >
          {etat.items.map((item, index) => (
            <li
              key={`${item.latitude},${item.longitude},${item.label}`}
              id={`${idListe}-${index}`}
              role="option"
              aria-selected={index === surligne}
              // `onMouseDown` et non `onClick` : le clic ferait d'abord
              // perdre le focus au champ, ce qui refermerait la liste avant
              // que la sélection n'aboutisse.
              onMouseDown={(e) => {
                e.preventDefault();
                selectionner(item);
              }}
              onMouseEnter={() => setSurligne(index)}
              className={`cursor-pointer px-3 py-3 text-sm ${
                index === surligne ? "bg-brand/10 text-brand" : "text-ink"
              }`}
            >
              {item.label}
            </li>
          ))}

          {/* Attribution imposée par la licence des données. Elle vient du
              serveur : le jour où le fournisseur change, elle change avec. */}
          <li
            aria-hidden="true"
            className="border-t border-neutral-200 px-3 py-2 text-xs text-neutral-500"
          >
            {etat.attribution}
          </li>
        </ul>
      )}

      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
