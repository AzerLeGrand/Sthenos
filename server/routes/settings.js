// Routes de l'écran Réglages (docs/frontend.md §3.4). Pour l'instant : le jeton d'ingestion santé.
// Protégées par requireAuth (voir index.js) — c'est bien la SESSION de l'utilisateur connecté qui
// autorise à lire et régénérer son propre jeton ; le jeton lui-même n'ouvre jamais ces routes.

const express = require("express");

const { getHealthToken, regenerateHealthToken } = require("../services/settings");

// `health` = { baseUrl, ingestPath }, injecté au montage depuis config.yml (rien en dur).
function settingsRouter(db, health) {
  const router = express.Router();

  const wrap = (label, fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(`settings : ${label} échoué :`, err.message);
      res.status(500).json({ error: "erreur interne" });
    }
  };

  // URL complète à coller dans Health Auto Export. Construite ici et jamais côté front : le front
  // ignore l'URL publique de déploiement, elle vit dans config.yml (server.base_url + ingest_path).
  const ingestUrl = health.baseUrl.replace(/\/+$/, "") + health.ingestPath;

  // Réponse de forme unique pour les deux routes : un seul format à gérer côté front, le bouton
  // bascule Générer/Régénérer sur la nullité du jeton.
  const payload = (token) => ({ health_ingest_token: token, ingest_url: ingestUrl });

  // GET /api/settings/health-token — jeton courant, null tant qu'aucun n'a été généré.
  router.get(
    "/health-token",
    wrap("lecture du jeton", (req, res) => {
      res.json(payload(getHealthToken(db, req.user.id)));
    })
  );

  // POST /api/settings/health-token/regenerate — génère et écrase. L'ancien jeton est invalidé
  // immédiatement (l'automatisation Health Auto Export existante cesse de fonctionner jusqu'à mise
  // à jour) : l'avertissement est affiché côté Réglages avant l'action.
  router.post(
    "/health-token/regenerate",
    wrap("régénération du jeton", (req, res) => {
      res.json(payload(regenerateHealthToken(db, req.user.id)));
    })
  );

  return router;
}

module.exports = { settingsRouter };
