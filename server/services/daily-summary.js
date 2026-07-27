// Service de l'analyse quotidienne (docs/health-integration.md §7, docs/data-model.md §2.9).
// Produit le résumé du jour d'un utilisateur — sommeil, FC repos vs ligne de base, tendance VFC —
// puis l'upsert dans daily_summaries (un recalcul remplace le résumé du jour).
//
// Séparation pur / impur (même patron que progression-analytics.js) :
// - buildSummary : PURE (séries {date,value} déjà lues en entrée, aucune base) → testable seule.
// - loadSummaryInputs / runDailySummary / getDailySummary : impures (lecture body_metrics via les
//   fonctions existantes de body-metrics.js, écriture/lecture daily_summaries).
//
// DEUX natures d'absence, distinctes (cf. décisions de phase) :
//  1. Métrique manquante CE JOUR (montre non portée) → l'indicateur est entièrement OMIS du payload.
//     Jamais de 0 ni de valeur inventée à réinterpréter plus tard comme une donnée.
//  2. Historique insuffisant pour un sous-calcul (baseline, tendance) → l'indicateur reste présent,
//     mais son sous-calcul est explicitement null + available:false (comportement de rollingPctChange).

const { rollingPctChange } = require("./progression-analytics");
const { getMetricSeries } = require("./body-metrics");

// Valeur de `metricType` pour le jour exact `day` dans une série {date,value} triée, ou null.
function valueForDay(series, day) {
  const p = series.find((r) => r.date === day);
  return p ? p.value : null;
}

// Moyenne d'un tableau non vide (inline plutôt qu'importée : progression-analytics.mean n'est pas
// exportée et c'est une ligne — pas de raison de modifier son interface pour ça).
function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// --- Fonction pure ----------------------------------------------------------

// Construit le payload à partir des séries quotidiennes déjà lues. `cfg` = section health de config
// (baseline_days, hrv_trend_window). `day` = jour couvert ("YYYY-MM-DD").
//
// Baseline FC repos et fenêtre VFC raisonnent en INDICES de tableau, jamais en jours calendaires :
// on prend les N derniers points présents, quels que soient les trous entre eux — même logique que
// rollingPctChange qui ne connaît que des indices. available:false uniquement si moins de N points.
function buildSummary(day, { sleepSeries, restingSeries, hrvSeries }, cfg) {
  const out = {};

  // Sommeil : valeur brute du jour si présente, sinon indicateur omis.
  const sleep = valueForDay(sleepSeries, day);
  if (sleep !== null) out.sleep_hours = sleep;

  // FC repos : comparée à la moyenne des `baseline_days` points PRÉCÉDANT le jour couvert (exclu).
  const restingToday = valueForDay(restingSeries, day);
  if (restingToday !== null) {
    const before = restingSeries.filter((r) => r.date < day).map((r) => r.value);
    const window = before.slice(-cfg.baseline_days); // N derniers points, trous ignorés
    const available = window.length >= cfg.baseline_days;
    const baseline = available ? mean(window) : null;
    out.resting_hr = {
      value: restingToday,
      baseline,
      delta: baseline === null ? null : restingToday - baseline,
      baseline_days: cfg.baseline_days,
      available,
    };
  }

  // Tendance VFC : rollingPctChange réutilisée telle quelle sur les valeurs quotidiennes de hrv,
  // fenêtre finissant au jour couvert (points postérieurs exclus au cas où on recalcule un jour passé).
  const hrvToday = valueForDay(hrvSeries, day);
  if (hrvToday !== null) {
    const values = hrvSeries.filter((r) => r.date <= day).map((r) => r.value);
    out.hrv_trend = rollingPctChange(values, cfg.hrv_trend_window); // { window, pct_change, available }
  }

  return out;
}

// --- Fonctions impures ------------------------------------------------------

// Lit les trois séries quotidiennes nécessaires. getMetricSeries(..., "all") renvoie toute la série
// triée : on la filtre ensuite en mémoire (2 utilisateurs, volume trivial — pas de SQL dédié).
function loadSummaryInputs(db, userId) {
  return {
    sleepSeries: getMetricSeries(db, userId, "sleep_hours", "all").series,
    restingSeries: getMetricSeries(db, userId, "resting_hr", "all").series,
    hrvSeries: getMetricSeries(db, userId, "hrv", "all").series,
  };
}

// Calcule et enregistre le résumé du jour. ON CONFLICT (user_id, date) DO UPDATE : un recalcul
// (bouton ou cron rejoué) remplace le résumé du jour, cf. data-model.md §2.9.
function runDailySummary(db, userId, day, cfg) {
  const payload = buildSummary(day, loadSummaryInputs(db, userId), cfg);
  const generated_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO daily_summaries (user_id, date, payload, generated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, date)
       DO UPDATE SET payload = excluded.payload, generated_at = excluded.generated_at`
  ).run(userId, day, JSON.stringify(payload), generated_at);
  return { date: day, generated_at, payload };
}

// Lit le résumé d'un jour donné. Absence = état vide légitime (le cron n'a pas encore tourné), pas
// une erreur : renvoie { date, generated_at:null, payload:null }, cohérent avec getMetricSeries.
function getDailySummary(db, userId, day) {
  const row = db
    .prepare("SELECT generated_at, payload FROM daily_summaries WHERE user_id = ? AND date = ?")
    .get(userId, day);
  if (!row) return { date: day, generated_at: null, payload: null };
  return { date: day, generated_at: row.generated_at, payload: JSON.parse(row.payload) };
}

// Jour calendaire local dans un fuseau, au format "YYYY-MM-DD". Intl.DateTimeFormat en-CA rend
// exactement ce format ; pas de dépendance date, pas de piège UTC (cf. body-metrics.js).
function localDay(timezone, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

module.exports = {
  buildSummary,
  loadSummaryInputs,
  runDailySummary,
  getDailySummary,
  localDay,
};
