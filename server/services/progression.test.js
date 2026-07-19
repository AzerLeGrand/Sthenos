// Self-check du service de progression : `node server/services/progression.test.js`.
// Couvre CHAQUE branche de décision (A→G2), la variante force (§7) et le mode dégradé (§8)
// sur des historiques fabriqués à la main — indépendant de tout seed. Plus un cas de bout en bout
// sur suggestExercise (threading du point de départ) et le groupement de getExerciseHistory.

const assert = require("assert");
const Database = require("better-sqlite3");

const { decideSet, suggestExercise, getExerciseHistory, isStalled } = require("./progression");

// Seuils globaux (valeurs config par défaut) et paramètres hypertrophie.
const T = { easy_delta: 2, deload_pct: 0.1, stall_sessions: 3, load_rounding_step: 2.5 };
const HYP = { rep_min: 8, rep_max: 12, rir_cible: 2, increment: 2.5 };

// Helper : une occurrence de série. rir optionnel (undefined = non fourni au décideur).
const set = (reps, load, rir) => ({ set_number: 1, reps, load, rir });

// decideSet(param, lastSets, goal, thresholds, prevLoad)
const hyp = (lastSets, prevLoad = null) => decideSet(HYP, lastSets, "hypertrophy", T, prevLoad);

// --- A : pas d'historique ---
assert.deepStrictEqual(hyp([]), { suggested_load: null, suggested_reps: null, reason: "baseline" });
assert.deepStrictEqual(hyp([], 50), { suggested_load: 50, suggested_reps: null, reason: "baseline" });

// --- B : échec (reps < rep_min) ---
assert.deepStrictEqual(hyp([set(6, 50, 2)]), { suggested_load: 45, suggested_reps: 8, reason: "deload" });

// --- C : stagnation (3 séances identiques) ---
// reps=10 dans la fourchette avec marge → serait G1, mais C (checké avant D/E/G) l'emporte.
const stalled = [set(10, 50, 2), set(10, 50, 2), set(10, 50, 2)];
assert.deepStrictEqual(hyp(stalled), { suggested_load: 45, suggested_reps: 8, reason: "deload" });
// 2 occurrences seulement → pas encore stagnation → G1.
assert.strictEqual(hyp([set(10, 50, 2), set(10, 50, 2)]).reason, "increase_reps");

// --- D : charge trop légère (rir ≥ cible + easy_delta) ---
assert.deepStrictEqual(hyp([set(10, 50, 4)]), {
  suggested_load: 52.5, suggested_reps: 8, reason: "increase_load_easy",
});

// --- E : palier haut atteint (reps ≥ rep_max, rir ≥ cible) ---
assert.deepStrictEqual(hyp([set(12, 50, 2)]), {
  suggested_load: 52.5, suggested_reps: 8, reason: "increase_load",
});

// --- F : sommet mais rir trop élevé → consolider ---
assert.deepStrictEqual(hyp([set(12, 50, 1)]), {
  suggested_load: 50, suggested_reps: 12, reason: "hold",
});

// --- G1 : progression par les reps (dans fourchette, marge de rir) ---
assert.deepStrictEqual(hyp([set(10, 50, 2)]), {
  suggested_load: 50, suggested_reps: 11, reason: "increase_reps",
});
// G1 plafonné à rep_max.
assert.strictEqual(hyp([set(11, 50, 2)]).suggested_reps, 12);

// --- G2 : maintien (dans fourchette, rir trop élevé) ---
assert.deepStrictEqual(hyp([set(10, 50, 1)]), {
  suggested_load: 50, suggested_reps: 10, reason: "hold",
});

// --- Mode dégradé (§8) : rir manquant → garde sautée, degraded:true ---
let d = hyp([set(12, 50, undefined)]); // sommet sans rir → increase_load
assert.strictEqual(d.reason, "increase_load");
assert.strictEqual(d.degraded, true);
d = hyp([set(10, 50, undefined)]); // fourchette sans rir → increase_reps
assert.strictEqual(d.reason, "increase_reps");
assert.strictEqual(d.degraded, true);
// B reste valable sans rir, SANS marqueur dégradé (le deload n'utilise pas le rir).
d = hyp([set(6, 50, undefined)]);
assert.strictEqual(d.reason, "deload");
assert.strictEqual(d.degraded, undefined);

// --- Variante force (§7) ---
const FORCE = { rep_min: 3, rep_max: 6, rir_cible: 2, increment: 5 };
const force = (lastSets) => decideSet(FORCE, lastSets, "strength", T, null);
// Sommet : montée de charge même si rir < cible (en hypertrophie ce serait 'hold').
assert.deepStrictEqual(force([set(6, 100, 0)]), {
  suggested_load: 105, suggested_reps: 3, reason: "increase_load",
});
// Fourchette : +1 rep systématique même si rir < cible (en hypertrophie ce serait 'hold').
assert.deepStrictEqual(force([set(4, 100, 0)]), {
  suggested_load: 100, suggested_reps: 5, reason: "increase_reps",
});
// Deload sur échec inchangé.
assert.strictEqual(force([set(2, 100, 2)]).reason, "deload");

// --- isStalled unitaire ---
assert.strictEqual(isStalled([set(10, 50), set(10, 50), set(10, 50)], 3), true);
assert.strictEqual(isStalled([set(10, 50), set(10, 55), set(10, 50)], 3), false);
assert.strictEqual(isStalled([set(10, 50), set(10, 50)], 3), false, "pas assez d'occurrences");

// --- suggestExercise : threading du point de départ vers les séries neuves (cas A) ---
// n_series=3, une seule séance passée avec la série 1 seulement. Séries 2 et 3 sont neuves :
// série 2 démarre sur la suggestion de la série 1, série 3 sur celle de la série 2.
const param3 = { ...HYP, n_series: 3, goal: "hypertrophy" };
const sessions = [{ sets: [{ set_number: 1, reps: 10, load: 50, rir: 2 }] }];
const sugg = suggestExercise(param3, sessions, T);
assert.strictEqual(sugg.length, 3);
assert.deepStrictEqual(sugg[0], { set_number: 1, suggested_load: 50, suggested_reps: 11, reason: "increase_reps" });
assert.strictEqual(sugg[1].reason, "baseline");
assert.strictEqual(sugg[1].suggested_load, 50, "série 2 neuve → charge de la série 1");
assert.strictEqual(sugg[2].suggested_load, 50, "série 3 neuve → charge de la série 2");

// --- getExerciseHistory : filtre 'completed' + groupement DESC ---
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE sessions ( id TEXT PRIMARY KEY, user_id INTEGER, started_at TEXT, status TEXT );
  CREATE TABLE logged_sets (
    id TEXT PRIMARY KEY, session_id TEXT, exercise_id TEXT, set_number INTEGER,
    reps INTEGER, load REAL, rir INTEGER
  );
`);
db.prepare("INSERT INTO sessions VALUES ('s1',1,'2026-01-01T10:00Z','completed')").run();
db.prepare("INSERT INTO sessions VALUES ('s2',1,'2026-01-08T10:00Z','completed')").run();
db.prepare("INSERT INTO sessions VALUES ('s3',1,'2026-01-15T10:00Z','in_progress')").run(); // en cours
db.prepare("INSERT INTO sessions VALUES ('s4',2,'2026-01-09T10:00Z','completed')").run();    // autre user
const insSet = db.prepare("INSERT INTO logged_sets VALUES (?,?,?,?,?,?,?)");
insSet.run("a", "s1", "0001", 1, 8, 40, 2);
insSet.run("b", "s2", "0001", 1, 10, 45, 2);
insSet.run("c", "s3", "0001", 1, 99, 99, 0); // in_progress : doit être exclu
insSet.run("d", "s4", "0001", 1, 5, 60, 1); // autre user : exclu

const hist = getExerciseHistory(db, 1, "0001");
assert.strictEqual(hist.length, 2, "seulement les 2 séances completed de l'user 1");
assert.strictEqual(hist[0].sets[0].load, 45, "plus récente (s2) en premier");
assert.strictEqual(hist[1].sets[0].load, 40, "s1 ensuite");

console.log("progression.test.js : OK");
