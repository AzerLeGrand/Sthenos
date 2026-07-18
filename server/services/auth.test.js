// Self-check minimal (sans framework) : lance avec `node server/services/auth.test.js`.
// Couvre authenticate (bon/mauvais mot de passe, username inconnu) et le store de session
// (set/get/destroy + expiration) sur une base SQLite en mémoire.

const assert = require("assert");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const { authenticate, getUserById } = require("./auth");
const { createSessionStore } = require("../db/session-store");

// Base jetable en mémoire, avec juste ce qu'il faut.
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT);
  CREATE TABLE session_store (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expire INTEGER NOT NULL);
`);
db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(
  "alice",
  bcrypt.hashSync("motdepasse", 12)
);

// --- authenticate ---
assert.strictEqual(authenticate(db, "alice", "mauvais"), null, "mauvais mot de passe → null");
assert.strictEqual(authenticate(db, "inconnu", "motdepasse"), null, "username inconnu → null");
const ok = authenticate(db, "alice", "motdepasse");
assert.deepStrictEqual(ok, { id: 1, username: "alice" }, "bon couple → user sans hash");
assert.strictEqual(ok.password_hash, undefined, "authenticate ne renvoie jamais le hash");

// --- getUserById ---
assert.deepStrictEqual(getUserById(db, 1), { id: 1, username: "alice" });
assert.strictEqual(getUserById(db, 999), null, "id inconnu → null");

// --- session store ---
const store = createSessionStore(db);
const sess = { cookie: { maxAge: 60000 }, userId: 1 };

store.set("sid1", sess, (err) => assert.ifError(err));
store.get("sid1", (err, got) => {
  assert.ifError(err);
  assert.strictEqual(got.userId, 1, "session relue avec le bon userId");
});

// Expiration : une session déjà expirée n'est pas renvoyée.
store.set("sid2", { cookie: { maxAge: -1000 }, userId: 2 }, (err) => assert.ifError(err));
store.get("sid2", (err, got) => {
  assert.ifError(err);
  assert.strictEqual(got, null, "session expirée → null");
});

// Destroy.
store.destroy("sid1", (err) => assert.ifError(err));
store.get("sid1", (err, got) => {
  assert.ifError(err);
  assert.strictEqual(got, null, "session détruite → null");
});

console.log("auth.test.js : OK");
