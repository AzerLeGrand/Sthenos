// Middleware d'authentification par JETON D'INGESTION SANTÉ (docs/architecture.md §4).
//
// DÉLIBÉRÉMENT SÉPARÉ de requireAuth : ce sont deux mécanismes différents qu'il ne faut jamais
// confondre. requireAuth protège toute l'API applicative par la session cookie d'un humain
// connecté ; celui-ci n'authentifie qu'une app tierce (Health Auto Export sur un iPhone) porteuse
// d'un jeton statique, et n'ouvre QUE la route d'ingestion. Il expose l'utilisateur sur
// `req.healthUser`, pas sur `req.user`, pour qu'aucun handler applicatif ne puisse par accident
// considérer une requête d'ingestion comme une session utilisateur.

const crypto = require("crypto");

function makeRequireHealthToken(db) {
  return function requireHealthToken(req, res, next) {
    const header = req.get("authorization") || "";
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (!match) {
      return res.status(401).json({ error: "jeton d'ingestion requis" });
    }
    const presented = Buffer.from(match[1], "utf8");

    let rows;
    try {
      // Deux utilisateurs au plus : on charge les jetons existants et on compare en mémoire.
      // Une requête SQL "WHERE health_ingest_token = ?" comparerait en temps variable côté SQLite.
      rows = db
        .prepare("SELECT id, username, health_ingest_token FROM users WHERE health_ingest_token IS NOT NULL")
        .all();
    } catch (err) {
      console.error("requireHealthToken : accès base échoué :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }

    // Comparaison en temps constant (timingSafeEqual), jamais `===` sur un secret. Pas de `break`
    // sur la correspondance : on parcourt toujours toute la liste pour ne pas révéler par le temps
    // de réponse QUEL utilisateur a été reconnu.
    // Limite inhérente : timingSafeEqual exige des tampons de même taille, donc un jeton de longueur
    // différente est écarté avant comparaison. Cela ne divulgue que la longueur, pas le contenu.
    let matched = null;
    for (const row of rows) {
      const known = Buffer.from(row.health_ingest_token, "utf8");
      if (known.length === presented.length && crypto.timingSafeEqual(known, presented)) {
        matched = row;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: "jeton d'ingestion invalide" });
    }

    req.healthUser = { id: matched.id, username: matched.username };
    next();
  };
}

module.exports = { makeRequireHealthToken };
