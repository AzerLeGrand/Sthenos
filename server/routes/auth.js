// Routes d'authentification : login, logout, me. Couche routes uniquement (validation des
// entrées, codes de réponse) ; la logique de vérification vit dans server/services/auth.js.

const express = require("express");

const { authenticate, getUserById } = require("../services/auth");

// Fabrique le routeur en recevant la base par injection.
function authRouter(db) {
  const router = express.Router();

  // POST /api/auth/login — vérifie les identifiants, régénère la session, pose le cookie.
  router.post("/login", (req, res) => {
    const { username, password } = req.body || {};

    // Validation d'entrée : les deux champs sont requis.
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return res.status(400).json({ error: "username et mot de passe requis" });
    }

    let user;
    try {
      user = authenticate(db, username, password);
    } catch (err) {
      console.error("login : erreur d'authentification :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }

    // Message unifié : ne révèle pas si c'est le username ou le mot de passe qui est faux.
    if (!user) {
      return res.status(401).json({ error: "identifiants invalides" });
    }

    // Régénération de session avant de poser l'identité : empêche la fixation de session
    // (réutilisation d'un sid obtenu avant connexion).
    req.session.regenerate((err) => {
      if (err) {
        console.error("login : régénération de session échouée :", err.message);
        return res.status(500).json({ error: "erreur interne" });
      }
      req.session.userId = user.id; // on ne stocke que l'id ; l'utilisateur est relu ensuite
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("login : sauvegarde de session échouée :", saveErr.message);
          return res.status(500).json({ error: "erreur interne" });
        }
        return res.json({ id: user.id, username: user.username });
      });
    });
  });

  // POST /api/auth/logout — détruit la session et efface le cookie. Idempotent.
  router.post("/logout", (req, res) => {
    // Pas de session : rien à détruire, on répond ok (idempotence).
    if (!req.session) return res.json({ ok: true });

    req.session.destroy((err) => {
      if (err) {
        console.error("logout : destruction de session échouée :", err.message);
        return res.status(500).json({ error: "erreur interne" });
      }
      res.clearCookie("connect.sid"); // nom de cookie par défaut d'express-session
      return res.json({ ok: true });
    });
  });

  // GET /api/auth/me — renvoie l'utilisateur courant si authentifié, 401 sinon.
  router.get("/me", (req, res) => {
    const userId = req.session && req.session.userId;
    if (!userId) return res.status(401).json({ error: "non authentifié" });

    let user;
    try {
      user = getUserById(db, userId);
    } catch (err) {
      console.error("me : accès base échoué :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }

    // Session valide mais utilisateur disparu : on considère non authentifié.
    if (!user) return res.status(401).json({ error: "non authentifié" });

    return res.json({ id: user.id, username: user.username });
  });

  return router;
}

module.exports = { authRouter };
