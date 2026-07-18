// Point d'entrée du serveur Sthenos.
// Séquence de démarrage : charger la config → ouvrir la base → appliquer les migrations
// → monter Express → écouter. Toute erreur à ces étapes arrête le process explicitement.

const express = require("express");
const session = require("express-session");

const { loadConfig } = require("./config");
const { openDatabase } = require("./db");
const { runMigrations } = require("./db/migrate");
const { createSessionStore } = require("./db/session-store");
const { makeRequireAuth } = require("./middleware/requireAuth");
const { statusRouter } = require("./routes/status");
const { authRouter } = require("./routes/auth");
const { exercisesRouter } = require("./routes/exercises");

function main() {
  // 1. Configuration — échoue explicitement si une clé manque ou est invalide.
  const config = loadConfig();

  // 2. Base de données.
  const db = openDatabase(config.paths.db_file);

  // 3. Migrations — appliquées au démarrage, dans l'ordre.
  runMigrations(db);

  // 4. Application Express.
  const app = express();
  app.use(express.json()); // parsing des corps JSON pour l'API

  // nginx termine le TLS et parle en HTTP simple à Node en local (cf docs/infra.md).
  // Sans ceci, req.secure reste false et express-session refuse de poser le cookie
  // quand auth.cookie_secure est à true.
  app.set("trust proxy", 1);

  // Sessions : cookie httpOnly signé, options depuis config.yml (rien en dur).
  // Le store persiste en base (survit au redémarrage, cf docs/infra.md §9).
  app.use(
    session({
      secret: config.auth.session_secret,
      store: createSessionStore(db),
      resave: false, // le store gère l'écriture ; pas de réécriture systématique
      saveUninitialized: false, // pas de session pour les visiteurs non connectés
      rolling: true, // prolonge la fenêtre d'expiration à chaque requête active
      cookie: {
        httpOnly: true, // inaccessible au JavaScript (protège du vol par script)
        secure: config.auth.cookie_secure,
        sameSite: config.auth.cookie_same_site,
        maxAge: config.auth.session_ttl_days * 24 * 60 * 60 * 1000,
      },
    })
  );

  // Montage des routes (couche routes séparée ; la base est injectée).
  app.use("/api", statusRouter(db));
  app.use("/api/auth", authRouter(db));
  // Catalogue : protégé par requireAuth (pas d'accès anonyme), appliqué à tout le sous-arbre.
  app.use("/api/exercises", makeRequireAuth(db), exercisesRouter(db, config.pagination));

  // Filet de sécurité : toute erreur non gérée dans une route renvoie un 500 propre.
  app.use((err, req, res, next) => {
    console.error("Erreur non gérée :", err);
    res.status(500).json({ status: "error", message: "erreur interne" });
  });

  // 5. Écoute.
  const server = app.listen(config.server.port, config.server.host, () => {
    console.log(`Sthenos écoute sur http://${config.server.host}:${config.server.port}`);
  });

  // Arrêt propre : fermer la base sur SIGINT/SIGTERM.
  const shutdown = () => {
    console.log("Arrêt en cours…");
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Erreur au démarrage (config, base, migrations) : on journalise et on sort en échec.
try {
  main();
} catch (err) {
  console.error("Échec au démarrage :", err.message);
  process.exit(1);
}