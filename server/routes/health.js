// Route d'ingestion Apple Santé (docs/health-integration.md §2). Montée sur le chemin lu dans
// config.yml (health.ingest_path), jamais en dur, et protégée par requireHealthToken — PAS par
// requireAuth : c'est l'app Health Auto Export d'un iPhone qui appelle, pas un navigateur connecté.
// L'utilisateur destinataire vient donc de req.healthUser (routé par le jeton).

const express = require("express");

const { IngestError, ingest } = require("../services/health-ingest");

function healthRouter(db) {
  const router = express.Router();

  router.post("/", (req, res) => {
    try {
      // Le service parse et valide ; il ne lève IngestError que si l'enveloppe est inexploitable.
      res.json(ingest(db, req.healthUser.id, req.body));
    } catch (err) {
      if (err instanceof IngestError) {
        // Payload malformé : rejeté avec un code clair et journalisé, l'endpoint reste debout.
        console.warn(`health/ingest : payload rejeté (${req.healthUser.username}) : ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      console.error("health/ingest : ingestion échouée :", err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  });

  return router;
}

module.exports = { healthRouter };
