"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Map as CarteLeafletType, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CENTRE_DEFAUT, type PointCarte, type TronconTrace } from "@/lib/carte";
import { SuiviRecadrage } from "@/lib/carte-recadrage";
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

/**
 * Position de l'usager.
 *
 * ⚠️ UN BLEU VIF, ET DISTINCT DU BLEU DES ARRÊTS (`#1e3a5f`, un marine
 * sombre). C'est la convention que tous les usagers connaissent — « le point
 * bleu, c'est moi » — et s'en écarter oblige à réapprendre une carte.
 *
 * Le contraste avec les arrêts ne repose pas que sur la teinte : le point de
 * position porte en plus un anneau blanc épais et un halo de précision, que
 * les arrêts n'ont pas.
 */
const POSITION = "#1d4ed8";

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

  /**
   * Centre du territoire desservi, pour l'ouverture de la carte.
   *
   * ⚠️ APPLIQUÉ UNE SEULE FOIS. Il arrive de façon asynchrone (`GET
   * /api/territory`) : la carte s'ouvre donc sur `CENTRE_DEFAUT` — un repli
   * neutre, jamais une ville en dur — puis se recentre dès que le territoire
   * est connu, tant qu'aucun trajet n'est tracé et que l'usager n'a rien
   * déplacé.
   */
  centre?: readonly [number, number] | null;
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
  centre = null,
}: CarteLeafletProps) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteLeafletType | null>(null);
  const couche = useRef<LayerGroup | null>(null);
  /// Arrete l'observateur de redimensionnement au demontage.
  const nettoyage = useRef<(() => void) | null>(null);
  /// Le centrage sur le territoire n'a lieu qu'UNE fois : après, la vue est à
  /// l'usager. Passe à `true` dès qu'on l'a appliqué OU que l'usager déplace
  /// la carte.
  const centreTerritoireApplique = useRef(false);

  // ═══ LE CENTRE EST DÉPLIÉ EN DEUX NOMBRES ═══
  //
  // ⚠️ ET C'EST LA CORRECTION D'UNE BOUCLE DE RENDU INFINIE. `centre` est un
  // TUPLE : un parent qui écrit `centre={[zone.lat, zone.lon]}` en fabrique un
  // nouveau à CHAQUE rendu. Mis tel quel dans les dépendances de l'effet
  // ci-dessous, il le faisait rejouer à chaque rendu — donc `fitBounds`, donc
  // `moveend`, donc `onCentreDeplace`, donc un `setState` chez le parent, donc
  // un nouveau rendu : « Maximum update depth exceeded », et le processeur à
  // 100 %.
  //
  // Deux NOMBRES se comparent par valeur. L'identité du tuple n'a plus aucune
  // conséquence, quel que soit le parent.
  const centreLat = centre ? centre[0] : null;
  const centreLon = centre ? centre[1] : null;

  /// Dernier centre connu, tenu à jour pour que la création de carte — qui est
  /// asynchrone — parte du territoire s'il est déjà résolu.
  const centreRef = useRef<readonly [number, number] | null>(centre);
  useEffect(() => {
    centreRef.current =
      centreLat === null || centreLon === null ? null : [centreLat, centreLon];
  }, [centreLat, centreLon]);

  // ═══ DISTINGUER UN DÉPLACEMENT DE L'USAGER D'UN RECADRAGE PROGRAMMÉ ═══
  //
  // ⚠️ LEAFLET NE LE FAIT PAS POUR NOUS. `setView`, `fitBounds` et `panTo`
  // émettent le MÊME `moveend` qu'un glissement au doigt. Rapporter les
  // premiers au parent revient à lui dire « l'usager a bougé » alors que c'est
  // NOUS qui avons bougé — et c'est l'autre moitié de la boucle infinie.
  //
  // La règle vit dans `lib/carte-recadrage.ts`, sans React ni Leaflet, et y
  // est éprouvée cas par cas. Ici on ne fait que la brancher.
  const suiviRecadrage = useRef<SuiviRecadrage>(null);
  suiviRecadrage.current ??= new SuiviRecadrage();

  /**
   * Exécute un recadrage en le marquant comme PROGRAMMÉ.
   *
   * Tout `setView` / `fitBounds` / `panTo` doit passer par ici : c'est le seul
   * endroit qui arme les garde-fous, et donc le seul qui garantisse que le
   * `moveend` qui suivra ne sera pas pris pour un geste de l'usager.
   *
   * Stable (`useCallback` sans dépendance) : elle ne lit qu'une référence,
   * elle peut donc entrer dans les dépendances d'un effet sans le faire
   * rejouer.
   */
  const recadrer = useCallback(
    (cible: { lat: number; lng: number }, action: () => void) =>
      suiviRecadrage.current!.programmer(cible, action),
    [],
  );

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

      // Le territoire est parfois déjà connu au moment où la carte se crée
      // (import Leaflet résolu après le premier rendu) : on part alors
      // directement du bon centre, sans le saut visible d'un recentrage.
      const centreInitial = centreRef.current;
      if (centreInitial) {
        centreTerritoireApplique.current = true;
      }

      const instance = L.map(element, {
        center: centreInitial
          ? [centreInitial[0], centreInitial[1]]
          : CENTRE_DEFAUT,
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
      //
      // ⚠️ ET SEULEMENT POUR UN GESTE DE L'USAGER. Voir `recadrer` : un
      // recadrage que NOUS avons déclenché n'est pas une nouvelle intention de
      // l'usager, et le rapporter refermait une boucle de rendu infinie.
      const surDeplacement = () => {
        const vue = instance.getCenter();

        if (suiviRecadrage.current!.estEcho({ lat: vue.lat, lng: vue.lng })) {
          return;
        }

        centreDeplace.current?.(vue.lat, vue.lng);
      };

      instance.on("moveend", surDeplacement);

      // Dès que l'usager empoigne la carte, le recentrage sur le territoire
      // est définitivement abandonné : la vue lui appartient. `dragstart` ne
      // se déclenche QUE sur un geste — jamais sur un `setView` programmé.
      const surPriseEnMain = () => {
        centreTerritoireApplique.current = true;
      };
      instance.on("dragstart", surPriseEnMain);

      nettoyage.current = () => {
        observateur.disconnect();
        instance.off("moveend", surDeplacement);
        instance.off("dragstart", surPriseEnMain);
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

      // ═══ RECENTRAGE SUR LE TERRITOIRE, UNE SEULE FOIS ═══
      //
      // ⚠️ Le territoire arrive de façon asynchrone (`GET /api/territory`),
      // parfois après la création de la carte. On le rattrape ici — cet effet
      // se rejoue à chaque changement de données — mais UNIQUEMENT tant que la
      // vue est neutre : aucun trajet, aucun suivi GPS, aucun geste de
      // l'usager. Ensuite `fitBounds` (trajet) ou `panTo` (suivi) plus bas
      // reprennent la main, et `dragstart` verrouille définitivement.
      if (
        centreLat !== null &&
        centreLon !== null &&
        !centreTerritoireApplique.current &&
        !suivrePosition &&
        !(trace && trace.length > 0) &&
        !(troncons && troncons.length > 0)
      ) {
        centreTerritoireApplique.current = true;
        recadrer({ lat: centreLat, lng: centreLon }, () =>
          // `animate: false` : le `moveend` part alors de façon SYNCHRONE,
          // pendant que le drapeau de `recadrer` est encore levé.
          instance.setView([centreLat, centreLon], instance.getZoom(), {
            animate: false,
          }),
        );
      }

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
            // ⚠️ LES POINTILLÉS SIGNIFIENT « CE N'EST PAS LE CHEMIN RÉEL »,
            // et rien d'autre. Un tracé piéton calculé par un moteur EST le
            // chemin réel : il se dessine en trait plein, comme une voie de
            // tram publiée par l'opérateur. Le dessiner en pointillés
            // reviendrait à s'excuser d'une donnée exacte.
            dashArray:
              troncon.source === "STRAIGHT" ||
              troncon.source === "WALK_ESTIMATE"
                ? "6 6"
                : undefined,
          })
            .bindTooltip(
              // ⚠️ TROIS PHRASES POUR TROIS PROVENANCES. Confondre « la voie
              // réelle », « une droite entre deux arrêts » et « une droite
              // entre deux points à pied » ferait passer une estimation pour
              // un itinéraire.
              troncon.source === "WALK_ESTIMATE"
                ? "Tracé piéton estimé — ligne droite, pas le chemin réel"
                : troncon.source === "WALK_ROUTED"
                  ? "Chemin piéton, rue par rue"
                  : troncon.source === "ROUTED"
                    ? "Itinéraire vélo, rue par rue"
                    : troncon.source === "STRAIGHT"
                      ? troncon.mode === "BIKE"
                        ? "Itinéraire vélo estimé — ligne droite, pas le chemin réel"
                        : troncon.lineName
                          ? `${troncon.lineName} — tracé approché`
                          : "Tracé approché — pas le chemin réel"
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
        recadrer(
          { lat: position.latitude, lng: position.longitude },
          // Animé : pendant une navigation, un glissement doux se suit des
          // yeux là où un saut sec fait perdre le fil. C'est le cas que
          // `cibleProgrammee` existe pour couvrir.
          () =>
            instance.panTo([position.latitude, position.longitude], {
              animate: true,
            }),
        );
        return;
      }

      const pointsDuTrace: [number, number][] =
        troncons && troncons.length > 0
          ? troncons.flatMap((troncon) => troncon.points)
          : (trace ?? []).map(
              (point) => [point.latitude, point.longitude] as [number, number],
            );

      if (pointsDuTrace.length > 0) {
        const cadre = L.latLngBounds(pointsDuTrace);
        const milieu = cadre.getCenter();

        recadrer({ lat: milieu.lat, lng: milieu.lng }, () =>
          instance.fitBounds(cadre, {
            padding: [32, 32],
            maxZoom: 16,
            // Synchrone, donc couvert par le drapeau de `recadrer` — et sans
            // animation le trajet s'affiche d'un coup, ce qui est ce qu'on
            // veut après une recherche.
            animate: false,
          }),
        );
      }
    });

    return () => {
      annule = true;
    };
    // ⚠️ `centreLat` / `centreLon` ET NON `centre` : deux nombres comparés par
    // valeur, là où le tuple changeait d'identité à chaque rendu du parent et
    // faisait rejouer cet effet en boucle. `recadrer` est stable.
  }, [
    arrets,
    trace,
    troncons,
    velib,
    position,
    suivrePosition,
    centreLat,
    centreLon,
    recadrer,
  ]);

  // `aria-hidden` : tout ce que la carte montre est déjà écrit en toutes
  // lettres à côté d'elle (étapes, arrêts, distances). Faire lire à un
  // lecteur d'écran une grille de tuiles et des cercles SVG n'apporterait
  // rien et noierait l'information utile.
  return <div ref={conteneur} aria-hidden="true" className="h-full w-full" />;
}
