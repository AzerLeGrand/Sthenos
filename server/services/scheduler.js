// Planification de l'analyse quotidienne (docs/architecture.md §3.3, health-integration.md §7).
// Une seule tâche cron, dans le même process que le serveur (démarrée depuis index.js après
// l'ouverture de la base). Déclenchement une fois par jour à health.analysis_start, dans le fuseau
// health.timezone. Pas de rattrapage automatique : le job traite ce qui est présent (analysis_end
// reste documentaire) ; le rattrapage manuel passe par le bouton « Lancer l'analyse maintenant ».

const cron = require("node-cron");

const { runDailySummary, localDay } = require("./daily-summary");

// Convertit "HH:MM" en expression cron "M H * * *" (chaque jour à cette heure). Throw si le format
// est invalide : une heure d'analyse mal formée doit faire échouer le démarrage, pas planifier
// silencieusement n'importe quoi.
function toCronExpr(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm).trim());
  if (!m) throw new Error(`health.analysis_start invalide (attendu HH:MM) : ${hhmm}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return `${minute} ${hour} * * *`;
}

// Démarre la tâche planifiée. Exécute le résumé pour chaque utilisateur ; une erreur sur un
// utilisateur est journalisée sans interrompre les autres. Retourne l'objet tâche node-cron.
function startScheduler(db, config) {
  const expr = toCronExpr(config.health.analysis_start);

  const task = cron.schedule(
    expr,
    () => {
      const day = localDay(config.health.timezone);
      const users = db.prepare("SELECT id FROM users").all();
      for (const u of users) {
        try {
          runDailySummary(db, u.id, day, config.health);
        } catch (err) {
          console.error(`analyse quotidienne : utilisateur ${u.id} échoué :`, err.message);
        }
      }
      console.log(`analyse quotidienne : ${users.length} utilisateur(s) traité(s) pour ${day}`);
    },
    { timezone: config.health.timezone }
  );

  console.log(`analyse quotidienne planifiée : "${expr}" (${config.health.timezone})`);
  return task;
}

module.exports = { toCronExpr, startScheduler };
