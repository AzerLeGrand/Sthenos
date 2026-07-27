// Helpers de présentation de l'onglet Progression. Isolés du composant Svelte pour être testables
// (mapping vers uPlot, formatage FR, libellés de tendance). Aucune logique de calcul : le serveur
// agrège, le front met en forme.

// Options du sélecteur de période. `default_period` de config.yml pilote la valeur initiale côté
// serveur ; ici on liste les choix offerts, alignés sur ce que la route accepte (30 / 90 / all).
export const PERIODS = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "all", label: "Tout" },
];

// Convertit une série [{date: ISO, value}] au format uPlot [[x en secondes unix…], [y…]].
// uPlot travaille en secondes unix pour l'axe temps ; on convertit chaque date ISO.
export function toUplotData(points) {
  const xs = [];
  const ys = [];
  for (const p of points || []) {
    xs.push(Math.floor(Date.parse(p.date) / 1000));
    ys.push(p.value);
  }
  return [xs, ys];
}

// Nombre en convention française : virgule décimale, arrondi à `decimals` (défaut 1), sans zéros
// superflus (560 → "560", 47,5 → "47,5", 0,42 → "0,42").
export function frNum(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const f = 10 ** decimals;
  return String(Math.round(n * f) / f).replace(".", ",");
}

// Inverse de frNum : lit un nombre saisi à la française (virgule décimale acceptée).
// Retourne { ok: false } plutôt que NaN, pour que l'appelant affiche un message plutôt qu'envoyer
// une valeur invalide au serveur. Refuse le vide, le signe et tout caractère parasite.
// ponytail: SetRow.svelte et RoutineExerciseForm.svelte portent chacun leur copie locale de cette
// fonction (antérieure) ; à consolider ici si un quatrième appelant apparaît.
export function parseFloatFr(str) {
  const t = String(str ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
  return { ok: true, value: parseFloat(t) };
}

// Libellé français d'une classification de tendance (régression ou fenêtre glissante).
export function trendLabel(classification) {
  switch (classification) {
    case "hausse":
      return "En hausse";
    case "baisse":
      return "En baisse";
    case "stable":
      return "Stable";
    default:
      return "Indéterminé";
  }
}
