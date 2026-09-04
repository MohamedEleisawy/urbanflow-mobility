import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { Header } from "@/components/Header";
import { ServiceWorker } from "@/components/ServiceWorker";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LangueProvider } from "@/components/LangueProvider";
import { PiedDePage } from "@/components/PiedDePage";

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
  title: "UrbanFlow — Mobilité écologique à Strasbourg",
  // ⚠️ CETTE PHRASE NE PROMET QUE CE QUI EXISTE, et elle a été corrigée deux
  // fois pour cela.
  //
  // 1. « en temps réel » a d'abord été retiré : aucune source temps réel n'est
  //    configurée — la CTS ne publie ces informations qu'en SIRI-Lite, sous
  //    jeton nominatif.
  // 2. La mention des perturbations a suivi, quand la page publique qui les
  //    affichait a été retirée pour la même raison.
  //
  // C'était le mensonge le plus large du produit : une description reprise par
  // les moteurs de recherche, les aperçus de lien et l'écran d'accueil d'une
  // application installée.
  description:
    "Itinéraires multimodaux et mobilité écologique à Strasbourg et dans l'Eurométropole : comparez les trajets et mesurez l'empreinte carbone de vos déplacements.",

  // iOS n'implémente pas `display: standalone` du manifeste : il lui faut
  // cette métadonnée pour ouvrir l'application sans barre d'adresse une fois
  // ajoutée à l'écran d'accueil. Sans elle, l'application reste installable
  // sur Android mais s'ouvre dans Safari sur iPhone (bloc 5C-4).
  appleWebApp: {
    capable: true,
    title: "UrbanFlow",
    statusBarStyle: "default",
  },
};

// ⚠️ `themeColor` VIT DANS `viewport`, PAS DANS `metadata`, dans cette version
// de Next.js. Le placer dans `metadata` déclenche un avertissement au build et
// la balise n'est pas émise.
// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
//  generate-viewport.md)
export const viewport: Viewport = {
  // Le bleu de l'identité visuelle : c'est la couleur que le système donne à
  // la barre d'état quand l'application est installée.
  themeColor: "#1e3a5f",
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
          {/* ⚠️ `ThemeProvider` ENVELOPPE DÉSORMAIS, au lieu de se contenter
              de poser un attribut. Depuis le sprint soutenance, il expose un
              contexte : le sélecteur de l'en-tête doit pouvoir lire le thème
              courant et le changer, ce qu'un composant sans enfants ne
              permettait pas.

              À L'INTÉRIEUR d'`AuthProvider` : il lit le profil pour donner la
              priorité à la préférence du compte, et retombe sur le choix
              local — jamais effacé — dès la déconnexion.

              ⚠️ IL ENVELOPPE, il ne se contente pas d'être là. Contrairement à
              `ThemeProvider` — qui pose un attribut sur `<html>` et ne rend
              rien — la langue est lue par les composants via un contexte : ils
              doivent donc se trouver DANS son arbre.

              À l'intérieur d'`AuthProvider`, comme le thème : il lit la
              préférence du compte et retombe sur le français pour un
              visiteur. */}
          <LangueProvider>
            <ThemeProvider>
              <Header />

              {/* `flex-1` : le pied de page reste en bas même sur une page
                  courte. */}
              <main id="contenu" className="flex-1">
                {children}
              </main>

              {/* Dans `LangueProvider` ET `AuthProvider` : ses libellés sont
                  traduits, et « Mes données » dépend de l'état de session. */}
              <PiedDePage />
            </ThemeProvider>
          </LangueProvider>
        </AuthProvider>

        {/* Sans rendu : enregistre le service worker exigé par la
            contrainte C1 du sujet (bloc 5D-2). Placé en fin de corps, il
            n'entre en jeu qu'une fois la page chargée. */}
        <ServiceWorker />

      </body>
    </html>
  );
}
