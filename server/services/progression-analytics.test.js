// Self-check du service d'agrégation Progression : `node server/services/progression-analytics.test.js`.
// Couvre les fonctions pures (régression, fenêtre glissante, classification) sur des historiques
// fabriqués, puis l'agrégation charge/volume, la tendance, le filtre de période et le sélecteur
// d'exercices sur une base :memory:. Indépendant de tout seed.

const assert = require("assert");
const Database = require("better-sqlite3");

const {
  regressionSlope,
  rollingPctChange,
  classifySlope,
  classifyPct,
  computeTrend,
  periodToDays,
  getProgression,
  getExercisesWithHistory,
} = require("./progression-analytics");

// Seuils config par défaut.
const CFG = { rolling_window: 3, trend_flat_slope: 0.1, trend_flat_pct: 2.0, default_period: "90" };

// --- régression (pente en kg/séance, x = index) ---
assert.strictEqual(regressionSlope([40, 42, 44]), 2, "croissant : +2 kg/séance");
assert.strictEqual(regressionSlope([50, 50, 50]), 0, "plat : 0");
assert.strictEqual(regressionSlope([44, 42, 40]), -2, "décroissant : -2");
assert.strictEqual(regressionSlope([50]), null, "1 point : indéterminé (null)");
assert.strictEqual(regressionSlope([]), null, "0 point : null");

// --- fenêtre glissante ---
// 6 séances, window 3 : moyenne(4,5,6)=5 vs moyenne(1,2,3)=2 → +150 %.
let r = rollingPctChange([1, 2, 3, 4, 5, 6], 3);
assert.ok(r.available && Math.abs(r.pct_change - 150) < 1e-9, "fenêtre pleine : +150 %");
// 5 séances < 2×3 : indisponible, pas de crash.
r = rollingPctChange([1, 2, 3, 4, 5], 3);
assert.deepStrictEqual(r, { window: 3, pct_change: null, available: false }, "trop peu de séances");
// moyenne précédente nulle → division impossible → indisponible.
r = rollingPctChange([0, 0, 0, 5, 5, 5], 3);
assert.strictEqual(r.available, false, "moyenne précédente nulle : indisponible");

// --- classification ---
assert.strictEqual(classifySlope(2, 0.1), "hausse");
assert.strictEqual(classifySlope(-2, 0.1), "baisse");
assert.strictEqual(classifySlope(0.05, 0.1), "stable");
assert.strictEqual(classifySlope(null, 0.1), "indetermine");
assert.strictEqual(classifyPct(5, 2), "hausse");
assert.strictEqual(classifyPct(-5, 2), "baisse");
assert.strictEqual(classifyPct(1, 2), "stable");

// --- computeTrend : peu de séances → tout indéterminé, jamais de crash ---
const t0 = computeTrend([], CFG);
assert.strictEqual(t0.regression.classification, "indetermine");
assert.strictEqual(t0.rolling.available, false);
assert.strictEqual(t0.rolling.classification, "indetermine");
const t1 = computeTrend([40, 42, 44], CFG);
assert.strictEqual(t1.regression.classification, "hausse");

// --- periodToDays ---
assert.strictEqual(periodToDays("30"), 30);
assert.strictEqual(periodToDays("90"), 90);
assert.strictEqual(periodToDays("all"), null);
assert.strictEqual(periodToDays("42"), undefined, "valeur invalide → undefined (route 400)");

// --- agrégation + tendance en base :memory: ---
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE users ( id INTEGER PRIMARY KEY );
  CREATE TABLE exercises ( id TEXT PRIMARY KEY, name TEXT NOT NULL );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, started_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress'
  );
  CREATE TABLE logged_sets (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, exercise_id TEXT NOT NULL,
    set_number INTEGER NOT NULL, reps INTEGER NOT NULL, load REAL NOT NULL, rir INTEGER
  );
`);
db.prepare("INSERT INTO users VALUES (1)").run();
db.prepare("INSERT INTO users VALUES (2)").run();
db.prepare("INSERT INTO exercises VALUES ('0001','Bench Press')").run();
db.prepare("INSERT INTO exercises VALUES ('0002','Squat')").run();

// Dates dynamiques relatives à maintenant pour tester le filtre de période.
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const insSess = db.prepare("INSERT INTO sessions VALUES (?,?,?,?)");
const insSet = db.prepare("INSERT INTO logged_sets VALUES (?,?,?,?,?,?,?)");

// s1 (récente) et s2 (plus récente) pour user 1, exercice 0001, toutes completed.
insSess.run("s1", 1, iso(10), "completed");
insSet.run("a", "s1", "0001", 1, 8, 40, 2); // max_load 40, volume 8*40=320
insSet.run("b", "s1", "0001", 2, 6, 40, 2); // + 6*40=240 → volume séance 560
insSess.run("s2", 1, iso(3), "completed");
insSet.run("c", "s2", "0001", 1, 8, 45, 2); // max_load 45, volume 360
// s3 in_progress (exclue), s4 autre user (exclu), s5 vieille (>90j, filtre 30/90).
insSess.run("s3", 1, iso(1), "in_progress");
insSet.run("d", "s3", "0001", 1, 99, 999, 0);
insSess.run("s4", 2, iso(2), "completed");
insSet.run("e", "s4", "0001", 1, 5, 60, 1);
insSess.run("s5", 1, iso(200), "completed");
insSet.run("f", "s5", "0001", 1, 10, 30, 2);

// period=all : 3 séances completed de user 1 (s5, s1, s2), triées ASC.
const all = getProgression(db, 1, "0001", "all", CFG);
assert.strictEqual(all.session_count, 3, "3 séances completed (s3/s4 exclues)");
assert.strictEqual(all.exercise_name, "Bench Press");
assert.deepStrictEqual(
  all.series.max_load.map((p) => p.value),
  [30, 40, 45],
  "max_load par séance, ordre chronologique"
);
assert.strictEqual(all.series.volume[1].value, 560, "volume s1 = 8*40 + 6*40");

// period=30 : la vieille séance s5 (200j) est exclue → 2 séances.
const p30 = getProgression(db, 1, "0001", "30", CFG);
assert.strictEqual(p30.session_count, 2, "filtre 30j exclut s5");
assert.deepStrictEqual(p30.series.max_load.map((p) => p.value), [40, 45]);

// Exercice existant sans historique → 200, séries vides, tendance indéterminée.
const empty = getProgression(db, 1, "0002", "all", CFG);
assert.strictEqual(empty.session_count, 0);
assert.strictEqual(empty.trend.regression.classification, "indetermine");

// Exercice inconnu → null (route 404).
assert.strictEqual(getProgression(db, 1, "9999", "all", CFG), null);

// Sélecteur : exercices loggés par user 1, plus récemment travaillé en premier.
// user 1 a loggé 0001 (dernière s2, 3j). Loggons 0002 plus récemment (1j) → doit passer devant.
insSess.run("s6", 1, iso(1), "completed");
insSet.run("g", "s6", "0002", 1, 5, 100, 2);
const listed = getExercisesWithHistory(db, 1);
assert.deepStrictEqual(
  listed.map((e) => e.id),
  ["0002", "0001"],
  "tri par dernière séance loggée (0002 plus récent)"
);
assert.strictEqual(listed[0].name, "Squat");

console.log("progression-analytics.test.js : OK");
