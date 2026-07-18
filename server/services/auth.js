// Service d'authentification (couche logique). Ne touche ni aux requêtes/réponses HTTP
// (couche routes) ni à la construction de SQL dispersée : il s'appuie sur des requêtes ciblées.

const bcrypt = require("bcryptjs");

// Hash bcrypt factice, calculé au chargement (donc valide et au même coût que les vrais hashes,
// 12 rounds). Utilisé quand l'utilisateur n'existe pas : on compare quand même contre lui pour
// que le temps de réponse d'un username inconnu soit comparable à celui d'un mauvais mot de
// passe. Cela évite de révéler l'existence d'un compte par une différence de timing.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);

// Vérifie un couple (username, mot de passe). Retourne l'utilisateur (sans le hash) si valide,
// sinon null. Ne distingue jamais « username inconnu » de « mauvais mot de passe » côté appelant.
function authenticate(db, username, password) {
  const user = db
    .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
    .get(username);

  // Utilisateur absent : on compare contre le hash factice (temps constant) puis on échoue.
  if (!user) {
    bcrypt.compareSync(password, DUMMY_HASH);
    return null;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) return null;

  // Ne jamais renvoyer le hash au reste de l'application.
  return { id: user.id, username: user.username };
}

// Relit un utilisateur par son id (source de vérité pour les routes protégées : une session
// peut référencer un utilisateur supprimé). Retourne { id, username } ou null.
function getUserById(db, id) {
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);
  return user || null;
}

module.exports = { authenticate, getUserById };
