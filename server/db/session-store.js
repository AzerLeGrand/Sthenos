// Store express-session minimal, adossé à notre base SQLite existante (better-sqlite3).
// Persiste les sessions dans la table session_store (migration 002), donc elles survivent
// au redémarrage du serveur (cf docs/infra.md §9 : sessions longues sur PWA iOS).
//
// On implémente les méthodes attendues par express-session : get, set, destroy, touch.
// La table est créée par les migrations, pas ici : le store suppose qu'elle existe.

const { Store } = require("express-session");

// Fabrique une classe de store liée à l'instance de base fournie (injection, pas d'import global).
function createSessionStore(db) {
  // Requêtes préparées une fois (better-sqlite3 est synchrone).
  const stmtGet = db.prepare("SELECT data, expire FROM session_store WHERE sid = ?");
  const stmtUpsert = db.prepare(`
    INSERT INTO session_store (sid, data, expire) VALUES (?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expire = excluded.expire
  `);
  const stmtDelete = db.prepare("DELETE FROM session_store WHERE sid = ?");
  const stmtTouch = db.prepare("UPDATE session_store SET expire = ? WHERE sid = ?");
  const stmtPurge = db.prepare("DELETE FROM session_store WHERE expire <= ?");

  // Calcule l'instant d'expiration (epoch ms) d'une session. Se base sur cookie.expires si
  // présent, sinon sur maxAge, sinon repli à +1 jour pour ne jamais stocker sans borne.
  function expiryOf(sess) {
    if (sess.cookie && sess.cookie.expires) return new Date(sess.cookie.expires).getTime();
    if (sess.cookie && typeof sess.cookie.maxAge === "number") return Date.now() + sess.cookie.maxAge;
    return Date.now() + 24 * 60 * 60 * 1000; // ponytail: repli 1 j, jamais de session éternelle
  }

  class SqliteSessionStore extends Store {
    // Lecture d'une session. Renvoie null si absente ou expirée (et purge la ligne expirée).
    get(sid, callback) {
      try {
        const row = stmtGet.get(sid);
        if (!row) return callback(null, null);
        if (row.expire <= Date.now()) {
          stmtDelete.run(sid); // expirée : on nettoie et on considère la session absente
          return callback(null, null);
        }
        return callback(null, JSON.parse(row.data));
      } catch (err) {
        return callback(err);
      }
    }

    // Écriture / mise à jour d'une session.
    set(sid, sess, callback) {
      try {
        stmtUpsert.run(sid, JSON.stringify(sess), expiryOf(sess));
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    // Suppression explicite (logout).
    destroy(sid, callback) {
      try {
        stmtDelete.run(sid);
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }

    // Prolongation de la fenêtre d'expiration sans réécrire toute la session (rolling sessions).
    touch(sid, sess, callback) {
      try {
        stmtTouch.run(expiryOf(sess), sid);
        return callback(null);
      } catch (err) {
        return callback(err);
      }
    }
  }

  const store = new SqliteSessionStore();

  // Purge des sessions expirées : une fois au démarrage puis périodiquement.
  // Évite l'accumulation de lignes mortes (les sessions expirées sont aussi purgées à la lecture).
  const purge = () => {
    try {
      stmtPurge.run(Date.now());
    } catch (err) {
      console.error("Purge des sessions expirées échouée :", err.message);
    }
  };
  purge();
  const timer = setInterval(purge, 60 * 60 * 1000); // toutes les heures
  timer.unref(); // ne pas empêcher l'arrêt du process

  return store;
}

module.exports = { createSessionStore };
