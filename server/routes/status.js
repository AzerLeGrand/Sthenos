// Route de health check basique. GET /api/status.
// N.B. : /api/health/* est réservé à l'ingestion santé ; le health check vit donc sous /api/status.
// Aucune logique métier ici (couche routes) — on vérifie juste que le process répond et que la base pond.

const express = require("express");

// Fabrique le routeur en recevant la base par injection (pas d'import global de la connexion).
function statusRouter(db) {
  const router = express.Router();

  router.get("/status", (req, res) => {
    try {
      // Ping SQLite : confirme que la connexion répond.
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", time: new Date().toISOString() });
    } catch (err) {
      // Base injoignable : on le signale explicitement (503), sans faire tomber le process.
      console.error("Health check : base injoignable :", err.message);
      res.status(503).json({ status: "error", message: "base injoignable" });
    }
  });

  return router;
}

module.exports = { statusRouter };
