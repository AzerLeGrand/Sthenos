// Self-check de l'analyse quotidienne : `node server/services/daily-summary.test.js`.
// Couvre la construction pure du résumé (cas complet, métrique manquante = indicateur omis, baseline
// insuffisante = present mais available:false), l'upsert idempotent d'un recalcul sur base :memory:,
// et l'expression cron générée depuis analysis_start. Indépendant de tout seed.

const assert = require("assert");
const Database = require("better-sqlite3");

const { buildSummary, runDailySummary, getDailySummary, localDay } = require("./daily-summary");
const { toCronExpr } = require("./scheduler");

const CFG = { baseline_days: 3, hrv_trend_window: 2, timezone: "Europe/Paris" };

// Fabrique une série {date,value} à partir d'un objet {jour: valeur}.
const series = (obj) => Object.entries(obj).map(([date, value]) => ({ date, value }));

// --- buildSummary : cas complet ---------------------------------------------
// Jour couvert 2026-07-27. Baseline FC repos = moyenne des 3 jours précédents (24,25,26).
// VFC : fenêtre 2 → moyenne(26,27) vs moyenne(24,25).
{
  const inputs = {
    sleepSeries: series({ "2026-07-27": 7.5 }),
    restingSeries: series({ "2026-07-24": 54, "2026-07-25": 56, "2026-07-26": 55, "2026-07-27": 58 }),
    hrvSeries: series({ "2026-07-24": 40, "2026-07-25": 42, "2026-07-26": 44, "2026-07-27": 46 }),
  };
  const s = buildSummary("2026-07-27", inputs, CFG);

  assert.strictEqual(s.sleep_hours, 7.5, "sommeil brut du jour");
  assert.strictEqual(s.resting_hr.value, 58);
  assert.strictEqual(s.resting_hr.baseline, 55, "moyenne(54,56,55) = 55 (jour couvert exclu)");
  assert.strictEqual(s.resting_hr.delta, 3, "58 - 55");
  assert.strictEqual(s.resting_hr.available, true);
  // VFC : moyenne(44,46)=45 vs moyenne(40,42)=41 → +9,756…%
  assert.strictEqual(s.hrv_trend.available, true);
  assert.ok(Math.abs(s.hrv_trend.pct_change - ((45 - 41) / 41) * 100) < 1e-9, "tendance VFC");
}

// --- buildSummary : métrique manquante ce jour = indicateur OMIS -------------
// Montre non portée la nuit → pas de sleep_hours ni hrv ce jour ; resting présent.
{
  const inputs = {
    sleepSeries: series({ "2026-07-26": 7 }), // pas de point le 27
    restingSeries: series({ "2026-07-24": 54, "2026-07-25": 56, "2026-07-26": 55, "2026-07-27": 58 }),
    hrvSeries: series({ "2026-07-26": 44 }), // pas de point le 27
  };
  const s = buildSummary("2026-07-27", inputs, CFG);

  assert.ok(!("sleep_hours" in s), "sommeil absent ce jour → clé omise, jamais 0");
  assert.ok(!("hrv_trend" in s), "VFC absente ce jour → bloc omis");
  assert.ok("resting_hr" in s, "FC repos présente → bloc présent");
}

// --- buildSummary : baseline insuffisante = présent mais available:false -----
// Seulement 2 points précédents pour 3 requis → baseline null, available false (jamais inventée).
{
  const inputs = {
    sleepSeries: [],
    restingSeries: series({ "2026-07-25": 56, "2026-07-26": 55, "2026-07-27": 58 }),
    hrvSeries: series({ "2026-07-27": 46 }), // 1 point < 2×window → rollingPctChange indisponible
  };
  const s = buildSummary("2026-07-27", inputs, CFG);

  assert.strictEqual(s.resting_hr.value, 58, "valeur du jour bien présente");
  assert.strictEqual(s.resting_hr.baseline, null, "historique insuffisant → baseline null");
  assert.strictEqual(s.resting_hr.delta, null, "pas de delta sans baseline");
  assert.strictEqual(s.resting_hr.available, false);
  assert.strictEqual(s.hrv_trend.available, false, "VFC : historique insuffisant, pas de crash");
  assert.strictEqual(s.hrv_trend.pct_change, null);
}

// --- baseline : N derniers points par INDICE, trous calendaires ignorés ------
// 4 points précédents espacés ; on garde les 3 derniers présents (24 juin, 20 & 26 juillet), pas
// une fenêtre de 3 jours calendaires.
{
  const inputs = {
    sleepSeries: [],
    restingSeries: series({
      "2026-06-01": 100, // ignoré (4e plus ancien)
      "2026-06-24": 54,
      "2026-07-20": 56,
      "2026-07-26": 55,
      "2026-07-27": 58,
    }),
    hrvSeries: [],
  };
  const s = buildSummary("2026-07-27", inputs, CFG);
  assert.strictEqual(s.resting_hr.baseline, 55, "moyenne(54,56,55) des 3 derniers points, trous ignorés");
}

// --- upsert idempotent d'un recalcul ----------------------------------------
{
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE body_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, metric_type TEXT NOT NULL, value REAL NOT NULL,
      unit TEXT, recorded_at TEXT NOT NULL, source TEXT NOT NULL,
      UNIQUE (user_id, metric_type, recorded_at, source)
    );
    CREATE TABLE daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, date TEXT NOT NULL,
      payload TEXT NOT NULL, generated_at TEXT NOT NULL,
      UNIQUE (user_id, date)
    );
  `);
  const add = (metric_type, recorded_at, value) =>
    db.prepare(
      "INSERT INTO body_metrics (user_id, metric_type, value, recorded_at, source) VALUES (1,?,?,?,'apple_health')"
    ).run(metric_type, value, recorded_at);
  add("resting_hr", "2026-07-26", 55);
  add("resting_hr", "2026-07-27", 58);
  add("sleep_hours", "2026-07-27", 7.5);

  const first = runDailySummary(db, 1, "2026-07-27", CFG);
  assert.strictEqual(first.date, "2026-07-27");
  assert.strictEqual(first.payload.sleep_hours, 7.5);

  // Une donnée corrigée puis recalcul : une seule ligne, valeur remplacée (ON CONFLICT DO UPDATE).
  db.prepare(
    "UPDATE body_metrics SET value = 8 WHERE user_id = 1 AND metric_type = 'sleep_hours' AND recorded_at = '2026-07-27'"
  ).run();
  const second = runDailySummary(db, 1, "2026-07-27", CFG);
  const count = db.prepare("SELECT COUNT(*) AS n FROM daily_summaries WHERE user_id = 1").get().n;
  assert.strictEqual(count, 1, "recalcul : pas de doublon, un seul résumé par (user, date)");
  assert.strictEqual(second.payload.sleep_hours, 8, "recalcul : valeur remplacée");

  // Lecture : jour connu vs jour absent (état vide légitime, pas d'erreur).
  assert.strictEqual(getDailySummary(db, 1, "2026-07-27").payload.sleep_hours, 8);
  assert.deepStrictEqual(
    getDailySummary(db, 1, "2000-01-01"),
    { date: "2000-01-01", generated_at: null, payload: null },
    "jour sans résumé → payload null"
  );
  db.close();
}

// --- expression cron générée ------------------------------------------------
assert.strictEqual(toCronExpr("08:00"), "0 8 * * *", "08:00 → tous les jours à 8h00");
assert.strictEqual(toCronExpr("10:30"), "30 10 * * *");
assert.strictEqual(toCronExpr("00:05"), "5 0 * * *");
assert.throws(() => toCronExpr("8h00"), /invalide/, "format non HH:MM rejeté");
assert.throws(() => toCronExpr("24:00"), /invalide/, "heure hors plage rejetée");

// --- localDay : format et fuseau --------------------------------------------
assert.match(localDay("Europe/Paris"), /^\d{4}-\d{2}-\d{2}$/, "format AAAA-MM-JJ");
// 2026-07-27T00:30Z = 02:30 à Paris (été) → toujours le 27 ; en UTC-heure ce serait déjà passé minuit.
assert.strictEqual(
  localDay("Europe/Paris", new Date("2026-07-26T23:30:00Z")),
  "2026-07-27",
  "23:30 UTC = 01:30 Paris → jour local suivant"
);

console.log("daily-summary.test.js : OK");
