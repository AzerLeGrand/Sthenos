// Service sessions et logged_sets (couche logique + accès données). Les identifiants sont générés
// côté client (UUID) : les insertions sont idempotentes (INSERT ... ON CONFLICT(id) DO NOTHING),
// pour que le rejeu d'une synchro hors-ligne ne duplique rien ni n'échoue (data-model.md §1).
// La propriété (user_id de session) est vérifiée par les routes via getSessionById.

// Relit une séance par son id (source de vérité de propriété). Retourne la ligne ou null.
function getSessionById(db, id) {
  return db.prepare("SELECT id, user_id, routine_id, started_at, ended_at, status FROM sessions WHERE id = ?").get(id) || null;
}

// Crée une séance de façon idempotente. Statut initial 'in_progress'. Le contrôle cross-user
// (id déjà pris par un autre compte) est fait par la route AVANT d'appeler ceci. Retourne la ligne
// (nouvelle ou déjà existante — le rejeu renvoie l'existant sans erreur).
function createSession(db, { id, user_id, routine_id, started_at }) {
  db.prepare(
    `INSERT INTO sessions (id, user_id, routine_id, started_at, status)
     VALUES (@id, @user_id, @routine_id, @started_at, 'in_progress')
     ON CONFLICT(id) DO NOTHING`
  ).run({ id, user_id, routine_id: routine_id ?? null, started_at });
  return getSessionById(db, id);
}

// Clôture une séance : ended_at + status 'completed'. Idempotent (re-clôturer ne casse rien).
// La propriété est déjà vérifiée par la route ; on borne quand même par user_id par sécurité.
function closeSession(db, id, userId, ended_at) {
  db.prepare(
    "UPDATE sessions SET ended_at = ?, status = 'completed' WHERE id = ? AND user_id = ?"
  ).run(ended_at, id, userId);
  return getSessionById(db, id);
}

// Séries loggées d'une séance, dans l'ordre chronologique de saisie.
function getSessionSets(db, sessionId) {
  return db
    .prepare(
      `SELECT id, exercise_id, set_number, reps, load, rir, created_at
       FROM logged_sets WHERE session_id = ? ORDER BY created_at ASC, set_number ASC`
    )
    .all(sessionId);
}

// Détail complet : la séance + ses séries.
function getSessionDetail(db, session) {
  return { ...session, sets: getSessionSets(db, session.id) };
}

// Relit une série loggée par son id (pour la détection de rejeu / conflit). Retourne la ligne ou null.
function getLoggedSetById(db, id) {
  return db.prepare("SELECT id, session_id, exercise_id, set_number, reps, load, rir, created_at FROM logged_sets WHERE id = ?").get(id) || null;
}

// Ajoute une série de façon idempotente. created_at posé côté serveur (le client ne l'envoie pas).
// L'existence de exercise_id et l'appartenance de la séance sont validées par la route. Retourne la
// ligne (nouvelle ou existante). On tolère l'ajout sur une séance 'completed' : en hors-ligne, une
// série et la clôture se synchronisent indépendamment et peuvent arriver dans le désordre ; refuser
// perdrait une série réellement saisie (frontend.md §4). Le statut de la séance n'est pas modifié.
function addLoggedSet(db, { id, session_id, exercise_id, set_number, reps, load, rir }) {
  db.prepare(
    `INSERT INTO logged_sets (id, session_id, exercise_id, set_number, reps, load, rir, created_at)
     VALUES (@id, @session_id, @exercise_id, @set_number, @reps, @load, @rir, @created_at)
     ON CONFLICT(id) DO NOTHING`
  ).run({
    id,
    session_id,
    exercise_id,
    set_number,
    reps,
    load,
    rir: rir ?? null,
    created_at: new Date().toISOString(),
  });
  return getLoggedSetById(db, id);
}

module.exports = {
  getSessionById,
  createSession,
  closeSession,
  getSessionSets,
  getSessionDetail,
  getLoggedSetById,
  addLoggedSet,
};
