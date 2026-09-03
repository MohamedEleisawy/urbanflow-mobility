"use client";

import { PageLegale, Section } from "@/components/PageLegale";

// =============================================================================
// Déclaration d'accessibilité (sprint soutenance)
// =============================================================================
// ⚠️ CE QUI EST ÉCRIT ICI EST CE QUI A ÉTÉ FAIT, PAS CE QUI ÉTAIT VISÉ. Une
// déclaration d'accessibilité qui annonce « conforme » sans audit trompe
// précisément les personnes qu'elle prétend servir — celles qui découvriront
// l'obstacle en le heurtant.
//
// Le statut annoncé est donc « partiellement conforme », avec la liste des
// points VÉRIFIÉS et celle des points NON VÉRIFIÉS. C'est moins flatteur, et
// c'est utilisable.
// =============================================================================

export default function AccessibilitePage() {
  return (
    <PageLegale
      titre="Accessibilité"
      chapeau="UrbanFlow Mobility vise le niveau AA des WCAG 2.1. Cette page dit où nous en sommes réellement."
    >
      <Section titre="État de conformité">
        <p>
          <strong>Partiellement conforme</strong> au niveau AA des WCAG 2.1.
        </p>
        <p>
          Ce n’est pas une précaution de style :{" "}
          <strong>aucun audit externe n’a été mené</strong>, et plusieurs points
          listés plus bas n’ont pas été vérifiés. Annoncer « conforme » sur
          cette base tromperait exactement les personnes que cette page
          concerne.
        </p>
      </Section>

      <Section titre="Ce qui a été vérifié">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Navigation au clavier</strong> sur l’ensemble des parcours :
            recherche, résultats, itinéraire, guidage, formulaires.
          </li>
          <li>
            <strong>Indicateur de focus visible</strong> sur tout élément
            interactif, via <code>:focus-visible</code> — sans clignoter au clic
            souris.
          </li>
          <li>
            <strong>Lien d’évitement</strong> vers le contenu principal, premier
            élément focusable de chaque page.
          </li>
          <li>
            <strong>Contrastes</strong> : bleu de marque sur fond clair 10,5:1
            (AAA), vert écologique sur blanc 5,1:1 (AA), encre sur fond 15,7:1
            (AAA). Le mode sombre éclaircit les deux teintes de marque pour
            préserver ces rapports.
          </li>
          <li>
            <strong>
              L’information ne repose jamais sur la seule couleur.
            </strong>{" "}
            La gravité d’une perturbation porte un mot ; l’étape courante du
            guidage porte <code>aria-current=&quot;step&quot;</code> et un
            repère textuel ; un filtre indisponible porte son motif.
          </li>
          <li>
            <strong>États annoncés</strong> : <code>aria-pressed</code> sur les
            filtres, <code>aria-current</code> sur la navigation et la timeline,{" "}
            <code>aria-live</code> sur les instructions de guidage.
          </li>
          <li>
            <strong>Animations désactivables</strong> : toute animation
            décorative respecte <code>prefers-reduced-motion: reduce</code>. Les
            retours fonctionnels, eux, sont conservés.
          </li>
          <li>
            <strong>Langue déclarée</strong> sur la page et sur chaque option du
            sélecteur de langue, pour que la synthèse vocale prononce
            correctement.
          </li>
        </ul>
      </Section>

      <Section titre="Ce qui n’a pas été vérifié">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Aucun test avec un lecteur d’écran réel</strong> (NVDA,
            JAWS, VoiceOver). Les attributs ARIA sont posés et vérifiés par des
            requêtes accessibles — ce qui n’est pas la même chose qu’écouter le
            résultat.
          </li>
          <li>
            <strong>Aucun test utilisateur</strong> avec des personnes en
            situation de handicap.
          </li>
          <li>
            <strong>Zoom à 400 %</strong> et redistribution du contenu non
            vérifiés systématiquement.
          </li>
        </ul>
      </Section>

      <Section titre="La carte">
        <p>
          Une carte interactive n’est pas exploitable au lecteur d’écran, et
          nous ne prétendons pas l’avoir rendue telle.
        </p>
        <p>
          <strong>Aucune information n’existe uniquement sur la carte.</strong>{" "}
          Le déroulé du trajet, les arrêts, les durées, les distances, les
          correspondances et les émissions sont tous disponibles en texte, dans
          la liste des résultats et sur la page d’itinéraire. La carte illustre ;
          elle ne porte rien à elle seule.
        </p>
      </Section>

      <Section titre="Accessibilité des transports">
        <p>
          L’accessibilité PMR d’un arrêt n’est affichée que lorsque le flux de
          l’opérateur la publie explicitement.
        </p>
        <p>
          <strong>
            Nous n’indiquons jamais qu’un arrêt est accessible sans donnée le
            garantissant.
          </strong>{" "}
          Sur ce point précis, une information fausse ne cause pas un
          désagrément : elle laisse quelqu’un devant un quai qu’il ne peut pas
          atteindre.
        </p>
      </Section>

      <Section titre="Signaler un obstacle">
        <p>
          Si un élément vous empêche d’accéder à un contenu ou à une
          fonctionnalité, écrivez à l’adresse de contact indiquée dans les
          mentions légales. Décrivez la page et ce que vous tentiez de faire :
          c’est ce qui permet de reproduire le problème.
        </p>
      </Section>
    </PageLegale>
  );
}
