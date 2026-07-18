// Point d'entrée du serveur Sthenos.
// Séquence de démarrage : charger la config → ouvrir la base → appliquer les migrations
// → monter Express → écouter. Toute erreur à ces étapes arrête le process explicitement.

const express = require("express");

const { loadConfig } = require("./config");
const { openDatabase } = require("./db");
const { runMigrations } = require("./db/migrate");
const { statusRouter } = require("./routes/status");

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

  // Montage des routes (couche routes séparée ; la base est injectée).
  app.use("/api", statusRouter(db));

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
