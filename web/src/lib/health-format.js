// Helpers de présentation de l'onglet Santé. Isolés du composant Svelte pour être testables
// (libellés FR, construction du sélecteur de métrique). Aucune logique de calcul : le serveur
// agrège et dédoublonne, le front met en forme.
//
// Le sélecteur de période (PERIODS) et le formatage numérique (frNum, toUplotData) sont réutilisés
// tels quels depuis progression-format.js : mêmes 30/90/all, même convention décimale française.

// Libellés français des metric_type. Ils vivent ici et pas en base, comme la table de
// correspondance du catalogue d'exercices : ce sont des éléments d'interface (docs/frontend.md §7).
// L'ordre de cet objet fixe l'ordre du sélecteur : le poids d'abord (seule métrique saisie à la
// main), puis les indicateurs de l'Apple Watch du plus consulté au moins consulté.
export const METRIC_LABELS = {
  weight: "Poids",
  resting_hr: "FC de repos",
  hrv: "Variabilité cardiaque",
  sleep_hours: "Sommeil",
  steps: "Pas",
  active_energy: "Énergie active",
  vo2max: "VO2 max",
  cardio_recovery: "Récupération cardiaque",
};

// Métrique saisie à la main : toujours proposée, même sans aucune donnée, puisque c'est justement
// le formulaire de cet écran qui la remplit (sans balance connectée, Apple Santé ne la fournit pas).
export const MANUAL_METRIC = "weight";

// Libellé d'une métrique ; repli sur l'identifiant brut si elle n'est pas encore traduite
// (même règle que les libellés du catalogue : jamais d'écran vide faute de traduction).
export function metricLabel(metricType) {
  return METRIC_LABELS[metricType] || metricType;
}

// Options du sélecteur, à partir de la liste renvoyée par GET /api/body-metrics (métriques ayant
// au moins une donnée). Le poids y est injecté même absent. Une métrique remontée par le serveur
// mais inconnue du front est conservée (repli sur son identifiant) plutôt que masquée : on ne perd
// jamais une donnée réellement présente en base.
export function metricOptions(available) {
  const withData = new Set((available || []).map((m) => m.metric_type));
  withData.add(MANUAL_METRIC);

  const ordered = Object.keys(METRIC_LABELS).filter((t) => withData.has(t));
  const extras = [...withData].filter((t) => !(t in METRIC_LABELS)).sort();

  return [...ordered, ...extras].map((t) => ({ value: t, label: metricLabel(t) }));
}

// Date du jour au format attendu par <input type="date"> et par l'API (AAAA-MM-JJ), en heure
// LOCALE. toISOString() est volontairement évité : il basculerait sur la veille ou le lendemain
// selon le fuseau, exactement le piège traité côté serveur (voir server/services/body-metrics.js).
export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
