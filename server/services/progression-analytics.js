// Service d'agrégation de l'historique pour l'onglet Progression (docs/frontend.md §3.2).
// Distinct de progression.js : celui-ci AGRÈGE le passé (courbes + tendance), l'autre DÉCIDE la
// prochaine charge. Deux responsabilités, deux fichiers.
//
// Séparation pur / impur (comme progression.js) :
// - regressionSlope / rollingPctChange / classify* / computeTrend : PURES (tableaux en entrée,
//   aucune base) → testables sur des historiques fabriqués.
// - fetchSessionAggregates / getExercisesWithHistory / getProgression : impures (SQL isolé).
//
// Séances prises en compte : uniquement status = 'completed' (même filtre que progression.js).
// Point temporel : sessions.started_at. Seuils dans config.yml (section progression_analytics).

// --- Fonctions pures -------------------------------------------------------

// Moyenne d'un tableau non vide. Renvoie null si vide (pas de division par zéro implicite).
function mean(xs) {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Pente d'une régression linéaire par moindres carrés, avec x = index chronologique de séance
// (0, 1, 2…). Donc la pente s'exprime en kg PAR SÉANCE. Renvoie null si moins de 2 points
// (une droite exige au moins deux séances ; sinon la tendance est indéterminée).
function regressionSlope(values) {
  const n = values.length;
  if (n < 2) return null;
  const xbar = (n - 1) / 2; // moyenne de 0..n-1
  const ybar = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xbar) * (values[i] - ybar);
    den += (i - xbar) * (i - xbar);
  }
  if (den === 0) return null; // n<2 déjà exclu ; garde défensive
  return num / den;
}

// Variation en pourcentage sur fenêtre glissante : moyenne des N dernières séances comparée à la
// moyenne des N précédentes. `values` est chronologique (plus ancienne d'abord).
// Indisponible (available:false, pct_change:null) si moins de 2N séances, ou si la moyenne
// précédente est nulle (division impossible). Comportement explicite, jamais de crash / NaN.
function rollingPctChange(values, window) {
  if (window < 1 || values.length < 2 * window) {
    return { window, pct_change: null, available: false };
  }
  const recent = mean(values.slice(-window));
  const previous = mean(values.slice(-2 * window, -window));
  if (previous === 0) {
    return { window, pct_change: null, available: false };
  }
  const pct = ((recent - previous) / previous) * 100;
  return { window, pct_change: pct, available: true };
}

// Classe une pente (kg/séance) : |pente| < seuil = "stable" ; sinon signe. null = "indetermine".
function classifySlope(slope, flat) {
  if (slope === null || slope === undefined) return "indetermine";
  if (Math.abs(slope) < flat) return "stable";
  return slope > 0 ? "hausse" : "baisse";
}

// Classe une variation en % : |pct| < seuil = "stable" ; sinon signe. null = "indetermine".
function classifyPct(pct, flat) {
  if (pct === null || pct === undefined) return "indetermine";
  if (Math.abs(pct) < flat) return "stable";
  return pct > 0 ? "hausse" : "baisse";
}

// Assemble la section "trend" du payload à partir des meilleures charges par séance (chronologiques).
// `cfg` = section progression_analytics de config.yml.
function computeTrend(loads, cfg) {
  const slope = regressionSlope(loads);
  const rolling = rollingPctChange(loads, cfg.rolling_window);
  return {
    regression: {
      slope,
      classification: classifySlope(slope, cfg.trend_flat_slope),
    },
    rolling: {
      window: rolling.window,
      pct_change: rolling.pct_change,
      classification: rolling.available
        ? classifyPct(rolling.pct_change, cfg.trend_flat_pct)
        : "indetermine",
      available: rolling.available,
    },
  };
}

// Convertit le sélecteur de période en nombre de jours, ou null pour "all" (pas de filtre).
// Renvoie undefined si la valeur est invalide (la route répond alors 400).
function periodToDays(period) {
  if (period === "all") return null;
  if (period === "30") return 30;
  if (period === "90") return 90;
  return undefined;
}

// --- Fonctions impures (SQL isolé) -----------------------------------------

// Agrégats par séance pour un exercice : meilleure charge (MAX(load)) et volume (SUM(reps*load)).
// Filtré par utilisateur, exercice, séances clôturées, et période (borne basse sur started_at).
// Trié par started_at ASC (chronologique) : nécessaire aux courbes et à la régression.
// La comparaison de dates ISO 8601 UTC en chaîne est lexicographiquement correcte.
function fetchSessionAggregates(db, userId, exerciseId, periodDays) {
  const params = [userId, exerciseId];
  let cutoffClause = "";
  if (periodDays !== null) {
    const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    cutoffClause = "AND s.started_at >= ?";
    params.push(cutoff);
  }
  return db
    .prepare(
      `SELECT s.started_at AS date,
              MAX(ls.load) AS max_load,
              SUM(ls.reps * ls.load) AS volume
       FROM logged_sets ls
       JOIN sessions s ON s.id = ls.session_id
       WHERE s.user_id = ? AND ls.exercise_id = ? AND s.status = 'completed' ${cutoffClause}
       GROUP BY s.id
       ORDER BY s.started_at ASC`
    )
    .all(...params);
}

// Progression complète d'un exercice pour l'utilisateur courant. Renvoie null si l'exercice n'existe
// pas dans le catalogue (la route répond 404). Un exercice existant sans séance clôturée renvoie des
// séries vides et une tendance "indetermine" (état valide, 200).
function getProgression(db, userId, exerciseId, period, cfg) {
  const periodDays = periodToDays(period); // supposé déjà validé par la route
  const ex = db.prepare("SELECT name FROM exercises WHERE id = ?").get(exerciseId);
  if (!ex) return null;

  const rows = fetchSessionAggregates(db, userId, exerciseId, periodDays);
  const max_load = rows.map((r) => ({ date: r.date, value: r.max_load }));
  const volume = rows.map((r) => ({ date: r.date, value: r.volume }));

  return {
    exercise_id: exerciseId,
    exercise_name: ex.name,
    period,
    session_count: rows.length,
    series: { max_load, volume }, // axes dupliqués : chaque série est autoportante {date,value}
    trend: computeTrend(
      rows.map((r) => r.max_load),
      cfg
    ),
  };
}

// Exercices déjà loggés par l'utilisateur (≥ 1 séance clôturée), pour peupler le sélecteur — pas les
// 1324 du catalogue. Tri : dernière séance loggée en premier (MAX(started_at) DESC), l'exercice
// travaillé récemment étant le plus probablement consulté. id + nom suffisent au sélecteur.
function getExercisesWithHistory(db, userId) {
  return db
    .prepare(
      `SELECT ls.exercise_id AS id, e.name AS name
       FROM logged_sets ls
       JOIN sessions s ON s.id = ls.session_id
       JOIN exercises e ON e.id = ls.exercise_id
       WHERE s.user_id = ? AND s.status = 'completed'
       GROUP BY ls.exercise_id
       ORDER BY MAX(s.started_at) DESC`
    )
    .all(userId);
}

module.exports = {
  regressionSlope,
  rollingPctChange,
  classifySlope,
  classifyPct,
  computeTrend,
  periodToDays,
  getProgression,
  getExercisesWithHistory,
};
