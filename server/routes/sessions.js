// Routes des séances et des séries loggées. Couche routes : validation, propriété (user_id de
// session), codes de réponse. La logique d'accès/idempotence vit dans server/services/sessions.js.
// Protégées par requireAuth (voir index.js) : le propriétaire vient toujours de req.user.id.

const express = require("express");

const {
  getSessionById,
  createSession,
  closeSession,
  getSessionDetail,
  getLoggedSetById,
  addLoggedSet,
} = require("../services/sessions");
const { getOwnedRoutine, exerciseExists } = require("../services/routines");

// Chaîne non vide (identifiant client, date ISO...). Retourne la valeur trimée ou null.
function nonEmptyString(raw) {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

// Date ISO parseable. Retourne la chaîne (non vide) si Date.parse la reconnaît, sinon null.
function isoDate(raw) {
  const s = nonEmptyString(raw);
  if (!s || Number.isNaN(Date.parse(s))) return null;
  return s;
}

function sessionsRouter(db) {
  const router = express.Router();

  // Enveloppe try/catch uniforme (mêmes codes/messages que les autres routeurs).
  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`sessions : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // Charge une séance possédée par l'utilisateur courant, ou répond 404 (indistinct) et retourne null.
  function requireOwnedSession(req, res) {
    const id = nonEmptyString(req.params.id);
    const session = id ? getSessionById(db, id) : null;
    if (!session || session.user_id !== req.user.id) {
      res.status(404).json({ error: "séance introuvable" });
      return null;
    }
    return session;
  }

  // Projection publique d'une séance (on n'expose pas user_id, déduit de la session).
  const publicSession = (s) => ({
    id: s.id,
    routine_id: s.routine_id,
    started_at: s.started_at,
    ended_at: s.ended_at,
    status: s.status,
  });

  // POST /api/sessions — crée une séance (idempotent). { id (UUID client), routine_id?, started_at }.
  router.post(
    "/",
    wrap("création", (req, res) => {
      const b = req.body || {};
      const id = nonEmptyString(b.id);
      if (!id) return res.status(400).json({ error: "id requis" });
      const started_at = isoDate(b.started_at);
      if (!started_at) return res.status(400).json({ error: "started_at invalide" });

      // routine_id optionnel : si fourni, doit être une routine possédée (évite l'échec brut de FK).
      let routine_id = null;
      if (b.routine_id !== undefined && b.routine_id !== null) {
        if (!Number.isInteger(b.routine_id) || !getOwnedRoutine(db, b.routine_id, req.user.id))
          return res.status(400).json({ error: "routine inconnue" });
        routine_id = b.routine_id;
      }

      // Idempotence + anti-vol : si l'id existe déjà pour un autre compte, on refuse ; sinon on
      // renvoie l'existant (rejeu) ou on crée.
      const existing = getSessionById(db, id);
      if (existing) {
        if (existing.user_id !== req.user.id)
          return res.status(409).json({ error: "identifiant de séance déjà utilisé" });
        return res.json(publicSession(existing)); // rejeu idempotent
      }
      const created = createSession(db, { id, user_id: req.user.id, routine_id, started_at });
      res.status(201).json(publicSession(created));
    })
  );

  // GET /api/sessions/:id — détail de la séance + ses séries loggées.
  router.get(
    "/:id",
    wrap("détail", (req, res) => {
      const session = requireOwnedSession(req, res);
      if (!session) return;
      res.json(getSessionDetail(db, publicSession(session)));
    })
  );

  // PATCH /api/sessions/:id — clôture (ended_at + status 'completed').
  router.patch(
    "/:id",
    wrap("clôture", (req, res) => {
      const session = requireOwnedSession(req, res);
      if (!session) return;
      const ended_at = isoDate((req.body || {}).ended_at);
      if (!ended_at) return res.status(400).json({ error: "ended_at invalide" });
      const updated = closeSession(db, session.id, req.user.id, ended_at);
      res.json(publicSession(updated));
    })
  );

  // POST /api/sessions/:id/sets — ajoute une série loggée (idempotent).
  // { id (UUID client), exercise_id, set_number, reps, load, rir? }.
  router.post(
    "/:id/sets",
    wrap("ajout série", (req, res) => {
      const session = requireOwnedSession(req, res);
      if (!session) return;

      const b = req.body || {};
      const setId = nonEmptyString(b.id);
      if (!setId) return res.status(400).json({ error: "id requis" });

      // Rejeu / conflit : un id de série déjà connu doit renvoyer l'existant, sauf s'il appartient
      // à une AUTRE séance (collision d'identifiant → conflit).
      const existing = getLoggedSetById(db, setId);
      if (existing) {
        if (existing.session_id !== session.id)
          return res.status(409).json({ error: "identifiant de série déjà utilisé" });
        return res.json(existing); // rejeu idempotent
      }

      // Validation d'une nouvelle série.
      if (typeof b.exercise_id !== "string" || !b.exercise_id.trim())
        return res.status(400).json({ error: "exercise_id requis" });
      if (!exerciseExists(db, b.exercise_id))
        return res.status(404).json({ error: "exercice introuvable" });
      if (!Number.isInteger(b.set_number) || b.set_number < 1)
        return res.status(400).json({ error: "set_number doit être un entier ≥ 1" });
      // reps ≥ 0 : une série à 0 rep est un échec réel (cas B de l'algo), pas une donnée invalide.
      if (!Number.isInteger(b.reps) || b.reps < 0)
        return res.status(400).json({ error: "reps doit être un entier ≥ 0" });
      if (typeof b.load !== "number" || !Number.isFinite(b.load) || b.load < 0)
        return res.status(400).json({ error: "load doit être un nombre ≥ 0" });
      if (b.rir !== undefined && b.rir !== null && (!Number.isInteger(b.rir) || b.rir < 0))
        return res.status(400).json({ error: "rir doit être un entier ≥ 0 ou absent" });

      const created = addLoggedSet(db, {
        id: setId,
        session_id: session.id,
        exercise_id: b.exercise_id,
        set_number: b.set_number,
        reps: b.reps,
        load: b.load,
        rir: b.rir ?? null,
      });
      res.status(201).json(created);
    })
  );

  return router;
}

module.exports = { sessionsRouter };
