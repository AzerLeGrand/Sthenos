// Self-check minimal (sans framework) : `node server/services/routines.test.js`.
// Couvre la logique non triviale du service : isolation par propriétaire, position = MAX+1,
// cascade de suppression, reorder, et la validation pure des paramètres (rep_min > rep_max, etc.).

const assert = require("assert");
const Database = require("better-sqlite3");

const {
  getOwnedRoutine,
  listRoutines,
  createRoutine,
  renameRoutine,
  countExercises,
  deleteRoutine,
  getRoutineExercises,
  getRoutineExerciseIds,
  exerciseExists,
  getUserDefaults,
  addRoutineExercise,
  getRoutineExerciseInRoutine,
  reorderRoutineExercises,
  deleteRoutineExercise,
  validateParams,
} = require("./routines");

// Schéma minimal : les tables touchées (sous-ensemble de la migration 001). foreign_keys ON pour
// vérifier que la cascade applicative respecte bien la contrainte (une suppression naïve échouerait).
const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE users ( id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT );
  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    default_rir INTEGER, default_rep_min INTEGER, default_rep_max INTEGER, default_increment REAL
  );
  CREATE TABLE exercises (
    id TEXT PRIMARY KEY, name TEXT, category TEXT, equipment TEXT, image TEXT
  );
  CREATE TABLE routines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE routine_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id INTEGER NOT NULL REFERENCES routines(id),
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL, n_series INTEGER NOT NULL, rep_min INTEGER NOT NULL,
    rep_max INTEGER NOT NULL, rir_cible INTEGER NOT NULL, increment REAL NOT NULL,
    goal TEXT NOT NULL DEFAULT 'hypertrophy', rest_seconds INTEGER
  );
`);

db.prepare("INSERT INTO users (id, username) VALUES (1,'alice'),(2,'bob')").run();
db.prepare(
  "INSERT INTO user_settings VALUES (1, 2, 8, 12, 2.5), (2, 3, 5, 8, 5.0)"
).run(); // alice: rir 2 / 8-12 / +2.5 ; bob: rir 3 / 5-8 / +5.0
db.prepare("INSERT INTO exercises VALUES ('0001','curl','arms','dumbbell','i1.jpg')").run();
db.prepare("INSERT INTO exercises VALUES ('0002','press','chest','barbell','i2.jpg')").run();

// --- création + liste + comptage ---
const r = createRoutine(db, 1, "Push");
assert.strictEqual(r.exercise_count, 0, "routine créée : 0 exercice");
assert.deepStrictEqual(listRoutines(db, 1).length, 1, "alice a 1 routine");
assert.deepStrictEqual(listRoutines(db, 2).length, 0, "bob n'en a aucune");

// --- isolation par propriétaire ---
assert.ok(getOwnedRoutine(db, r.id, 1), "alice possède sa routine");
assert.strictEqual(getOwnedRoutine(db, r.id, 2), null, "bob ne voit pas la routine d'alice");

// --- existence exercice + défauts user_settings ---
assert.ok(exerciseExists(db, "0001"));
assert.ok(!exerciseExists(db, "9999"));
const d = getUserDefaults(db, 1);
assert.deepStrictEqual(
  [d.default_rir, d.default_rep_min, d.default_rep_max, d.default_increment],
  [2, 8, 12, 2.5],
  "défauts d'alice lus depuis user_settings"
);

// --- ajout : position = MAX+1 ---
const re1 = addRoutineExercise(db, r.id, {
  exercise_id: "0001", n_series: 3, rep_min: 8, rep_max: 12, rir_cible: 2, increment: 2.5, goal: "hypertrophy",
});
const re2 = addRoutineExercise(db, r.id, {
  exercise_id: "0002", n_series: 4, rep_min: 5, rep_max: 8, rir_cible: 1, increment: 5, goal: "strength", rest_seconds: 120,
});
let ex = getRoutineExercises(db, r.id);
assert.deepStrictEqual(ex.map((e) => e.position), [1, 2], "positions 1 puis 2");
assert.strictEqual(ex[0].name, "curl", "enrichi du name de l'exercice");
assert.strictEqual(countExercises(db, r.id), 2);

// --- reorder : inverse l'ordre, positions contiguës ---
reorderRoutineExercises(db, r.id, [re2, re1]);
ex = getRoutineExercises(db, r.id);
assert.deepStrictEqual(ex.map((e) => e.id), [re2, re1], "ordre inversé");
assert.deepStrictEqual(ex.map((e) => e.position), [1, 2], "positions réattribuées 1..n");

// --- suppression d'un exercice : trou de position toléré, MAX+1 reste correct ---
deleteRoutineExercise(db, re2);
assert.deepStrictEqual(getRoutineExerciseIds(db, r.id), [re1], "re2 retiré");
const re3 = addRoutineExercise(db, r.id, {
  exercise_id: "0002", n_series: 3, rep_min: 8, rep_max: 12, rir_cible: 2, increment: 2.5, goal: "hypertrophy",
});
// re1 a gardé position 2 (ex-2e après reorder) → nouvel ajout en position 3, pas de collision.
assert.strictEqual(getRoutineExercises(db, r.id).find((e) => e.id === re3).position, 3, "MAX+1 malgré le trou");

// --- renommage ---
renameRoutine(db, r.id, "Pull");
assert.strictEqual(getOwnedRoutine(db, r.id, 1).name, "Pull");

// --- appartenance d'un routine_exercise à une routine ---
assert.ok(getRoutineExerciseInRoutine(db, re1, r.id), "re1 appartient à la routine");
assert.strictEqual(getRoutineExerciseInRoutine(db, re1, 999), null, "pas dans une autre routine");

// --- cascade de suppression (échouerait sans purge des enfants, foreign_keys ON) ---
deleteRoutine(db, r.id);
assert.strictEqual(getOwnedRoutine(db, r.id, 1), null, "routine supprimée");
assert.strictEqual(countExercises(db, r.id), 0, "exercices enfants purgés");

// --- validateParams ---
const base = { n_series: 3, rep_min: 8, rep_max: 12, rir_cible: 2, increment: 2.5, goal: "hypertrophy", rest_seconds: null };
assert.strictEqual(validateParams(base), null, "params valides");
assert.ok(validateParams({ ...base, rep_min: 13 }), "rep_min > rep_max rejeté");
assert.ok(validateParams({ ...base, n_series: 0 }), "n_series < 1 rejeté");
assert.ok(validateParams({ ...base, increment: 0 }), "increment <= 0 rejeté");
assert.ok(validateParams({ ...base, goal: "power" }), "goal inconnu rejeté");
assert.ok(validateParams({ ...base, rir_cible: -1 }), "rir_cible négatif rejeté");
assert.ok(validateParams({ ...base, rest_seconds: -5 }), "rest_seconds négatif rejeté");
assert.strictEqual(validateParams({ ...base, rest_seconds: undefined }), null, "rest_seconds absent toléré");
assert.strictEqual(validateParams({ ...base, rir_cible: 0 }), null, "rir_cible 0 valide");

console.log("routines.test.js : OK");
