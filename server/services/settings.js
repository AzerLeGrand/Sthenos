// Service des réglages par utilisateur. Pour l'instant : le jeton d'ingestion Apple Santé
// (docs/health-integration.md §3 et §8, docs/architecture.md §4).
//
// Rappel d'architecture : ce jeton est le SECOND mécanisme d'authentification, totalement distinct
// de la session par cookie. Il n'ouvre que la route d'ingestion santé, rien d'autre. Il est généré
// à la demande depuis l'écran Réglages, pas à la création du compte : un compte qui n'utilise pas
// Apple Santé n'a aucun secret à protéger.

const crypto = require("crypto");

// 32 octets d'aléa cryptographique, rendus en hexadécimal (64 caractères). Transmis en clair dans
// l'en-tête Authorization d'une requête HTTPS, jamais dans une URL (les query strings fuient dans
// les journaux d'accès de nginx).
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Jeton courant de l'utilisateur, ou null s'il n'en a jamais généré.
function getHealthToken(db, userId) {
  const row = db.prepare("SELECT health_ingest_token FROM users WHERE id = ?").get(userId);
  return row ? (row.health_ingest_token ?? null) : null;
}

// Génère un nouveau jeton et ÉCRASE l'ancien : la régénération invalide immédiatement le précédent,
// donc casse l'automatisation Health Auto Export déjà configurée tant qu'elle n'est pas mise à jour.
// L'avertissement correspondant est affiché côté Réglages.
function regenerateHealthToken(db, userId) {
  const token = generateToken();
  const res = db
    .prepare("UPDATE users SET health_ingest_token = ? WHERE id = ?")
    .run(token, userId);
  if (res.changes === 0) {
    // Session valide pointant sur un compte disparu : cas anormal, on échoue explicitement.
    throw new Error(`utilisateur introuvable (id ${userId})`);
  }
  return token;
}

module.exports = { generateToken, getHealthToken, regenerateHealthToken };
