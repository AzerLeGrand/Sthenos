// Script CLI de création d'un compte utilisateur.
// Pas d'inscription publique : les deux comptes fixes sont créés à la main via ce script.
// Il hache le mot de passe (bcrypt) et insère la ligne `users` PLUS la ligne `user_settings`
// correspondante, amorcée depuis config.yml (user_defaults) — c'est le moment décrit dans
// docs/data-model.md §2.2.
//
// Usage : npm run create-user -- <username> <mot_de_passe>

const bcrypt = require("bcryptjs");

const { loadConfig } = require("../config");
const { openDatabase } = require("../db");

const SALT_ROUNDS = 12; // ponytail: coût bcrypt standard ; monter si le matériel le permet
const MIN_PASSWORD_LENGTH = 8; // garde-fou minimal (validation au point d'entrée)

// Crée l'utilisateur et ses réglages en une transaction. Lève une erreur explicite en cas de
// problème (username déjà pris, config invalide...). Retourne l'id du nouvel utilisateur.
function createUser(username, password) {
  const config = loadConfig();
  const db = openDatabase(config.paths.db_file);

  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const d = config.user_defaults;

  // user + user_settings vont ensemble : soit les deux, soit aucun.
  const tx = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
      .run(username, passwordHash, now);
    const userId = info.lastInsertRowid;

    db.prepare(
      `INSERT INTO user_settings
         (user_id, theme, weight_unit, default_rir, default_rep_min, default_rep_max, default_increment)
       VALUES (@user_id, @theme, @weight_unit, @default_rir, @default_rep_min, @default_rep_max, @default_increment)`
    ).run({
      user_id: userId,
      theme: d.theme,
      weight_unit: d.weight_unit,
      default_rir: d.default_rir,
      default_rep_min: d.default_rep_min,
      default_rep_max: d.default_rep_max,
      default_increment: d.default_increment,
    });

    return userId;
  });

  try {
    return tx();
  } catch (err) {
    // Username déjà pris : contrainte UNIQUE sur users.username.
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error(`L'utilisateur « ${username} » existe déjà.`);
    }
    throw err;
  } finally {
    db.close();
  }
}

// Point d'entrée CLI. Valide les arguments avant d'appeler createUser.
function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error("Usage : npm run create-user -- <username> <mot_de_passe>");
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Mot de passe trop court (minimum ${MIN_PASSWORD_LENGTH} caractères).`);
    process.exit(1);
  }

  try {
    const id = createUser(username, password);
    console.log(`Utilisateur « ${username} » créé (id ${id}), réglages amorcés depuis config.yml.`);
  } catch (err) {
    console.error("Échec de la création :", err.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { createUser };
