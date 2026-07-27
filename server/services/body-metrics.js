// Service des indicateurs corporels (docs/health-integration.md §4, docs/data-model.md §2.8).
// Deux usages : la saisie manuelle (poids) et la lecture des séries pour l'onglet Santé.
// L'INGESTION Apple Santé vit dans health-ingest.js : source externe, parsing défensif propre,
// deux responsabilités distinctes. Ce fichier détient en revanche la liste canonique des
// metric_type et leurs unités, dont health-ingest.js dépend (source de vérité unique).
//
// DÉROGATION DE CONVENTION, assumée : `recorded_at` est ici une DATE CALENDAIRE LOCALE
// ("YYYY-MM-DD"), et non de l'ISO 8601 UTC comme les `created_at` du reste du schéma.
// Raison : les huit métriques retenues sont des indicateurs QUOTIDIENS (sommeil d'une nuit, pas
// d'une journée, poids d'un matin) ; c'est le jour vécu par l'utilisateur qui porte le sens, pas
// un instant UTC. C'est aussi la seule granularité à laquelle la contrainte
// UNIQUE(user_id, metric_type, recorded_at, source) mord réellement : à la seconde près, deux
// exports du même jour créeraient deux lignes pour la même mesure.

const { periodToDays } = require("./progression-analytics");

// Métriques retenues (docs/health-integration.md §4) et leur unité par défaut. Le modèle
// body_metrics étant clé-valeur, en ajouter une n'exige aucune migration : une ligne ici,
// et l'entrée de mapping correspondante dans health-ingest.js si elle vient d'Apple Santé.
const METRIC_UNITS = {
  weight: "kg", // poids (saisie manuelle tant qu'il n'y a pas de balance connectée)
  resting_hr: "bpm", // fréquence cardiaque au repos
  hrv: "ms", // variabilité de la fréquence cardiaque
  vo2max: "ml/kg/min", // capacité cardio-respiratoire
  cardio_recovery: "bpm", // récupération cardiaque à une minute
  steps: "count", // pas
  active_energy: "kcal", // dépense énergétique active
  sleep_hours: "h", // durée de sommeil
};

// Vrai si `t` est un metric_type connu. Sert aux routes pour répondre 400 sur une valeur inventée
// (entrée invalide) plutôt que 404 (ressource absente).
function isKnownMetric(t) {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(METRIC_UNITS, t);
}

// Extrait la date calendaire "YYYY-MM-DD" d'une chaîne, SANS jamais passer par un objet Date.
// C'est volontaire et c'est le point le plus délicat de la phase : Health Auto Export date ses
// points en heure LOCALE avec offset ("2026-07-26 00:30:00 +0200"). Convertir en Date puis lire la
// date résultante donnerait l'instant UTC (2026-07-25T22:30Z) et classerait le point sur la VEILLE.
// On lit donc le composant date tel qu'il est écrit dans la chaîne, qui est déjà le jour local.
// Accepte aussi bien "2026-07-26" (valeur d'un <input type="date">) que les formats horodatés.
// Retourne null si la chaîne ne commence pas par une date calendaire plausible.
function toCalendarDay(raw) {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/.exec(raw.trim());
  return m ? m[1] : null;
}

// Borne basse d'une période, exprimée dans le même format que recorded_at (jour calendaire).
// Retourne null pour "all" (aucun filtre).
// ponytail: la borne est calculée en UTC alors que recorded_at est local — décalage possible d'un
// jour sur le point le plus ancien d'une fenêtre de 30/90 jours, sans conséquence pratique.
function cutoffDay(periodDays) {
  if (periodDays === null) return null;
  return new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// --- Écriture ---------------------------------------------------------------

// Insère ou corrige une mesure. `source` n'est JAMAIS fourni par l'appelant HTTP : les deux
// sources ont leur propre point d'entrée (ici 'manual', health-ingest.js pour 'apple_health').
//
// Les DEUX sources sont en DO UPDATE. Le DO NOTHING initialement prévu pour apple_health supposait
// un horodatage précis, où un rejeu portait forcément la même valeur. Depuis le passage à la
// granularité jour ce n'est plus vrai : un export de midi porte un total PARTIEL (des pas, une
// dépense énergétique) que l'export du soir complète. Ce n'est pas un doublon mais une correction
// légitime, et DO NOTHING la gèlerait silencieusement.
// `unit` est optionnelle : l'ingestion transmet celle annoncée par Health Auto Export (elle seule
// sait si elle envoie des kJ ou des kcal), la saisie manuelle l'omet et prend le défaut du type.
function upsertMetric(db, userId, { metric_type, value, recorded_at, source, unit }) {
  const finalUnit = unit ?? METRIC_UNITS[metric_type] ?? null;

  db.prepare(
    `INSERT INTO body_metrics (user_id, metric_type, value, unit, recorded_at, source)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, metric_type, recorded_at, source)
       DO UPDATE SET value = excluded.value, unit = excluded.unit`
  ).run(userId, metric_type, value, finalUnit, recorded_at, source);

  return { metric_type, value, unit: finalUnit, recorded_at, source };
}

// Saisie manuelle : source forcée à 'manual'. Enveloppe explicite pour que la route n'ait jamais
// à choisir la source elle-même.
function upsertManual(db, userId, entry) {
  return upsertMetric(db, userId, { ...entry, source: "manual" });
}

// --- Lecture ----------------------------------------------------------------

// Métriques ayant au moins une donnée pour cet utilisateur, pour peupler le sélecteur de l'onglet
// Santé (même rôle que getExercisesWithHistory en phase 4 : on ne propose pas ce qui est vide).
// `unit` est une colonne nue accompagnant MAX(recorded_at) : SQLite garantit alors qu'elle provient
// de la ligne la plus récente (règle documentée des « bare columns » avec un unique min()/max()).
// Le poids reste ajouté côté front même sans donnée : il est toujours saisissable.
function listAvailableMetrics(db, userId) {
  return db
    .prepare(
      `SELECT metric_type, unit, COUNT(*) AS point_count, MAX(recorded_at) AS last_recorded_at
       FROM body_metrics
       WHERE user_id = ?
       GROUP BY metric_type
       ORDER BY metric_type ASC`
    )
    .all(userId);
}

// Série d'une métrique sur une période. `period` est supposée déjà validée par la route.
// Un jour peut porter deux lignes (poids saisi à la main ET remonté par une balance) : on n'en
// renvoie qu'une, en faisant gagner 'manual'. MAX(source) suffit ('manual' > 'apple_health' en
// ordre lexical) et, même règle des colonnes nues que ci-dessus, `value` et `unit` proviennent de
// la ligne retenue. Deux points au même x casseraient la courbe.
function getMetricSeries(db, userId, metricType, period) {
  const cutoff = cutoffDay(periodToDays(period));
  const params = [userId, metricType];
  let cutoffClause = "";
  if (cutoff !== null) {
    cutoffClause = "AND recorded_at >= ?";
    params.push(cutoff);
  }

  const rows = db
    .prepare(
      `SELECT recorded_at AS date, MAX(source) AS source, value, unit
       FROM body_metrics
       WHERE user_id = ? AND metric_type = ? ${cutoffClause}
       GROUP BY recorded_at
       ORDER BY recorded_at ASC`
    )
    .all(...params);

  // Unité affichée : celle du point le plus récent qui en porte une (la colonne est nullable),
  // à défaut l'unité par défaut de la métrique.
  const seen = [...rows].reverse().find((r) => r.unit);

  return {
    metric_type: metricType,
    unit: seen ? seen.unit : (METRIC_UNITS[metricType] ?? null),
    period,
    point_count: rows.length,
    series: rows.map((r) => ({ date: r.date, value: r.value, source: r.source })),
  };
}

module.exports = {
  METRIC_UNITS,
  isKnownMetric,
  toCalendarDay,
  upsertMetric,
  upsertManual,
  listAvailableMetrics,
  getMetricSeries,
};
