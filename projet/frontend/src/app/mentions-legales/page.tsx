"use client";

import {
  EncadreDemonstration,
  PageLegale,
  Section,
  useIdentiteLegale,
} from "@/components/PageLegale";

// =============================================================================
// Mentions légales (sprint soutenance)
// =============================================================================
// ⚠️ AUCUNE COORDONNÉE N'EST INVENTÉE. C'est la page dont l'unique objet est
// de dire qui édite le site : y écrire un nom de société plausible serait
// exactement le contraire de ce qu'elle sert à faire.
//
// Les sources de données, elles, sont réelles et vérifiables : ce sont celles
// que l'application interroge effectivement.
// =============================================================================

export default function MentionsLegalesPage() {
  const identite = useIdentiteLegale();
  const responsable = identite?.entityName ?? null;
  const contact = identite?.contactEmail ?? null;

  return (
    <PageLegale
      titre="Mentions légales"
      chapeau="Éditeur, sources de données, limites connues et propriété intellectuelle."
    >
      {responsable === null && (
        <EncadreDemonstration>
          UrbanFlow Mobility est ici déployé à titre de démonstration, dans le
          cadre d’un projet de fin d’études. Aucune entité juridique n’est
          configurée, et aucune n’est inventée à sa place.
        </EncadreDemonstration>
      )}

      <Section titre="Éditeur">
        <p>
          {responsable ?? (
            <em>
              Non configuré. Renseignez <code>LEGAL_ENTITY_NAME</code> pour un
              déploiement réel.
            </em>
          )}
        </p>
        <p>
          Contact :{" "}
          {contact ? (
            <a
              href={`mailto:${contact}`}
              className="text-brand underline underline-offset-2"
            >
              {contact}
            </a>
          ) : (
            <em>non configuré.</em>
          )}
        </p>
      </Section>

      <Section titre="Nature du service">
        <p>
          UrbanFlow Mobility est une application de calcul d’itinéraires
          multimodaux et d’estimation d’empreinte carbone, déployée pour
          l’Eurométropole de Strasbourg.
        </p>
        <p>
          <strong>
            Les itinéraires proposés sont indicatifs et reposent sur des données
            théoriques.
          </strong>{" "}
          Ils ne constituent aucun engagement de l’exploitant du réseau. En cas
          de divergence, l’information de la CTS fait foi.
        </p>
      </Section>

      <Section titre="Sources de données">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Réseau et horaires théoriques</strong> — flux GTFS de la
            Compagnie des Transports Strasbourgeois (CTS), publié en données
            ouvertes sur{" "}
            <a
              href="https://transport.data.gouv.fr"
              className="text-brand underline underline-offset-2"
              rel="noreferrer noopener"
              target="_blank"
            >
              transport.data.gouv.fr
            </a>
            .
          </li>
          <li>
            <strong>Vélos en libre-service</strong> — flux GBFS Vélhop,
            Eurométropole de Strasbourg.
          </li>
          <li>
            <strong>Géocodage d’adresses</strong> — Nominatim, sur données
            OpenStreetMap, sous licence ODbL.
          </li>
          <li>
            <strong>Fonds cartographique</strong> — OpenStreetMap et ses
            contributeurs, sous licence ODbL.
          </li>
          <li>
            <strong>Facteurs d’émission</strong> — Base Carbone® de l’ADEME.
          </li>
        </ul>
      </Section>

      <Section titre="Limites connues, et assumées">
        <p>
          Ces limites sont énoncées ici parce qu’elles touchent la fiabilité de
          ce qui est affiché :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Aucune information en temps réel.</strong> Retards,
            suppressions et positions de véhicules ne sont pas connus : la CTS
            les publie au format SIRI-Lite, sous jeton nominatif, non configuré
            sur cette installation.
          </li>
          <li>
            <strong>Aucun tracé de voirie.</strong> Le flux CTS ne fournit pas
            de géométrie de lignes : les trajets sont dessinés en segments
            droits d’arrêt à arrêt, ce que la carte indique.
          </li>
          <li>
            <strong>Aucune correspondance publiée.</strong> Le flux ne contient
            pas de fichier de correspondances entre quais.
          </li>
          <li>
            <strong>L’accessibilité PMR des arrêts n’est pas garantie.</strong>{" "}
            Elle n’est affichée que lorsque le flux la publie explicitement.
          </li>
        </ul>
      </Section>

      <Section titre="Propriété intellectuelle">
        <p>
          Les données de transport, cartographiques et d’émission restent la
          propriété de leurs producteurs respectifs, et sont utilisées selon
          leurs licences ouvertes.
        </p>
      </Section>
    </PageLegale>
  );
}
