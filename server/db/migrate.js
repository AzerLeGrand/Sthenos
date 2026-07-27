// Runner de migrations SQL numérotées. Applique dans l'ordre les fichiers
// migrations/NNN_*.sql non encore passés, en enregistrant chacun dans schema_migrations.
// Approche minimale volontaire, sans ORM (cf docs/architecture.md §6).

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Table représentative de chaque migration : celle dont l'existence prouve que la migration
// a réellement été appliquée. Une seule suffit par migration, inutile de toutes les lister.
// À ÉTENDRE À CHAQUE NOUVELLE MIGRATION NUMÉROTÉE (sinon sa version n'est plus vérifiée).
const MIGRATION_TABLES = {
  1: "users",
  2: "session_store",
};

// Extrait le numéro de version en tête de nom de fichier (ex. "001_initial_schema.sql" -> 1).
// Retourne null si le nom ne suit pas la convention (le fichier est alors ignoré avec avertissement).
function parseVersion(filename) {
  const match = /^(\d+)_.*\.sql$/.exec(filename);
  return match ? parseInt(match[1], 10) : null;
}

// Vérifie que le tracking correspond à l'état réel de la base : chaque version marquée appliquée
// doit avoir sa table en place. Une base restaurée sans ses fichiers -wal/-shm peut porter un
// schema_migrations complet et des tables absentes ; sans ce contrôle, le serveur démarrerait en
// silence et chaque requête échouerait en 500, loin de la cause. On échoue au démarrage à la
// place, comme loadConfig sur une clé manquante.
// Le sens inverse (tracking perdu, tables présentes) est déjà couvert : les CREATE TABLE des
// migrations n'ont pas d'IF NOT EXISTS, la réapplication lève « table ... already exists ».
function assertTrackingMatchesSchema(db, applied) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");

  for (const version of applied) {
    const table = MIGRATION_TABLES[version];
    // Version inconnue de la table de correspondance : rien à vérifier. Cas d'un retour arrière
    // sur une base déjà migrée par une version plus récente du code — on ne bloque pas dessus.
    if (!table) continue;

    if (!exists.get(table)) {
      throw new Error(
        `Base incohérente : la migration ${version} est marquée appliquée dans schema_migrations ` +
          `mais sa table « ${table} » n'existe pas. Restauration partielle probable ; ` +
          `restaurer une sauvegarde complète plutôt que de démarrer sur cet état.`
      );
    }
  }
}

// Applique toutes les migrations en attente. Idempotent : relancer n'applique que les nouvelles.
// Chaque migration tourne dans une transaction (tout ou rien). `throw` si une migration échoue.
//
// ponytail: récupération après un échec de migration. Le CREATE TABLE IF NOT EXISTS ci-dessous
// s'exécute avant l'échec, donc si schema_migrations avait disparu elle est recréée VIDE : les
// migrations déjà passées ne sont plus tracées et la relance échoue sur « table users already
// exists ». Réparer = réinsérer les versions à la main, sur une base dont on a vérifié le schéma :
//   INSERT INTO schema_migrations (version, applied_at)
//   VALUES (1, '1970-01-01T00:00:00.000Z'), (2, '1970-01-01T00:00:00.000Z');
// (la date n'est qu'indicative, seul `version` est lu). Automatiser cette réparation serait pire
// que le mal : deviner qu'un schéma partiel est « en fait bon » est exactement ce qu'on refuse.
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

  // Avant d'appliquer quoi que ce soit : le tracking dit-il vrai ?
  assertTrackingMatchesSchema(db, applied);

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

module.exports = { runMigrations, MIGRATION_TABLES };
