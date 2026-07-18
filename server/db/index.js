// Couche d'accès données : ouverture de la base SQLite (better-sqlite3, accès synchrone).
// Le chemin du fichier vient de la config (paths.db_file), jamais codé en dur.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Ouvre la base au chemin donné, crée le dossier parent si besoin, active les clés étrangères
// (désactivées par défaut dans SQLite, doivent l'être par connexion). Retourne l'instance.
function openDatabase(dbFile) {
  const resolved = path.resolve(dbFile);

  const dir = path.dirname(resolved);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    throw new Error(`Impossible de créer le dossier de la base (${dir}) : ${err.message}`);
  }

  let db;
  try {
    db = new Database(resolved);
  } catch (err) {
    throw new Error(`Impossible d'ouvrir la base SQLite (${resolved}) : ${err.message}`);
  }

  db.pragma("foreign_keys = ON"); // intégrité référentielle appliquée par SQLite
  db.pragma("journal_mode = WAL"); // meilleure concurrence lecture/écriture, adapté à l'usage

  return db;
}

module.exports = { openDatabase };
