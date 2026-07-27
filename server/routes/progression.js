// Routes de l'onglet Progression (docs/frontend.md §3.2). Couche routes : validation des entrées,
// propriété (user_id de session), codes de réponse. Toute l'agrégation vit dans
// server/services/progression-analytics.js. Protégées par requireAuth (voir index.js) :
// le propriétaire vient toujours de req.user.id, jamais d'un paramètre client.

const express = require("express");

const {
  periodToDays,
  getProgression,
  getExercisesWithHistory,
} = require("../services/progression-analytics");

// `cfg` = config.progression_analytics (seuils + période par défaut), injecté au montage.
function progressionRouter(db, cfg) {
  const router = express.Router();

  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`progression : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // GET /api/progression/exercises — exercices déjà loggés (peuple le sélecteur).
  // Route LITTÉRALE enregistrée AVANT /:exerciseId, sinon "exercises" serait capturé comme un id.
  router.get(
    "/exercises",
    wrap("liste exercices loggés", (req, res) => {
      res.json(getExercisesWithHistory(db, req.user.id));
    })
  );

  // GET /api/progression/:exerciseId?period=30|90|all — courbes charge/volume + tendance.
  router.get(
    "/:exerciseId",
    wrap("progression exercice", (req, res) => {
      // Période : défaut config si absente, sinon 30 / 90 / all uniquement (400 hors liste).
      const period = req.query.period ?? cfg.default_period;
      if (periodToDays(period) === undefined) {
        return res.status(400).json({ error: "period doit être 30, 90 ou all" });
      }

      const data = getProgression(db, req.user.id, req.params.exerciseId, period, cfg);
      if (!data) return res.status(404).json({ error: "exercice introuvable" });
      res.json(data);
    })
  );

  return router;
}

module.exports = { progressionRouter };
