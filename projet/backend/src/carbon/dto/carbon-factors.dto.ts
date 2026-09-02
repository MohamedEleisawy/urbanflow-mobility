import { ModeTransport } from '@prisma/client';

/**
 * Facteurs d'émission publiés par le microservice carbone (Phase 4).
 *
 * ═══ POURQUOI CE CONTRAT EXISTE ═══
 *
 * La recherche d'itinéraires doit pouvoir CLASSER des candidats par émissions
 * avant d'en retenir un. Appeler `POST /calculate` une fois par candidat
 * ferait des dizaines d'allers-retours HTTP par recherche.
 *
 * L'alternative — recopier la table des facteurs dans NestJS — est exactement
 * ce que le microservice interdit : `app/factors.py` déclare être « le SEUL
 * endroit où ces valeurs apparaissent ». On les LIT donc, on ne les duplique
 * pas. La source de vérité reste unique.
 *
 * ⚠️ UN MODE ABSENT DE `gPerKm` N'EST PAS UN MODE À ZÉRO. `ESCOOTER` n'a
 * aucun facteur documenté : son absence signifie « incalculable », jamais
 * « propre ». Tout code qui lit cette table doit traiter le `undefined`
 * comme une impossibilité de calcul, et non comme un 0.
 */
export interface CarbonFactorsDto {
  /// Grammes de CO₂ équivalent par KILOMÈTRE, par mode.
  gPerKm: Partial<Record<ModeTransport, number>>;

  /// Référence « et si j'avais pris la voiture ? », en g/km.
  carGPerKm: number;
}
