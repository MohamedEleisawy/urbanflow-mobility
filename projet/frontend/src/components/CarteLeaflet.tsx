"use client";

import { useEffect, useRef } from "react";
import type { Map as CarteLeafletType, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CENTRE_DEFAUT, type PointCarte, type TronconTrace } from "@/lib/carte";
import type { TransportMode } from "@/lib/types";
import type { VelibStation } from "@/lib/velib-api";

// =============================================================================
// Rendu Leaflet (bloc 5B)
// =============================================================================
// LE SEUL FICHIER QUI CONNAÎT LEAFLET. Il n'est jamais importé directement par
// une page : `Carte.tsx` le charge dynamiquement, sans rendu serveur. Leaflet
// touche `window` dès son import — le charger côté serveur ferait échouer le
// prérendu.
//
// AUCUN APPEL RÉSEAU ICI, et aucune logique métier : ce composant reçoit des
// points déjà résolus et se contente de les dessiner. La couche API
// (`itineraires-api.ts`) reste la seule à parler au backend.
// =============================================================================

/// Marqueurs dessinés, jamais des images : un cercle vectoriel évite les
/// quatre requêtes PNG des icônes Leaflet par défaut (et leur résolution
/// d'URL, cassée par tous les empaqueteurs). Moins d'octets, moins de code.
const RAYON_ARRET = 5;
const RAYON_ETAPE = 7;
const RAYON_VELIB = 6;

/// Couleurs du thème (`globals.css`) : Leaflet dessine en SVG et n'a pas accès
/// aux classes Tailwind.
const BLEU = "#1e3a5f";
const VERT = "#2d7d46";

/**
 * Couleur des stations Vélib'.
 *
 * Volontairement DISTINCTE du bleu des arrêts de transport : les deux couches
 * coexistent sur la même carte, et rien ne doit laisser croire qu'une station
 * de vélos est un arrêt desservi par le moteur d'itinéraires — il ne l'est
 * pas, le routage cyclable n'existe pas dans nos données.
 */
const VELIB = "#0f766e";

/// Position de l'usager. Rouge : c'est le seul point qui le concerne LUI.
const POSITION = "#b91c1c";

/**
 * Couleur de chaque mode de transport.
 *
 * ⚠️ CE SONT DES COULEURS D'INTERFACE, PAS LES COULEURS OFFICIELLES DES
 * LIGNES. Le flux GTFS publie bien un `route_color` par ligne, mais nous ne
 * l'importons pas : afficher un vert « RER D » approximatif serait pire que
 * d'assumer une palette qui distingue les MODES. Le jour où `route_color`
 * sera importé, c'est cette table qui devra céder la place.
 *
 * La marche est volontairement grise et discrète : c'est le liant du trajet,
 * pas son sujet.
 */
const COULEURS_MODES: Record<TransportMode, string> = {
  WALK: "#6b7280",
  BUS: "#b45309",
  TRAM: "#0f766e",
  METRO: "#1e3a5f",
  TRAIN: "#6d28d9",
  BIKE: "#2d7d46",
  ESCOOTER: "#be185d",
  CAR: "#991b1b",
};

/** Rôle donné à un arrêt choisi sur la carte. */
export type RoleArret = "depart" | "arrivee";

export interface CarteLeafletProps {
  /** Arrêts affichés en fond. */
  arrets: readonly PointCarte[];
  /** Étapes du trajet mis en avant, dans l'ordre — ou `null` s'il n'y en a pas. */
  trace: readonly PointCarte[] | null;
  /**
   * Tracés réels du trajet, un par segment (Phase 4).
   *
   * ⚠️ QUAND ILS SONT FOURNIS, ILS REMPLACENT la polyligne reliant les
   * `trace` en droite. Chacun porte son mode — donc sa couleur — et sa
   * provenance : un tronçon `STRAIGHT` est dessiné en POINTILLÉS, parce qu'il
   * ne représente pas le chemin réel du véhicule.
   */
  troncons?: readonly TronconTrace[] | null;

  /**
   * Appelé quand l'usager choisit un arrêt comme départ ou comme arrivée.
   *
   * Absent = les arrêts ne sont pas cliquables (cas de l'historique, où le
   * trajet est déjà figé).
   */
  onChoisirArret?: (arret: PointCarte, role: RoleArret) => void;

  /**
   * Appelé après un déplacement ou un zoom, avec le nouveau centre.
   *
   * ⚠️ Sert à recharger les arrêts visibles. `GET /api/stops` étant borné, la
   * carte ne peut pas montrer tout le réseau : elle montre ce qui entoure ce
   * qu'on regarde.
   */
  onCentreDeplace?: (latitude: number, longitude: number) => void;

  /**
   * Stations Vélib' à dessiner, ou `null` si la couche est masquée.
   *
   * ⚠️ ELLES NE SONT PAS DES ARRÊTS. Elles ne sont pas cliquables pour définir
   * un départ ou une arrivée : le moteur d'itinéraires ne sait pas router à
   * vélo, et proposer « partir d'ici » depuis une station donnerait un trajet
   * à pied déguisé en trajet cyclable.
   */
  velib?: readonly VelibStation[] | null;

  /**
   * Position de l'usager, ou `null` si elle n'est pas suivie.
   *
   * `accuracyM` dessine un cercle d'incertitude. ⚠️ `null` = l'appareil ne
   * l'annonce pas : on ne dessine alors AUCUN cercle, plutôt qu'un cercle
   * inventé qui donnerait une fausse impression de précision.
   */
  position?: {
    latitude: number;
    longitude: number;
    accuracyM: number | null;
  } | null;

  /**
   * La carte doit-elle suivre la position ?
   *
   * ⚠️ SÉPARÉ DE `position`, et c'est essentiel : l'usager doit pouvoir
   * déplacer la carte pour regarder plus loin sans que le prochain relevé GPS
   * ne la ramène de force sous ses pieds.
   */
  suivrePosition?: boolean;
}

/**
 * Contenu du popup d'un arrêt : son nom, et deux façons de s'en servir.
 *
 * ⚠️ CONSTRUIT AVEC `textContent`, JAMAIS `innerHTML`. Les noms d'arrêts
 * viennent du flux GTFS de l'opérateur — une donnée extérieure. Les injecter
 * comme du HTML ouvrirait une faille XSS sur une chaîne que nous ne
 * contrôlons pas.
 */
function construirePopup(
  arret: PointCarte,
  onChoisir: (role: RoleArret) => void,
): HTMLElement {
  const contenu = document.createElement("div");
  contenu.className = "space-y-2";

  const nom = document.createElement("p");
  nom.className = "font-semibold";
  nom.textContent = arret.nom;
  contenu.append(nom);

  const boutons = document.createElement("div");
  boutons.className = "flex gap-2";

  const bouton = (libelle: string, role: RoleArret) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = libelle;
    element.className =
      "rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium hover:bg-neutral-50";
    // Le nom de l'arrêt est déjà dans le popup, mais un lecteur d'écran qui
    // parcourt les boutons hors contexte n'entendrait que « Aller ici ».
    element.setAttribute("aria-label", `${libelle} : ${arret.nom}`);
    element.addEventListener("click", () => onChoisir(role));
    return element;
  };

  boutons.append(bouton("Partir d'ici", "depart"), bouton("Aller ici", "arrivee"));
  contenu.append(boutons);

  return contenu;
}

/**
 * Contenu du popup d'une station Vélib'.
 *
 * ⚠️ « INDISPONIBLE » N'EST PAS « 0 ». Le flux publie parfois une station sans
 * état ; écrire « 0 vélo » ferait renoncer quelqu'un qui aurait pu en trouver.
 * On distingue donc soigneusement les deux, ici comme dans le contrat backend.
 *
 * ⚠️ Construit avec `textContent`, jamais `innerHTML` : les noms de stations
 * viennent du flux de l'exploitant, une donnée extérieure.
 */
function construirePopupVelib(station: VelibStation): HTMLElement {
  const contenu = document.createElement("div");
  contenu.className = "space-y-1";

  const nom = document.createElement("p");
  nom.className = "font-semibold";
  nom.textContent = station.name;
  contenu.append(nom);

  const ligne = (texte: string) => {
    const p = document.createElement("p");
    p.className = "text-xs";
    p.textContent = texte;
    return p;
  };

  const compte = (valeur: number | null, libelle: string) =>
    valeur === null ? `${libelle} : indisponible` : `${libelle} : ${valeur}`;

  contenu.append(
    ligne(compte(station.mechanical, "🚲 Mécaniques")),
    ligne(compte(station.electric, "⚡ Électriques")),
    ligne(compte(station.docksAvailable, "🅿 Places libres")),
  );

  if (station.isRenting === false) {
    contenu.append(ligne("⚠ Station hors service pour la location"));
  }

  // ⚠️ LA FRAÎCHEUR EST TOUJOURS DITE. Sans elle, une donnée d'il y a une
  // heure serait indiscernable d'une donnée de l'instant.
  if (station.freshness === "REALTIME" && station.lastReported !== null) {
    const heure = new Date(station.lastReported).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    contenu.append(ligne(`Actualisé à ${heure}`));
  } else {
    contenu.append(ligne("Disponibilité non horodatée"));
  }

  return contenu;
}

export default function CarteLeaflet({
  arrets,
  trace,
  troncons = null,
  onChoisirArret,
  onCentreDeplace,
  velib = null,
  position = null,
  suivrePosition = false,
}: CarteLeafletProps) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteLeafletType | null>(null);
  const couche = useRef<LayerGroup | null>(null);
  /// Arrete l'observateur de redimensionnement au demontage.
  const nettoyage = useRef<(() => void) | null>(null);

  /**
   * Les rappels, tenus dans des références.
   *
   * ⚠️ POURQUOI PAS DIRECTEMENT DANS LES DÉPENDANCES DE L'EFFET. Une fonction
   * fléchée écrite dans le rendu du parent change d'identité à chaque rendu.
   * La mettre en dépendance ferait redessiner toute la carte à chaque frappe
   * dans le formulaire — et, comme le déplacement recharge les arrêts, cela
   * boucherait. La référence garde le rappel À JOUR sans le faire entrer dans
   * les dépendances.
   */
  const choisirArret = useRef(onChoisirArret);
  const centreDeplace = useRef(onCentreDeplace);

  // ⚠️ MISE À JOUR APRÈS LE RENDU, jamais pendant. Le compilateur React
  // interdit d'écrire dans une référence pendant le rendu
  // (`react-hooks/refs`), et pour une bonne raison : un rendu doit être pur et
  // rejouable. Cet effet n'a volontairement AUCUN tableau de dépendances — il
  // doit s'exécuter après chaque rendu pour que les rappels restent frais.
  useEffect(() => {
    choisirArret.current = onChoisirArret;
    centreDeplace.current = onCentreDeplace;
  });

  // --- Création de la carte, une seule fois --------------------------------
  useEffect(() => {
    let annule = false;
    const element = conteneur.current;
    if (!element) return;

    // Import à l'exécution : le module n'entre dans le paquet client que
    // lorsque la carte est réellement montée (objectif Green IT du dossier).
    void import("leaflet").then((L) => {
      if (annule || !element || carte.current) return;

      const instance = L.map(element, {
        center: CENTRE_DEFAUT,
        zoom: 12,
        // La molette fait defiler la page, pas la carte, tant qu'on n'a pas cliqué
        // dedans : sans cela, un défilement au doigt sur mobile reste piégé.
        scrollWheelZoom: false,
      });

      // Tuiles OpenStreetMap, comme le prévoit le dossier : aucune clé d'API,
      // aucun service propriétaire. L'attribution est OBLIGATOIRE au titre de
      // la licence ODbL.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(instance);

      carte.current = instance;
      couche.current = L.layerGroup().addTo(instance);

      // Un conteneur dont la taille change (volet qui s'ouvre, rotation du
      // téléphone) laisse Leaflet avec des dimensions périmées : les tuiles
      // n'apparaissent qu'à moitié. `ResizeObserver` le lui apprend.
      const observateur = new ResizeObserver(() => instance.invalidateSize());
      observateur.observe(element);

      // Après un déplacement ou un zoom, on prévient le parent du nouveau
      // centre pour qu'il recharge les arrêts alentour.
      //
      // ⚠️ `moveend` ET NON `move` : `move` se déclenche à chaque image d'un
      // glissement, ce qui produirait des dizaines de requêtes par seconde.
      const surDeplacement = () => {
        const centre = instance.getCenter();
        centreDeplace.current?.(centre.lat, centre.lng);
      };

      instance.on("moveend", surDeplacement);

      nettoyage.current = () => {
        observateur.disconnect();
        instance.off("moveend", surDeplacement);
      };
    });

    return () => {
      annule = true;
      nettoyage.current?.();
      nettoyage.current = null;
      carte.current?.remove();
      carte.current = null;
      couche.current = null;
    };
  }, []);

  // --- Redessin des points, à chaque changement de données -----------------
  useEffect(() => {
    let annule = false;

    void import("leaflet").then((L) => {
      const instance = carte.current;
      const groupe = couche.current;
      if (annule || !instance || !groupe) return;

      groupe.clearLayers();

      const surLeTrace = new Set((trace ?? []).map((point) => point.id));

      for (const arret of arrets) {
        // Un arrêt du trajet n'est pas redessiné ici : il l'est ci-dessous,
        // plus gros et en vert. Sinon deux cercles se superposeraient.
        if (surLeTrace.has(arret.id)) continue;

        const marqueur = L.circleMarker([arret.latitude, arret.longitude], {
          radius: RAYON_ARRET,
          color: BLEU,
          fillColor: BLEU,
          fillOpacity: 0.7,
          weight: 1,
        }).bindTooltip(arret.nom);

        if (choisirArret.current) {
          marqueur.bindPopup(
            construirePopup(arret, (role) => {
              choisirArret.current?.(arret, role);
              instance.closePopup();
            }),
          );
        }

        marqueur.addTo(groupe);
      }

      if (troncons && troncons.length > 0) {
        for (const troncon of troncons) {
          L.polyline(troncon.points, {
            color: COULEURS_MODES[troncon.mode] ?? VERT,
            weight: troncon.mode === "WALK" ? 3 : 5,
            opacity: 0.9,
            // POINTILLÉS = « nous ne connaissons pas le tracé réel ». C'est
            // la seule chose qui distingue visuellement une voie publiée par
            // l'opérateur d'une droite tracée faute de mieux.
            dashArray:
              troncon.source === "STRAIGHT" || troncon.mode === "WALK"
                ? "6 6"
                : undefined,
          })
            .bindTooltip(
              troncon.source === "STRAIGHT"
                ? `${troncon.lineName} — tracé approché`
                : troncon.lineName,
            )
            .addTo(groupe);
        }
      } else if (trace && trace.length > 0) {
        L.polyline(
          trace.map((point) => [point.latitude, point.longitude] as [number, number]),
          { color: VERT, weight: 4, opacity: 0.85 },
        ).addTo(groupe);
      }

      if (trace && trace.length > 0) {

        for (const [rang, etape] of trace.entries()) {
          L.circleMarker([etape.latitude, etape.longitude], {
            radius: RAYON_ETAPE,
            color: VERT,
            fillColor: "#ffffff",
            fillOpacity: 1,
            weight: 3,
          })
            .bindTooltip(`${rang + 1}. ${etape.nom}`)
            .addTo(groupe);
        }
      }

      // Cadrage sur ce qui compte : le trajet s'il y en a un, sinon le réseau
      // entier. `CENTRE_DEFAUT` ne sert donc que si les deux sont vides.
      for (const station of velib ?? []) {
        L.circleMarker([station.latitude, station.longitude], {
          radius: RAYON_VELIB,
          color: VELIB,
          fillColor: VELIB,
          // Une station qui ne loue pas est dessinée en creux : l'information
          // est portée par la FORME, pas seulement par le texte du popup.
          fillOpacity: station.isRenting === false ? 0.15 : 0.85,
          weight: 2,
        })
          .bindTooltip(station.name)
          .bindPopup(construirePopupVelib(station))
          .addTo(groupe);
      }

      if (position) {
        // Le cercle d'incertitude, dessiné SOUS le point : il dit « je suis
        // quelque part là-dedans », ce qui est plus honnête qu'un point net.
        if (position.accuracyM !== null && position.accuracyM > 0) {
          L.circle([position.latitude, position.longitude], {
            radius: position.accuracyM,
            color: POSITION,
            fillColor: POSITION,
            fillOpacity: 0.1,
            weight: 1,
          }).addTo(groupe);
        }

        L.circleMarker([position.latitude, position.longitude], {
          radius: RAYON_ETAPE,
          color: "#ffffff",
          fillColor: POSITION,
          fillOpacity: 1,
          weight: 3,
        })
          .bindTooltip("Votre position")
          .addTo(groupe);
      }

      // ⚠️ ON NE RECADRE QUE SUR UN TRAJET, JAMAIS SUR LES ARRÊTS DE FOND.
      //
      // Les arrêts de fond sont rechargés à chaque déplacement de la carte.
      // Recadrer dessus déplacerait la carte, ce qui rechargerait les arrêts,
      // ce qui recadrerait à nouveau : la carte partirait en boucle et
      // l'usager ne pourrait plus rien regarder. Tant qu'aucun trajet n'est
      // choisi, la vue appartient donc entièrement à l'usager.
      // ⚠️ LE SUIVI PRIME SUR LE CADRAGE DU TRAJET. Pendant une navigation,
      // l'usager veut voir où il EST, pas l'ensemble du trajet — et recadrer
      // sur le trajet entier à chaque relevé GPS le dézoomerait sans cesse.
      //
      // `panTo` et non `setView` : on déplace SANS toucher au zoom, que
      // l'usager a peut-être ajusté lui-même.
      if (suivrePosition && position) {
        instance.panTo([position.latitude, position.longitude], {
          animate: true,
        });
        return;
      }

      const pointsDuTrace: [number, number][] =
        troncons && troncons.length > 0
          ? troncons.flatMap((troncon) => troncon.points)
          : (trace ?? []).map(
              (point) => [point.latitude, point.longitude] as [number, number],
            );

      if (pointsDuTrace.length > 0) {
        instance.fitBounds(L.latLngBounds(pointsDuTrace), {
          padding: [32, 32],
          maxZoom: 16,
        });
      }
    });

    return () => {
      annule = true;
    };
  }, [arrets, trace, troncons, velib, position, suivrePosition]);

  // `aria-hidden` : tout ce que la carte montre est déjà écrit en toutes
  // lettres à côté d'elle (étapes, arrêts, distances). Faire lire à un
  // lecteur d'écran une grille de tuiles et des cercles SVG n'apporterait
  // rien et noierait l'information utile.
  return <div ref={conteneur} aria-hidden="true" className="h-full w-full" />;
}
