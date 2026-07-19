// Routes des routines. Couche routes : validation des entrées, propriété (user_id de session),
// codes de réponse. La logique SQL vit dans server/services/routines.js.
// Toutes ces routes sont protégées par requireAuth, appliqué au montage (voir index.js) :
// req.user.id est la seule source du propriétaire ; le client ne transmet jamais de user_id.

const express = require("express");

const {
  DEFAULT_GOAL,
  getOwnedRoutine,
  listRoutines,
  createRoutine,
  renameRoutine,
  countExercises,
  deleteRoutine,
  getRoutineDetail,
  getRoutineExerciseById,
  getRoutineExerciseIds,
  exerciseExists,
  getUserDefaults,
  addRoutineExercise,
  getRoutineExerciseInRoutine,
  updateRoutineExercise,
  deleteRoutineExercise,
  reorderRoutineExercises,
  validateParams,
} = require("../services/routines");
const { getExerciseHistory, suggestExercise } = require("../services/progression");

// Parse un id entier de path param. Retourne le nombre, ou null si absent/non entier
// (l'appelant répond alors 404 : un id malformé désigne une ressource qui n'existe pas).
function parseId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

// Nom de routine : chaîne non vide après trim. Retourne le nom nettoyé ou null si invalide.
function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length ? name : null;
}

// `thresholds` = config.progression (seuils globaux de l'algorithme), injecté pour la route suggestion.
function routinesRouter(db, thresholds) {
  const router = express.Router();

  // Enveloppe try/catch uniforme (mêmes messages/codes que routes/exercises.js) : évite de répéter
  // le bloc dans chaque handler. Toute erreur d'accès base → 500 journalisé.
  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`routines : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // Charge la routine possédée par l'utilisateur courant, ou répond 404 et retourne null.
  // 404 indistinct (inexistante vs à autrui) : ne révèle pas l'existence d'une routine d'un tiers.
  function requireOwned(req, res) {
    const id = parseId(req.params.id);
    if (id === null) {
      res.status(404).json({ error: "routine introuvable" });
      return null;
    }
    const routine = getOwnedRoutine(db, id, req.user.id);
    if (!routine) {
      res.status(404).json({ error: "routine introuvable" });
      return null;
    }
    return routine;
  }

  // GET /api/routines — liste des routines de l'utilisateur, avec le nombre d'exercices.
  router.get(
    "/",
    wrap("liste", (req, res) => {
      res.json(listRoutines(db, req.user.id));
    })
  );

  // POST /api/routines — création (name requis). Retourne la routine créée (forme résumé).
  router.post(
    "/",
    wrap("création", (req, res) => {
      const name = cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: "name requis" });
      res.status(201).json(createRoutine(db, req.user.id, name));
    })
  );

  // GET /api/routines/:id — détail complet : routine + exercices enrichis, dans l'ordre.
  router.get(
    "/:id",
    wrap("détail", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      res.json(getRoutineDetail(db, routine));
    })
  );

  // PATCH /api/routines/:id — renommage. Retourne la forme résumé (avec exercise_count).
  router.patch(
    "/:id",
    wrap("renommage", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      const name = cleanName(req.body.name);
      if (!name) return res.status(400).json({ error: "name requis" });
      renameRoutine(db, routine.id, name);
      res.json({ ...routine, name, exercise_count: countExercises(db, routine.id) });
    })
  );

  // DELETE /api/routines/:id — suppression (cascade applicative en transaction, voir service).
  router.delete(
    "/:id",
    wrap("suppression", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      deleteRoutine(db, routine.id);
      res.status(204).end();
    })
  );

  // POST /api/routines/:id/exercises — ajoute un exercice. exercise_id + paramètres ; les champs
  // rir_cible/rep_min/rep_max/increment/goal omis prennent les défauts de l'utilisateur (user_settings),
  // goal omis prend DEFAULT_GOAL. n_series est requis. position calculée côté serveur (dernier + 1).
  router.post(
    "/:id/exercises",
    wrap("ajout exercice", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;

      const b = req.body || {};
      if (typeof b.exercise_id !== "string" || !b.exercise_id.trim())
        return res.status(400).json({ error: "exercise_id requis" });
      if (!exerciseExists(db, b.exercise_id))
        return res.status(404).json({ error: "exercice introuvable" });

      const defaults = getUserDefaults(db, req.user.id);
      if (!defaults) {
        // Un compte doit toujours avoir sa ligne user_settings (amorcée à la création). Absence =
        // incohérence de données, pas une erreur client : on journalise et on renvoie 500.
        console.error("routines : user_settings absent pour l'utilisateur", req.user.id);
        return res.status(500).json({ error: "erreur interne" });
      }

      // Fusion : ?? (et non ||) pour conserver une valeur 0 explicitement fournie par le client.
      const params = {
        exercise_id: b.exercise_id,
        n_series: b.n_series,
        rep_min: b.rep_min ?? defaults.default_rep_min,
        rep_max: b.rep_max ?? defaults.default_rep_max,
        rir_cible: b.rir_cible ?? defaults.default_rir,
        increment: b.increment ?? defaults.default_increment,
        goal: b.goal ?? DEFAULT_GOAL,
        rest_seconds: b.rest_seconds ?? null,
      };
      const err = validateParams(params);
      if (err) return res.status(400).json({ error: err });

      const reId = addRoutineExercise(db, routine.id, params);
      res.status(201).json(getRoutineExerciseById(db, reId));
    })
  );

  // PATCH /api/routines/:id/exercises/:reId — modifie les paramètres (pas la position).
  // Fusion sur l'existant : un champ omis garde sa valeur actuelle. Validation sur le résultat fusionné
  // (ex. modifier seulement rep_min doit rester ≤ rep_max courant).
  router.patch(
    "/:id/exercises/:reId",
    wrap("modif exercice", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      const reId = parseId(req.params.reId);
      const current = reId === null ? null : getRoutineExerciseInRoutine(db, reId, routine.id);
      if (!current) return res.status(404).json({ error: "exercice de routine introuvable" });

      const b = req.body || {};
      const params = {
        n_series: b.n_series ?? current.n_series,
        rep_min: b.rep_min ?? current.rep_min,
        rep_max: b.rep_max ?? current.rep_max,
        rir_cible: b.rir_cible ?? current.rir_cible,
        increment: b.increment ?? current.increment,
        goal: b.goal ?? current.goal,
        // rest_seconds : ?? garde l'existant si omis ; passer null explicitement l'efface.
        rest_seconds: b.rest_seconds === undefined ? current.rest_seconds : b.rest_seconds,
      };
      const err = validateParams(params);
      if (err) return res.status(400).json({ error: err });

      updateRoutineExercise(db, reId, params);
      res.json(getRoutineExerciseById(db, reId));
    })
  );

  // DELETE /api/routines/:id/exercises/:reId — retire un exercice. Retourne le détail complet
  // (état confirmé par le serveur, évite toute désynchro côté front).
  router.delete(
    "/:id/exercises/:reId",
    wrap("retrait exercice", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      const reId = parseId(req.params.reId);
      const current = reId === null ? null : getRoutineExerciseInRoutine(db, reId, routine.id);
      if (!current) return res.status(404).json({ error: "exercice de routine introuvable" });

      deleteRoutineExercise(db, reId);
      res.json(getRoutineDetail(db, routine));
    })
  );

  // POST /api/routines/:id/exercises/reorder — réordonne. Corps : { order: [reId, ...] } dans le
  // nouvel ordre. `order` doit être exactement l'ensemble des exercices de la routine (mêmes ids,
  // même cardinalité) : sinon 400, pour ne pas laisser des positions incohérentes. Retourne le détail.
  router.post(
    "/:id/exercises/reorder",
    wrap("réordonnancement", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;

      const order = (req.body || {}).order;
      if (!Array.isArray(order) || order.some((x) => !Number.isInteger(x)))
        return res.status(400).json({ error: "order doit être un tableau d'identifiants entiers" });

      const current = getRoutineExerciseIds(db, routine.id);
      const same =
        order.length === current.length &&
        new Set(order).size === order.length && // pas de doublon dans order
        current.every((id) => order.includes(id));
      if (!same)
        return res
          .status(400)
          .json({ error: "order doit contenir exactement les exercices de la routine" });

      reorderRoutineExercises(db, routine.id, order);
      res.json(getRoutineDetail(db, routine));
    })
  );

  // GET /api/routines/:id/exercises/:reId/suggestion — suggestions DDP, une par set_number.
  // Calcul délégué au service progression (pur), historique restreint aux séances clôturées de
  // l'utilisateur courant. reason parmi baseline/deload/increase_load_easy/increase_load/hold/increase_reps.
  router.get(
    "/:id/exercises/:reId/suggestion",
    wrap("suggestion", (req, res) => {
      const routine = requireOwned(req, res);
      if (!routine) return;
      const reId = parseId(req.params.reId);
      const re = reId === null ? null : getRoutineExerciseInRoutine(db, reId, routine.id);
      if (!re) return res.status(404).json({ error: "exercice de routine introuvable" });

      const sessions = getExerciseHistory(db, req.user.id, re.exercise_id);
      const suggestions = suggestExercise(re, sessions, thresholds);
      res.json({
        routine_exercise_id: re.id,
        exercise_id: re.exercise_id,
        goal: re.goal,
        suggestions,
      });
    })
  );

  return router;
}

module.exports = { routinesRouter };
