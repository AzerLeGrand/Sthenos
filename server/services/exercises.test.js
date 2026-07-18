// Self-check minimal (sans framework) : `node server/services/exercises.test.js`.
// Couvre filtres combinés, recherche, pagination, parse de secondary_muscles et meta,
// sur une base SQLite en mémoire remplie de quelques exercices.

const assert = require("assert");
const Database = require("better-sqlite3");

const { listExercises, getExerciseById, getMeta } = require("./exercises");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE exercises (
    id TEXT PRIMARY KEY, name TEXT, category TEXT, equipment TEXT, target TEXT,
    muscle_group TEXT, secondary_muscles TEXT, instructions_en TEXT, image TEXT, gif_url TEXT
  );
`);
const ins = db.prepare(`INSERT INTO exercises
  (id,name,category,equipment,target,muscle_group,secondary_muscles,instructions_en,image,gif_url)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
ins.run("0001", "3/4 sit-up", "waist", "body weight", "abs", "hip flexors",
  '["hip flexors","lower back"]', "instr1", "images/1.jpg", "videos/1.gif");
ins.run("0002", "barbell curl", "upper arms", "barbell", "biceps", "biceps",
  "[]", "instr2", "images/2.jpg", "videos/2.gif");
ins.run("0003", "dumbbell curl", "upper arms", "dumbbell", "biceps", "biceps",
  null, "instr3", "images/3.jpg", "videos/3.gif"); // secondary_muscles null (parse défensif)
ins.run("0004", "cable curl", "upper arms", "cable", "biceps", "biceps",
  "not-json", "instr4", "images/4.jpg", "videos/4.gif"); // JSON corrompu

// --- recherche texte ---
let r = listExercises(db, { q: "curl", page: 1, limit: 10 });
assert.strictEqual(r.total, 3, "q=curl → 3 résultats");
assert.ok(r.items.every((e) => e.name.includes("curl")));
assert.strictEqual(r.items[0].instructions_en, undefined, "liste : pas d'instructions_en");
assert.strictEqual(r.items[0].secondary_muscles, undefined, "liste : pas de secondary_muscles");

// --- filtres combinés ---
r = listExercises(db, { q: "curl", equipment: "dumbbell", page: 1, limit: 10 });
assert.strictEqual(r.total, 1, "curl + dumbbell → 1");
assert.strictEqual(r.items[0].id, "0003");

r = listExercises(db, { category: "upper arms", page: 1, limit: 10 });
assert.strictEqual(r.total, 3, "category upper arms → 3");

// --- pagination ---
r = listExercises(db, { category: "upper arms", page: 1, limit: 2 });
assert.strictEqual(r.items.length, 2, "page 1 : 2 items");
assert.strictEqual(r.total, 3, "total inchangé par la pagination");
const r2 = listExercises(db, { category: "upper arms", page: 2, limit: 2 });
assert.strictEqual(r2.items.length, 1, "page 2 : 1 item restant");
assert.notStrictEqual(r.items[0].id, r2.items[0].id, "pages disjointes");

// --- détail + parse secondary_muscles ---
assert.deepStrictEqual(getExerciseById(db, "0001").secondary_muscles, ["hip flexors", "lower back"]);
assert.deepStrictEqual(getExerciseById(db, "0003").secondary_muscles, [], "null → []");
assert.deepStrictEqual(getExerciseById(db, "0004").secondary_muscles, [], "JSON corrompu → []");
assert.ok(getExerciseById(db, "0001").instructions_en, "détail : instructions_en présent");
assert.strictEqual(getExerciseById(db, "9999"), null, "id inconnu → null");

// --- meta ---
const meta = getMeta(db);
assert.deepStrictEqual(meta.categories, ["upper arms", "waist"], "catégories triées distinctes");
assert.deepStrictEqual(meta.equipment, ["barbell", "body weight", "cable", "dumbbell"]);

console.log("exercises.test.js : OK");
