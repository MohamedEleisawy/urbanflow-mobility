"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Container } from "@/components/Container";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useTraduction } from "@/components/LangueProvider";
import { messageDErreur } from "@/lib/api";
import { reinitialiserMotDePasse } from "@/lib/auth-api";

// =============================================================================
// Choix d'un nouveau mot de passe (war room)
// =============================================================================
// ═══ CE QUE CET ÉCRAN NE FAIT PAS, ET POURQUOI ═══
//
// ⚠️ IL NE CONNECTE PAS. Réinitialiser son mot de passe ne doit pas ouvrir une
// session : quelqu'un qui aurait intercepté le lien obtiendrait un accès sans
// jamais prouver qu'il connaît le nouveau mot de passe. On renvoie donc vers la
// page de connexion, où il faudra le saisir.
//
// ⚠️ IL NE DIT PAS POURQUOI UN JETON EST REFUSÉ. Inconnu, expiré, déjà
// utilisé : le backend rend le même message pour les trois, et cette page le
// répète tel quel. Les distinguer apprendrait qu'un jeton a existé, donc
// qu'une demande a été faite pour un compte donné.
//
// ═══ LA CONFIRMATION DU MOT DE PASSE ═══
//
// Elle est vérifiée ICI, avant tout appel réseau — non par méfiance envers le
// backend, mais parce qu'il n'a aucun moyen de la vérifier : il ne reçoit
// qu'un mot de passe. Une faute de frappe non détectée enfermerait l'usager
// dehors avec un mot de passe qu'il croit connaître.
// =============================================================================

export default function ReinitialiserPage() {
  // ⚠️ `useSearchParams` EXIGE UNE FRONTIÈRE `Suspense` dans cette version de
  // Next.js. Sans elle, la page entière bascule en rendu dynamique et le build
  // échoue. (node_modules/next/dist/docs — `use-search-params`.)
  return (
    <Suspense fallback={null}>
      <Formulaire />
    </Suspense>
  );
}

function Formulaire() {
  const { t } = useTraduction();
  const parametres = useSearchParams();

  // ⚠️ LE JETON VIENT DE L'URL, ET N'EST NI STOCKÉ NI JOURNALISÉ. Il vaut un
  // mot de passe : l'écrire dans `localStorage` le laisserait accessible à
  // tout script de la page, bien après usage.
  const jeton = parametres.get("token") ?? "";

  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [etat, setEtat] = useState<"saisie" | "envoi" | "fait">("saisie");
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();
    setErreur(null);

    if (motDePasse.length < 8) {
      setErreur(t.mdpResetTropCourt);
      return;
    }

    if (motDePasse !== confirmation) {
      setErreur(t.mdpResetDiscordance);
      return;
    }

    setEtat("envoi");

    try {
      await reinitialiserMotDePasse(jeton, motDePasse);
      setEtat("fait");
    } catch (echec: unknown) {
      setErreur(messageDErreur(echec));
      setEtat("saisie");
    }
  };

  // Un lien tronqué — recopié à la main, coupé par un client de messagerie —
  // est un cas assez fréquent pour mériter sa propre phrase, plutôt qu'un
  // échec réseau incompréhensible après une saisie complète.
  if (!jeton) {
    return (
      <Cadre titre={t.mdpResetTitre}>
        <ErrorMessage>{t.mdpResetSansJeton}</ErrorMessage>
        <p className="mt-4 text-sm">
          <Link
            href="/mot-de-passe-oublie"
            className="text-brand font-medium underline underline-offset-2"
          >
            {t.mdpOublieTitre}
          </Link>
        </p>
      </Cadre>
    );
  }

  if (etat === "fait") {
    return (
      <Cadre titre={t.mdpResetTitre}>
        <p
          role="status"
          className="border-eco/30 bg-eco/5 text-eco rounded-md border px-4 py-3 text-sm"
        >
          {t.mdpResetSucces}
        </p>

        <p className="mt-6">
          <Link
            href="/connexion"
            className="bg-brand hover:bg-brand-dark inline-block rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            {t.mdpAllerConnexion}
          </Link>
        </p>
      </Cadre>
    );
  }

  return (
    <Cadre titre={t.mdpResetTitre}>
      <p className="mt-2 text-sm text-neutral-700">{t.mdpResetIntro}</p>

      {erreur && (
        <div className="mt-4">
          <ErrorMessage>{erreur}</ErrorMessage>
        </div>
      )}

      <form onSubmit={soumettre} className="mt-6 space-y-4" noValidate>
        <div>
          <label
            htmlFor="motdepasse"
            className="text-ink block text-sm font-medium"
          >
            {t.mdpResetChamp}
          </label>
          <input
            id="motdepasse"
            name="password"
            type="password"
            required
            minLength={8}
            // `new-password` : indique au gestionnaire de mots de passe qu'il
            // s'agit d'une création, donc de proposer d'en générer un — et
            // non de remplir l'ancien.
            autoComplete="new-password"
            autoFocus
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            className="text-ink mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="confirmation"
            className="text-ink block text-sm font-medium"
          >
            {t.mdpResetConfirmation}
          </label>
          <input
            id="confirmation"
            name="confirmation"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            className="text-ink mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <Button type="submit" disabled={etat === "envoi"}>
          {etat === "envoi" ? t.mdpResetEnCours : t.mdpResetValider}
        </Button>
      </form>

      <p className="mt-6 text-sm text-neutral-600">
        <Link
          href="/connexion"
          className="text-brand font-medium underline underline-offset-2"
        >
          {t.mdpOublieRetour}
        </Link>
      </p>
    </Cadre>
  );
}

function Cadre({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <Container>
      <div className="mx-auto max-w-md py-10 sm:py-16">
        <Card>
          <h1 className="text-ink text-2xl font-semibold tracking-tight">
            {titre}
          </h1>
          {children}
        </Card>
      </div>
    </Container>
  );
}
