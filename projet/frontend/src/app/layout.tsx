import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Header } from "@/components/Header";

// Geist, la police retenue par le dossier (§2.8.4).
//
// ⚠️ Le dossier prévoit `next/font/local`, pour supprimer toute dépendance à
// un service tiers. `next/font/google` télécharge la police AU MOMENT DU BUILD
// et la sert ensuite depuis notre propre domaine : à l'exécution, aucune
// requête ne part vers Google, ce qui est la propriété recherchée. Reste la
// récupération au build, qui disparaîtrait en déposant les fichiers .woff2
// dans le dépôt — à faire, mais cela suppose d'ajouter des binaires.
//
// Geist_Mono, présente dans le squelette create-next-app, a été retirée :
// aucun écran n'affiche de code ou de tableau chiffré aligné.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "UrbanFlow Mobility",
  description:
    "Planifiez vos trajets multimodaux, consultez les perturbations du réseau en temps réel et mesurez l'empreinte carbone de vos déplacements.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang="fr" : indispensable aux lecteurs d'écran, qui choisissent leur
    // prononciation d'après cet attribut. Le squelette annonçait "en".
    <html lang="fr" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/*
          Lien d'évitement : premier élément focusable de la page, invisible
          jusqu'à ce qu'on l'atteigne au clavier. Sans lui, un usager au
          clavier retraverse toute la navigation à chaque changement de page.
        */}
        <a
          href="#contenu"
          className="bg-brand sr-only rounded-b px-4 py-2 font-medium text-white focus:not-sr-only focus:absolute focus:top-0 focus:left-4 focus:z-50"
        >
          Aller au contenu principal
        </a>

        {/*
          AuthProvider enveloppe l'en-tête ET le contenu (étape 5A-3) : les
          deux ont besoin de savoir si quelqu'un est connecté — l'en-tête pour
          afficher « Connexion » ou « Se déconnecter », les pages pour agir.

          Il est CLIENT, mais `children` reste rendu côté SERVEUR : React
          passe les enfants déjà rendus à travers le provider. Envelopper toute
          l'application ne transforme donc pas les pages en composants client.
        */}
        <AuthProvider>
          <Header />

          {/* `flex-1` : le pied de page reste en bas même sur une page courte. */}
          <main id="contenu" className="flex-1">
            {children}
          </main>
        </AuthProvider>

        <footer className="border-t border-neutral-200 bg-white">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm text-neutral-600 sm:px-6">
            <p>
              UrbanFlow Mobility — projet de fin d&apos;études. Données de transport issues des
              standards ouverts GTFS et GTFS-Realtime.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
