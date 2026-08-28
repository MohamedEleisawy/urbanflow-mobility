// =============================================================================
// Mise en forme des valeurs affichées (étape 5A-4)
// =============================================================================
// Le backend rend des grammes, des mètres et des minutes — des unités de
// CALCUL. Un usager lit des kilogrammes, des kilomètres et des heures.
//
// Ces fonctions vivent à part parce que le suivi carbone, l'historique et le
// budget affichent tous les mêmes grandeurs : les recopier dans chaque écran
// garantirait que « 1,2 kg » ici devienne « 1.2kg » là.
// =============================================================================

/**
 * Grammes de CO₂ → texte lisible.
 *
 * En dessous du kilogramme, on garde les grammes : « 0,3 kg » est moins
 * parlant que « 300 g » pour un trajet court.
 */
export function formaterCo2(grammes: number): string {
  if (grammes < 1000) {
    return `${Math.round(grammes)} g`;
  }
  return `${(grammes / 1000).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} kg`;
}

/** Mètres → texte lisible. */
export function formaterDistance(metres: number): string {
  if (metres < 1000) {
    return `${Math.round(metres)} m`;
  }
  return `${(metres / 1000).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} km`;
}

/** Minutes → « 45 min » ou « 1 h 15 ». */
export function formaterDuree(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const heures = Math.floor(minutes / 60);
  const reste = Math.round(minutes % 60);

  return reste === 0 ? `${heures} h` : `${heures} h ${reste}`;
}

/**
 * Date ISO → « 25 août 2026 ».
 *
 * ⚠️ Les dates arrivent en CHAÎNES ISO 8601 (voir types.ts) : il faut les
 * reconstruire avant de les mettre en forme.
 */
export function formaterDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Date ISO → « 25 août 2026 à 09:30 » (bloc 5C-3).
 *
 * Les perturbations se lisent à l'heure près : « travaux depuis le 25 août »
 * ne dit pas si la ligne est coupée en ce moment. `formaterDate` suffit pour
 * un trajet enregistré, pas pour une alerte en cours.
 */
export function formaterDateHeure(iso: string): string {
  const date = new Date(iso);

  return `${date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })} à ${date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
