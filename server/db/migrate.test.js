// Self-check du runner de migrations : `node server/db/migrate.test.js`.
// Couvre les deux scénarios de désynchronisation entre schema_migrations et l'état réel des
// tables, plus le cas nominal. Bases :memory:, aucune migration n'est écrite sur disque.

const assert = require("assert");
const Database = require("better-sqlite3");

const { runMigrations, MIGRATION_TABLES } = require("./migrate");

// Sortie silencieuse : runMigrations journalise chaque migration appliquée, inutile ici.
const log = console.log;
console.log = () => {};
process.on("exit", () => {
  console.log = log;
});

// --- table de correspondance ------------------------------------------------
// Garde-fou : une migration ajoutée sans sa ligne dans MIGRATION_TABLES ne serait plus vérifiée.
const fs = require("fs");
const path = require("path");
const versions = fs
  .readdirSync(path.join(__dirname, "migrations"))
  .map((f) => /^(\d+)_.*\.sql$/.exec(f))
  .filter(Boolean)
  .map((m) => parseInt(m[1], 10));
assert.deepStrictEqual(
  versions.sort((a, b) => a - b),
  Object.keys(MIGRATION_TABLES).map(Number).sort((a, b) => a - b),
  "chaque migration doit avoir sa table représentative dans MIGRATION_TABLES"
);

// --- cas nominal : base vide puis relance ------------------------------------
const fresh = new Database(":memory:");
assert.strictEqual(runMigrations(fresh), versions.length, "toutes les migrations appliquées");
assert.strictEqual(runMigrations(fresh), 0, "relance : aucune migration en attente");
for (const table of Object.values(MIGRATION_TABLES)) {
  assert.ok(
    fresh.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
    `${table} créée`
  );
}
fresh.close();

// --- tracking menteur : version 1 marquée appliquée, table users absente -----
// Restauration d'un .db sans ses fichiers -wal/-shm : le tracking survit, pas les tables.
const lying = new Database(":memory:");
lying.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
lying.prepare("INSERT INTO schema_migrations VALUES (1, '2026-01-01')").run();

assert.throws(
  () => runMigrations(lying),
  (err) => {
    assert.ok(/migration 1 est marquée appliquée/.test(err.message), "identifie la version");
    assert.ok(/users/.test(err.message), "nomme la table manquante");
    return true;
  },
  "démarrage refusé sur un tracking désynchronisé"
);
lying.close();

// --- corruption partielle : 001 intacte, seule la table de 002 a disparu -----
// Le contrôle « au moins une table métier existe » laisserait passer ce cas.
const partial = new Database(":memory:");
runMigrations(partial);
partial.exec("DROP TABLE session_store");
assert.throws(
  () => runMigrations(partial),
  /migration 2 est marquée appliquée.*session_store/s,
  "une seule table manquante suffit à bloquer"
);
partial.close();

// --- version inconnue de MIGRATION_TABLES : ne bloque pas --------------------
// Retour arrière sur une base migrée par une version plus récente du code.
const ahead = new Database(":memory:");
runMigrations(ahead);
ahead.prepare("INSERT INTO schema_migrations VALUES (99, '2026-01-01')").run();
assert.strictEqual(runMigrations(ahead), 0, "version future ignorée, pas d'erreur");
ahead.close();

// --- sens inverse (déjà couvert par l'absence d'IF NOT EXISTS) ---------------
// Tracking perdu, tables présentes : la réapplication doit échouer, jamais passer en silence.
const untracked = new Database(":memory:");
runMigrations(untracked);
untracked.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)")
  .run("alice", "hash", "2026-01-01T00:00:00.000Z");
untracked.exec("DROP TABLE schema_migrations");
assert.throws(() => runMigrations(untracked), /already exists/, "réapplication refusée");
assert.strictEqual(
  untracked.prepare("SELECT COUNT(*) c FROM users").get().c,
  1,
  "transaction annulée : aucune donnée perdue"
);
// Procédure de récupération documentée dans migrate.js : réinsérer les versions à la main.
untracked
  .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?), (2, ?)")
  .run("1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.000Z");
assert.strictEqual(runMigrations(untracked), 0, "base réparée : démarrage nominal");
untracked.close();

console.log = log;
console.log("migrate.test.js OK");
