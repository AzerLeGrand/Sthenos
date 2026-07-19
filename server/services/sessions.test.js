// Self-check du service sessions : `node server/services/sessions.test.js`.
// Vérifie l'idempotence des insertions (rejeu ne duplique pas), la clôture, et que l'ajout d'une
// série sur une séance clôturée est toléré (choix hors-ligne). Base :memory:, foreign_keys ON.

const assert = require("assert");
const Database = require("better-sqlite3");

const {
  getSessionById,
  createSession,
  closeSession,
  getSessionDetail,
  getLoggedSetById,
  addLoggedSet,
} = require("./sessions");

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE users ( id INTEGER PRIMARY KEY );
  CREATE TABLE exercises ( id TEXT PRIMARY KEY );
  CREATE TABLE routines ( id INTEGER PRIMARY KEY, user_id INTEGER );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    routine_id INTEGER REFERENCES routines(id), started_at TEXT NOT NULL, ended_at TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed'))
  );
  CREATE TABLE logged_sets (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
    exercise_id TEXT NOT NULL REFERENCES exercises(id), set_number INTEGER NOT NULL,
    reps INTEGER NOT NULL, load REAL NOT NULL, rir INTEGER, created_at TEXT NOT NULL
  );
`);
db.prepare("INSERT INTO users VALUES (1)").run();
db.prepare("INSERT INTO exercises VALUES ('0001')").run();

// --- création idempotente ---
const s = createSession(db, { id: "sess-1", user_id: 1, routine_id: null, started_at: "2026-02-01T10:00Z" });
assert.strictEqual(s.status, "in_progress");
// rejeu du MÊME id : ne duplique pas, ne casse pas, renvoie l'existant.
createSession(db, { id: "sess-1", user_id: 1, routine_id: null, started_at: "2026-02-01T10:00Z" });
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1, "pas de doublon de séance");

// --- série idempotente ---
addLoggedSet(db, { id: "set-1", session_id: "sess-1", exercise_id: "0001", set_number: 1, reps: 10, load: 50, rir: 2 });
addLoggedSet(db, { id: "set-1", session_id: "sess-1", exercise_id: "0001", set_number: 1, reps: 10, load: 50, rir: 2 });
assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM logged_sets").get().n, 1, "pas de doublon de série");
const set = getLoggedSetById(db, "set-1");
assert.ok(set.created_at, "created_at posé côté serveur");
// reps 0 accepté (échec réel), rir null accepté.
const fail = addLoggedSet(db, { id: "set-fail", session_id: "sess-1", exercise_id: "0001", set_number: 2, reps: 0, load: 50, rir: null });
assert.strictEqual(fail.reps, 0);
assert.strictEqual(fail.rir, null);

// --- clôture idempotente ---
const closed = closeSession(db, "sess-1", 1, "2026-02-01T11:00Z");
assert.strictEqual(closed.status, "completed");
assert.strictEqual(closed.ended_at, "2026-02-01T11:00Z");

// --- tolérance : ajouter une série APRÈS clôture (synchro hors-ligne tardive) ---
const late = addLoggedSet(db, { id: "set-late", session_id: "sess-1", exercise_id: "0001", set_number: 3, reps: 8, load: 50, rir: 1 });
assert.ok(late, "série tardive acceptée sur séance clôturée");
assert.strictEqual(getSessionById(db, "sess-1").status, "completed", "statut inchangé (pas de réouverture)");

// --- détail : séance + séries ---
const detail = getSessionDetail(db, getSessionById(db, "sess-1"));
assert.strictEqual(detail.sets.length, 3, "3 séries au total");

console.log("sessions.test.js : OK");
