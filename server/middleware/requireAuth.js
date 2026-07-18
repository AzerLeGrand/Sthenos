// Middleware d'authentification réutilisable, à poser sur toute route protégée.
// Vérifie qu'une session valide existe ET que l'utilisateur référencé existe toujours en base
// (source de vérité : une session peut pointer vers un compte supprimé).
// En cas de succès, expose l'utilisateur courant sur req.user pour les handlers suivants.

const { getUserById } = require("../services/auth");

// Fabrique le middleware en recevant la base par injection (cohérent avec les routes).
function makeRequireAuth(db) {
  return function requireAuth(req, res, next) {
    const userId = req.session && req.session.userId;
    if (!userId) {
      return res.status(401).json({ error: "authentification requise" });
    }

    let user;
    try {
      user = getUserById(db, userId);
    } catch (err) {
      // Erreur d'accès base : on ne laisse pas passer, et on journalise.
      console.error("requireAuth : accès base échoué :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }

    if (!user) {
      // Session orpheline (utilisateur supprimé) : on refuse.
      return res.status(401).json({ error: "authentification requise" });
    }

    req.user = user; // { id, username }
    next();
  };
}

module.exports = { makeRequireAuth };
