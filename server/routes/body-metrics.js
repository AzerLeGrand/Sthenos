// Routes des indicateurs corporels (onglet Santé, docs/frontend.md §3.3). Couche routes :
// validation des entrées, propriété (user_id de session), codes de réponse. Toute la logique vit
// dans server/services/body-metrics.js. Protégées par requireAuth (voir index.js) : le propriétaire
// vient toujours de req.user.id, jamais d'un paramètre client.

const express = require("express");

const { periodToDays } = require("../services/progression-analytics");
const {
  isKnownMetric,
  toCalendarDay,
  upsertManual,
  listAvailableMetrics,
  getMetricSeries,
} = require("../services/body-metrics");

// `defaultPeriod` injecté au montage (aucune valeur en dur ici).
function bodyMetricsRouter(db, defaultPeriod) {
  const router = express.Router();

  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`body-metrics : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // GET /api/body-metrics — métriques ayant au moins une donnée (peuple le sélecteur).
  router.get(
    "/",
    wrap("liste des métriques", (req, res) => {
      res.json(listAvailableMetrics(db, req.user.id));
    })
  );

  // POST /api/body-metrics — saisie manuelle (poids aujourd'hui, autres métriques possibles).
  // `source` est forcé à 'manual' par le service : le client ne le fournit jamais, sinon il
  // pourrait se faire passer pour Apple Santé et contourner la séparation des sources.
  router.post(
    "/",
    wrap("saisie manuelle", (req, res) => {
      const body = req.body || {};

      if (!isKnownMetric(body.metric_type)) {
        return res.status(400).json({ error: "metric_type inconnu" });
      }
      // Valeur : nombre fini et strictement positif (aucune des huit métriques n'est nulle ou
      // négative — un poids, des pas ou des heures de sommeil à 0 sont une erreur de saisie).
      if (typeof body.value !== "number" || !Number.isFinite(body.value) || body.value <= 0) {
        return res.status(400).json({ error: "value doit être un nombre strictement positif" });
      }
      const recorded_at = toCalendarDay(body.recorded_at);
      if (!recorded_at) {
        return res.status(400).json({ error: "recorded_at doit être une date AAAA-MM-JJ" });
      }

      res.json(upsertManual(db, req.user.id, { metric_type: body.metric_type, value: body.value, recorded_at }));
    })
  );

  // GET /api/body-metrics/:metricType?period=30|90|all — série d'une métrique.
  // metric_type hors liste → 400 (entrée invalide), pas 404 : la ressource n'existe pas plus qu'un
  // exercice inventé, mais c'est bien la requête qui est mal formée. Une métrique valide sans
  // donnée renvoie 200 avec series: [] (état vide légitime, pas une erreur).
  router.get(
    "/:metricType",
    wrap("série d'une métrique", (req, res) => {
      const { metricType } = req.params;
      if (!isKnownMetric(metricType)) {
        return res.status(400).json({ error: "metric_type inconnu" });
      }
      const period = req.query.period ?? defaultPeriod;
      if (periodToDays(period) === undefined) {
        return res.status(400).json({ error: "period doit être 30, 90 ou all" });
      }

      res.json(getMetricSeries(db, req.user.id, metricType, period));
    })
  );

  return router;
}

module.exports = { bodyMetricsRouter };
