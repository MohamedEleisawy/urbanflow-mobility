"use client";

import { useEffect, useRef } from "react";
import type { Map as CarteLeafletType, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { CENTRE_DEFAUT, type PointCarte, type TronconTrace } from "@/lib/carte";
import type { TransportMode } from "@/lib/types";

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

/// Couleurs du thème (`globals.css`) : Leaflet dessine en SVG et n'a pas accès
/// aux classes Tailwind.
const BLEU = "#1e3a5f";
const VERT = "#2d7d46";

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
}

export default function CarteLeaflet({
  arrets,
  trace,
  troncons = null,
}: CarteLeafletProps) {
  const conteneur = useRef<HTMLDivElement>(null);
  const carte = useRef<CarteLeafletType | null>(null);
  const couche = useRef<LayerGroup | null>(null);
  /// Arrete l'observateur de redimensionnement au demontage.
  const nettoyage = useRef<(() => void) | null>(null);

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
      nettoyage.current = () => observateur.disconnect();
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

        L.circleMarker([arret.latitude, arret.longitude], {
          radius: RAYON_ARRET,
          color: BLEU,
          fillColor: BLEU,
          fillOpacity: 0.7,
          weight: 1,
        })
          .bindTooltip(arret.nom)
          .addTo(groupe);
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
      // Cadrage sur ce qui compte : les tracés réels s'il y en a, sinon les
      // étapes, sinon le réseau. `CENTRE_DEFAUT` ne sert donc que si tout est
      // vide.
      const pointsDuTrace: [number, number][] =
        troncons && troncons.length > 0
          ? troncons.flatMap((troncon) => troncon.points)
          : (trace ?? []).map(
              (point) => [point.latitude, point.longitude] as [number, number],
            );

      const aCadrer: [number, number][] =
        pointsDuTrace.length > 0
          ? pointsDuTrace
          : arrets.map(
              (point) => [point.latitude, point.longitude] as [number, number],
            );

      if (aCadrer.length > 0) {
        instance.fitBounds(L.latLngBounds(aCadrer), {
          padding: [32, 32],
          maxZoom: 16,
        });
      }
    });

    return () => {
      annule = true;
    };
  }, [arrets, trace, troncons]);

  // `aria-hidden` : tout ce que la carte montre est déjà écrit en toutes
  // lettres à côté d'elle (étapes, arrêts, distances). Faire lire à un
  // lecteur d'écran une grille de tuiles et des cercles SVG n'apporterait
  // rien et noierait l'information utile.
  return <div ref={conteneur} aria-hidden="true" className="h-full w-full" />;
}
