// Routes de l'analyse quotidienne (onglet Santé, docs/frontend.md §3.3). Protégées par requireAuth
// (voir index.js) : le propriétaire vient de req.user.id, jamais d'un paramètre client. Distinctes
// de /api/health/ingest, qui utilise l'AUTRE mécanisme d'auth (jeton Bearer) — deux auth non mêlées.
// Toute la logique vit dans server/services/daily-summary.js.

const express = require("express");

const { toCalendarDay } = require("../services/body-metrics");
const { runDailySummary, getDailySummary, localDay } = require("../services/daily-summary");

// `healthCfg` = section health de config (baseline_days, hrv_trend_window, timezone), injectée au
// montage : rien en dur ici.
function healthSummaryRouter(db, healthCfg) {
  const router = express.Router();

  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`health/summary : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // POST /api/health/summary/run — bouton « Lancer l'analyse maintenant ». Recalcule le résumé du
  // jour courant (fuseau config) pour l'utilisateur connecté et le renvoie.
  router.post(
    "/run",
    wrap("recalcul", (req, res) => {
      const day = localDay(healthCfg.timezone);
      res.json(runDailySummary(db, req.user.id, day, healthCfg));
    })
  );

  // GET /api/health/summary?date=YYYY-MM-DD — résumé d'un jour (défaut aujourd'hui). Permet au front
  // d'afficher « hier » si le cron n'a pas encore tourné. Jour absent = 200 avec payload:null.
  router.get(
    "/",
    wrap("lecture", (req, res) => {
      let day;
      if (req.query.date !== undefined) {
        day = toCalendarDay(req.query.date);
        if (!day) return res.status(400).json({ error: "date doit être une date AAAA-MM-JJ" });
      } else {
        day = localDay(healthCfg.timezone);
      }
      res.json(getDailySummary(db, req.user.id, day));
    })
  );

  return router;
}

module.exports = { healthSummaryRouter };
