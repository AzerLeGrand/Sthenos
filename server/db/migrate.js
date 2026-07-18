// Runner de migrations SQL numérotées. Applique dans l'ordre les fichiers
// migrations/NNN_*.sql non encore passés, en enregistrant chacun dans schema_migrations.
// Approche minimale volontaire, sans ORM (cf docs/architecture.md §6).

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Extrait le numéro de version en tête de nom de fichier (ex. "001_initial_schema.sql" -> 1).
// Retourne null si le nom ne suit pas la convention (le fichier est alors ignoré avec avertissement).
function parseVersion(filename) {
  const match = /^(\d+)_.*\.sql$/.exec(filename);
  return match ? parseInt(match[1], 10) : null;
}

// Applique toutes les migrations en attente. Idempotent : relancer n'applique que les nouvelles.
// Chaque migration tourne dans une transaction (tout ou rien). `throw` si une migration échoue.
function runMigrations(db) {
  // Table de suivi des migrations déjà appliquées.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  let files;
  try {
    files = fs.readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    throw new Error(`Impossible de lire le dossier des migrations (${MIGRATIONS_DIR}) : ${err.message}`);
  }

  // Fichiers de migration valides, triés par numéro de version croissant.
  const migrations = files
    .map((f) => ({ file: f, version: parseVersion(f) }))
    .filter((m) => {
      if (m.version === null) {
        console.warn(`Migration ignorée (nom non conforme) : ${m.file}`);
        return false;
      }
      return true;
    })
    .sort((a, b) => a.version - b.version);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version)
  );

  const record = db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  let count = 0;

  for (const { file, version } of migrations) {
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    // Transaction : soit toute la migration passe, soit rien (et on remonte l'erreur).
    const apply = db.transaction(() => {
      db.exec(sql);
      record.run(version, new Date().toISOString());
    });

    try {
      apply();
    } catch (err) {
      throw new Error(`Échec de la migration ${file} : ${err.message}`);
    }

    console.log(`Migration appliquée : ${file}`);
    count++;
  }

  if (count === 0) console.log("Aucune migration en attente.");
  return count;
}

module.exports = { runMigrations };
