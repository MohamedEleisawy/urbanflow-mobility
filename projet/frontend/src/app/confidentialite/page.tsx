"use client";

import Link from "next/link";
import {
  EncadreDemonstration,
  PageLegale,
  Section,
  useIdentiteLegale,
} from "@/components/PageLegale";

// =============================================================================
// Politique de confidentialité (sprint soutenance)
// =============================================================================
// ═══ CE QUI DISTINGUE CETTE PAGE D'UN MODÈLE COPIÉ ═══
//
// Elle décrit CE QUE CETTE APPLICATION FAIT RÉELLEMENT, vérifié dans le
// schéma Prisma et dans le code, et rien d'autre. Chaque affirmation
// ci-dessous est vraie de cette base de données :
//
//   - `User` porte un email et un `passwordHash` (bcrypt), jamais de mot de
//     passe en clair ;
//   - `UserPreferences` porte langue, thème, modes préférés, budget carbone ;
//   - `Route` et `Segment` portent l'historique des trajets ENREGISTRÉS —
//     ceux que l'usager a explicitement sauvegardés, pas ses recherches ;
//   - `FavoriteAddress` porte les adresses nommées par l'usager ;
//   - `CarbonRecord` et `CarbonBudget` portent le suivi d'empreinte.
//
// ⚠️ AUCUNE TRACE GPS N'EST STOCKÉE. La position lue pendant le guidage vit en
// mémoire dans l'onglet, et disparaît quand on arrête le suivi. C'est vérifié
// par `useNavigationTracking`, qui appelle `clearWatch` au démontage et
// n'écrit nulle part.
//
// ⚠️ CETTE PAGE EST EN FRANÇAIS SEULEMENT, et c'est délibéré. Un texte
// juridique traduit à la main par un développeur n'engage rien et peut
// induire en erreur sur les droits de la personne concernée. L'interface est
// trilingue ; l'information légale renvoie à une version de référence.
// =============================================================================

export default function ConfidentialitePage() {
  const identite = useIdentiteLegale();

  const responsable = identite?.entityName ?? null;
  const contactVieePrivee =
    identite?.privacyContactEmail ?? identite?.contactEmail ?? null;

  return (
    <PageLegale
      titre="Politique de confidentialité"
      chapeau="Cette page décrit les données qu’UrbanFlow Mobility traite, pourquoi, combien de temps, et ce que vous pouvez exiger à leur sujet."
    >
      {responsable === null && (
        <EncadreDemonstration>
          Les variables <code>LEGAL_ENTITY_NAME</code>,{" "}
          <code>LEGAL_CONTACT_EMAIL</code> et{" "}
          <code>PRIVACY_CONTACT_EMAIL</code> ne sont pas renseignées. Aucune
          raison sociale ni adresse n’est inventée à leur place : les
          coordonnées d’un responsable de traitement ne se devinent pas.
        </EncadreDemonstration>
      )}

      <Section titre="Responsable du traitement">
        <p>
          {responsable ?? (
            <em>Non configuré sur cette installation de démonstration.</em>
          )}
        </p>
        <p>
          Contact pour toute question relative aux données personnelles :{" "}
          {contactVieePrivee ? (
            <a
              href={`mailto:${contactVieePrivee}`}
              className="text-brand underline underline-offset-2"
            >
              {contactVieePrivee}
            </a>
          ) : (
            <em>non configuré.</em>
          )}
        </p>
      </Section>

      <Section titre="Données traitées">
        <p>
          <strong>Compte.</strong> Adresse électronique et empreinte du mot de
          passe. Le mot de passe lui-même n’est jamais stocké : seule une
          empreinte bcrypt l’est, qui ne permet pas de le retrouver.
        </p>
        <p>
          <strong>Préférences.</strong> Langue, thème, modes de transport
          préférés, mode accessibilité, budget carbone hebdomadaire,
          notifications.
        </p>
        <p>
          <strong>Adresses favorites.</strong> Les lieux que vous nommez
          vous-même — domicile, travail, autres — avec leurs coordonnées.
        </p>
        <p>
          <strong>Trajets enregistrés.</strong> Les itinéraires que vous
          choisissez explicitement de sauvegarder, avec leurs segments, leurs
          horaires et leur empreinte carbone estimée.{" "}
          <strong>
            Vos recherches, elles, ne sont pas conservées : chercher un
            itinéraire ne laisse aucune trace dans votre compte.
          </strong>
        </p>
        <p>
          <strong>Empreinte carbone.</strong> Les valeurs calculées pour vos
          trajets enregistrés, et le suivi de votre budget hebdomadaire.
        </p>
      </Section>

      <Section titre="Données de localisation">
        <p>
          Votre position n’est lue qu’après une <strong>action explicite</strong>{" "}
          de votre part — le bouton « Activer ma position » — et uniquement
          pendant le guidage.
        </p>
        <p>
          <strong>
            Aucune trace GPS n’est enregistrée, ni sur nos serveurs, ni dans
            votre navigateur.
          </strong>{" "}
          La position vit en mémoire dans l’onglet le temps du trajet, et
          disparaît dès que vous arrêtez le suivi ou fermez la page.
        </p>
        <p>
          Une adresse que vous saisissez est envoyée au service de géocodage
          pour être convertie en coordonnées ; elle n’est pas conservée chez
          nous, sauf si vous l’enregistrez comme adresse favorite.
        </p>
      </Section>

      <Section titre="Finalités">
        <ul className="list-disc space-y-1 pl-5">
          <li>Vous authentifier et sécuriser l’accès à votre compte.</li>
          <li>Calculer et afficher des itinéraires multimodaux.</li>
          <li>
            Estimer l’empreinte carbone de vos déplacements et la comparer à la
            voiture individuelle.
          </li>
          <li>Vous restituer votre historique et vos statistiques.</li>
          <li>Appliquer vos préférences d’affichage et de mobilité.</li>
        </ul>
      </Section>

      <Section titre="Base légale">
        <p>
          Le traitement de vos données de compte et de vos trajets repose sur
          l’<strong>exécution du service</strong> que vous demandez : sans
          compte, il n’y a pas d’historique à restituer.
        </p>
        <p>
          L’accès à votre position repose sur votre{" "}
          <strong>consentement</strong>, donné au navigateur et révocable à tout
          moment dans ses réglages ou en arrêtant le suivi.
        </p>
      </Section>

      <Section titre="Durée de conservation">
        <p>
          Vos données sont conservées{" "}
          <strong>tant que votre compte existe</strong>. La suppression de votre
          compte entraîne celle de vos préférences, adresses favorites, trajets
          et données carbone.
        </p>
        <p>
          Les données de position ne sont pas conservées : la question de leur
          durée ne se pose pas.
        </p>
      </Section>

      <Section titre="Destinataires et prestataires">
        <p>
          Vos données ne sont ni vendues, ni cédées, ni utilisées à des fins
          publicitaires. Aucune régie, aucun traceur, aucune mesure d’audience.
        </p>
        <p>
          Trois services extérieurs sont sollicités, et voici exactement ce
          qu’ils reçoivent :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Géocodage (Nominatim / OpenStreetMap)</strong> — reçoit le
            texte de l’adresse que vous saisissez. Il ne reçoit ni votre
            identité, ni votre compte.
          </li>
          <li>
            <strong>Fonds de carte (OpenStreetMap)</strong> — reçoit les
            coordonnées des tuiles affichées, comme tout site cartographique.
          </li>
          <li>
            <strong>Données de transport (CTS, Vélhop)</strong> — sont{" "}
            <em>lues</em> par nos serveurs. Aucune donnée vous concernant ne
            leur est transmise.
          </li>
        </ul>
      </Section>

      <Section titre="Vos droits">
        <p>
          Vous disposez d’un droit d’accès, de rectification, d’effacement, de
          limitation, d’opposition et de portabilité.
        </p>
        <p>
          Deux d’entre eux s’exercent <strong>directement dans le produit</strong>,
          sans avoir à écrire à quiconque, depuis{" "}
          <Link
            href="/mes-donnees"
            className="text-brand underline underline-offset-2"
          >
            Mes données
          </Link>{" "}
          :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Portabilité</strong> — exporter l’intégralité de vos données
            dans un fichier JSON.
          </li>
          <li>
            <strong>Effacement</strong> — supprimer votre compte et tout ce qui
            s’y rattache.
          </li>
        </ul>
        <p>
          Pour les autres, ou en cas de désaccord, écrivez à l’adresse indiquée
          plus haut. Vous pouvez également introduire une réclamation auprès de
          la{" "}
          <a
            href="https://www.cnil.fr"
            className="text-brand underline underline-offset-2"
            rel="noreferrer noopener"
            target="_blank"
          >
            CNIL
          </a>
          .
        </p>
      </Section>

      <Section titre="Cookies et stockage local">
        <p>
          <strong>
            Aucun cookie de traçage, aucun cookie tiers, aucune mesure
            d’audience.
          </strong>
        </p>
        <p>
          Trois valeurs seulement sont écrites dans le stockage local de votre
          navigateur, toutes nécessaires au fonctionnement demandé : votre
          jeton de session, votre choix de thème et votre choix de langue.
          Elles ne quittent pas votre appareil, sauf le jeton, qui accompagne
          vos requêtes pour vous authentifier.
        </p>
        <p>
          C’est la raison pour laquelle aucune bannière de consentement ne vous
          est présentée : il n’y a rien à consentir.
        </p>
      </Section>
    </PageLegale>
  );
}
