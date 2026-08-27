"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { ErrorMessage } from "@/components/ErrorMessage";
import { messageDErreur } from "@/lib/api";

/**
 * Formulaire d'email et de mot de passe, partagé par la connexion et
 * l'inscription (étape 5A-3).
 *
 * POURQUOI UN SEUL COMPOSANT POUR LES DEUX ÉCRANS. Ils demandent exactement
 * les mêmes champs, avec les mêmes contraintes d'accessibilité et le même
 * traitement d'erreur. Les écrire deux fois garantirait qu'ils divergent : on
 * corrigerait un libellé d'erreur d'un côté, pas de l'autre.
 *
 * Ce qui les distingue — le titre, le texte du bouton, l'action — est passé
 * en propriété. Ce qui les rapproche est écrit une fois.
 */
export function AuthForm({
  titre,
  intituleBouton,
  /// `current-password` ou `new-password` : ce détail décide si le
  /// gestionnaire de mots de passe du navigateur PROPOSE un mot de passe
  /// existant ou en SUGGÈRE un nouveau.
  autoCompleteMotDePasse,
  onSubmit,
  bas,
}: {
  titre: string;
  intituleBouton: string;
  autoCompleteMotDePasse: "current-password" | "new-password";
  onSubmit: (email: string, motDePasse: string) => Promise<void>;
  bas?: React.ReactNode;
}) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // `useId` produit des identifiants stables entre serveur et client. Les
  // coder en dur casserait la page le jour où deux formulaires cohabitent.
  const idEmail = useId();
  const idMotDePasse = useId();
  const idErreur = useId();

  const soumettre = async (evenement: FormEvent) => {
    evenement.preventDefault();
    setErreur(null);
    setEnvoi(true);

    try {
      await onSubmit(email.trim(), motDePasse);
    } catch (echec) {
      // `messageDErreur` (5A-2) garantit qu'aucune trace d'exécution
      // n'atteint l'écran, quelle que soit l'origine de l'échec.
      setErreur(messageDErreur(echec));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={soumettre} noValidate className="space-y-5">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">{titre}</h1>

      {erreur && (
        <div id={idErreur}>
          <ErrorMessage title="Connexion impossible">{erreur}</ErrorMessage>
        </div>
      )}

      <div>
        {/* `htmlFor` lié à `id` : c'est ce qui fait annoncer « Adresse email »
            au lecteur d'écran, et ce qui rend le libellé cliquable. */}
        <label htmlFor={idEmail} className="text-ink block text-sm font-medium">
          Adresse email
        </label>
        <input
          id={idEmail}
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          // Relie le champ au message d'erreur : le lecteur d'écran l'annonce
          // en atteignant le champ, sans obliger à remonter dans la page.
          aria-describedby={erreur ? idErreur : undefined}
          className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none"
        />
      </div>

      <div>
        <label htmlFor={idMotDePasse} className="text-ink block text-sm font-medium">
          Mot de passe
        </label>
        <input
          id={idMotDePasse}
          name="password"
          type="password"
          required
          // VALIDATION UX MINIMALE. Le backend reste l'autorité : il impose
          // 8 caractères (`@MinLength(8)`), et c'est lui qui refuse. On se
          // contente ici d'éviter un aller-retour évident — sans recopier ses
          // règles, qui divergeraient à la première évolution.
          minLength={8}
          autoComplete={autoCompleteMotDePasse}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          aria-describedby={erreur ? idErreur : undefined}
          className="focus:border-brand mt-1.5 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base outline-none"
        />
        <p className="mt-1.5 text-sm text-neutral-600">Au moins 8 caractères.</p>
      </div>

      {/* `disabled` pendant l'envoi : sans cela, un double clic enverrait deux
          inscriptions, dont la seconde échouerait en 409. */}
      <Button type="submit" disabled={envoi} className="w-full sm:w-auto">
        {envoi ? "Veuillez patienter…" : intituleBouton}
      </Button>

      {bas && <div className="pt-2 text-sm text-neutral-700">{bas}</div>}
    </form>
  );
}
