import { ButtonLink } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";

// Page d'accueil (étape 5A-2).
//
// Composant SERVEUR : aucun état, aucun effet, aucune interactivité. Elle ne
// fait — et ne doit faire — AUCUN appel au backend à cette étape.

/// Ce que le backend sait déjà faire, et que les écrans suivants exposeront.
const ATOUTS = [
  {
    titre: "Itinéraires multimodaux",
    texte:
      "Bus, tramway, métro, vélo et marche combinés sur un même trajet, avec le détail de chaque correspondance.",
  },
  {
    titre: "Perturbations en direct",
    texte:
      "Les alertes publiées par les opérateurs au standard GTFS-Realtime, triées de la plus grave à la plus anodine.",
  },
  {
    titre: "Empreinte carbone",
    texte:
      "Les grammes de CO₂ de chaque trajet, ce qu'ils économisent face à la voiture, et un suivi hebdomadaire.",
  },
] as const;

export default function Accueil() {
  return (
    <Container>
      {/* --- Proposition de valeur ------------------------------------- */}
      <section className="py-12 sm:py-16">
        {/* Un seul <h1> par page : c'est le repère qu'un lecteur d'écran
            utilise pour savoir de quoi la page parle. */}
        <h1 className="text-ink max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Vos trajets urbains, sans détour et sans surprise
        </h1>

        <p className="mt-4 max-w-2xl text-base leading-relaxed text-neutral-700 sm:text-lg">
          UrbanFlow Mobility réunit les transports en commun, le vélo et la marche dans un seul
          itinéraire. Vous voyez les perturbations en cours avant de partir, et l&apos;empreinte
          carbone de chaque option avant de choisir.
        </p>

        {/* flex-col sur mobile : deux boutons côte à côte y deviendraient
            trop étroits pour être visés du pouce. */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/recherche">Rechercher un itinéraire</ButtonLink>
          <ButtonLink href="/alertes" variant="secondary">
            Voir les perturbations
          </ButtonLink>
        </div>
      </section>

      {/* --- Ce que l'application apporte ------------------------------ */}
      <section aria-labelledby="atouts" className="pb-12 sm:pb-16">
        <h2 id="atouts" className="text-ink text-xl font-semibold">
          Ce que vous pouvez faire
        </h2>

        {/* Une colonne sur mobile, trois sur grand écran. Rien entre les
            deux : à deux colonnes, la troisième carte resterait seule. */}
        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {ATOUTS.map(({ titre, texte }) => (
            <li key={titre}>
              <Card>
                <h3 className="text-ink font-medium">{titre}</h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-600">{texte}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* --- Mobilité durable ------------------------------------------ */}
      <section aria-labelledby="carbone" className="pb-16">
        <div className="border-eco/30 rounded-lg border bg-white p-6 sm:p-8">
          {/* Le vert est réservé au carbone dans tout le projet : le voir ici
              et nulle part ailleurs sur cette page est intentionnel. */}
          <h2 id="carbone" className="text-eco text-xl font-semibold">
            Chaque trajet compte
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-700 sm:text-base">
            Les émissions sont calculées à partir des facteurs d&apos;émission de l&apos;ADEME, mode
            par mode et distance par distance. Aucun chiffre n&apos;est estimé au jugé :
            lorsqu&apos;un facteur d&apos;émission n&apos;existe pas pour un mode,
            l&apos;application le dit plutôt que d&apos;inventer une valeur.
          </p>
        </div>
      </section>
    </Container>
  );
}
