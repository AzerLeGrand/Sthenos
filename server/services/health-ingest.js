// Service d'ingestion Apple Santé (docs/health-integration.md §5).
// Reçoit le payload JSON de Health Auto Export (app iOS tierce), le parse DÉFENSIVEMENT et écrit
// dans body_metrics. La source n'est pas fiable : structure variable selon la version de l'app et
// les réglages d'export, métriques non retenues mélangées aux nôtres, envoi par lots. Rien n'est
// écrit en base sans avoir été validé ici.
//
// Découpage pur / impur, comme les autres services :
// - toRows() est PURE (payload en entrée, lignes en sortie) → testable sans base.
// - ingest() est impure (transaction SQLite), et ne fait qu'écrire ce que toRows() a validé.

const { METRIC_UNITS, toCalendarDay, upsertMetric } = require("./body-metrics");

// Erreur de payload : distingue « le client a envoyé n'importe quoi » (→ 400) d'un bug serveur
// (→ 500). La route s'appuie sur ce type, elle ne renifle pas de messages.
class IngestError extends Error {}

// --- Mapping des identifiants Health Auto Export ---------------------------

// Identifiants de métriques imposés par Health Auto Export → metric_type Sthenos.
// Constante de CODE et non de config.yml : ce ne sont pas des réglages mais des identifiants
// externes fixes, dictés par une app tierce (docs/config.md — config.yml ne porte que le réglable).
//
// ATTENTION : Health Auto Export documente le FORMAT de son payload mais ne publie nulle part la
// liste de ses identifiants `name` exacts (son wiki ne donne que des libellés d'affichage du type
// « Resting Heart Rate »). Les clés ci-dessous sont la forme snake_case observée dans les payloads
// réels ; plusieurs alias peuvent pointer vers le même metric_type, et tout `name` inconnu est
// remonté dans `unknown_metrics` par la réponse d'ingestion. C'est le filet : si un identifiant est
// faux, il se voit dans la réponse et se corrige ici, sans perte silencieuse de données.
const METRIC_MAP = {
  resting_heart_rate: { type: "resting_hr" },
  heart_rate_variability: { type: "hrv" },
  vo2_max: { type: "vo2max" },
  vo2max: { type: "vo2max" }, // alias
  cardio_recovery: { type: "cardio_recovery" },
  step_count: { type: "steps" },
  active_energy: { type: "active_energy" },
  active_energy_burned: { type: "active_energy" }, // alias
  weight_body_mass: { type: "weight" },
  body_mass: { type: "weight" }, // alias
  sleep_analysis: { type: "sleep_hours", extract: sleepHours },
};

// Nombre fini, ou null. Écarte NaN, Infinity, null, chaînes et objets.
function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Extracteur par défaut. La plupart des métriques arrivent en { date, qty }, mais certaines
// métriques cardiaques arrivent agrégées en { date, avg, min, max } sans `qty` : on retombe sur la
// moyenne plutôt que de perdre le point.
function defaultValue(point) {
  return num(point.qty) ?? num(point.avg);
}

// Le sommeil est le cas particulier documenté : ses points n'ont PAS de `qty` mais
// { date, totalSleep, asleep, core, deep, rem } (heures). On retient le total, à défaut le temps
// endormi. Les points non agrégés (startDate/endDate/value) ne sont pas exploités : ils décriraient
// des phases, pas une durée de nuit — ils tombent alors en `skipped`.
function sleepHours(point) {
  return num(point.totalSleep) ?? num(point.asleep);
}

// --- Parsing (pur) ----------------------------------------------------------

// Convertit un payload Health Auto Export en lignes prêtes pour body_metrics.
// Lève IngestError si l'enveloppe elle-même est inexploitable ; sinon ne lève jamais : tout ce qui
// est douteux à l'intérieur est compté (`skipped`) ou signalé (`unknown_metrics`), jamais deviné.
// Retourne { rows, unknown_metrics, skipped }.
function toRows(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new IngestError("payload attendu : un objet JSON");
  }
  const metrics = payload.data && payload.data.metrics;
  if (!Array.isArray(metrics)) {
    throw new IngestError("payload invalide : data.metrics doit être un tableau");
  }

  const rows = [];
  const unknown = new Set();
  let skipped = 0;

  for (const metric of metrics) {
    if (!metric || typeof metric !== "object" || typeof metric.name !== "string") {
      skipped++; // entrée de métrique non exploitable : on continue, un lot partiel vaut mieux que rien
      continue;
    }

    const spec = METRIC_MAP[metric.name.trim().toLowerCase()];
    if (!spec) {
      // Métrique hors de notre liste (Health Auto Export en exporte plus de 150) : ignorée
      // proprement, mais tracée pour pouvoir compléter METRIC_MAP si c'était un alias inconnu.
      unknown.add(metric.name);
      continue;
    }

    const extract = spec.extract || defaultValue;
    const points = Array.isArray(metric.data) ? metric.data : [];

    for (const point of points) {
      if (!point || typeof point !== "object") {
        skipped++;
        continue;
      }
      const recorded_at = toCalendarDay(point.date); // jour LOCAL, sans conversion UTC (cf body-metrics.js)
      const value = extract(point);
      if (recorded_at === null || value === null) {
        skipped++; // date illisible ou valeur absente : on ne devine pas, on écarte
        continue;
      }
      rows.push({
        metric_type: spec.type,
        value,
        recorded_at,
        // L'unité annoncée par l'app prime (elle sait ce qu'elle envoie : kJ ou kcal, etc.) ;
        // à défaut, l'unité par défaut de la métrique.
        unit: typeof metric.units === "string" && metric.units.trim() ? metric.units.trim() : METRIC_UNITS[spec.type],
      });
    }
  }

  return { rows, unknown_metrics: [...unknown], skipped };
}

// --- Écriture (impure) ------------------------------------------------------

// Parse puis écrit, en une transaction. Chaque requête est traitée INDÉPENDAMMENT : Health Auto
// Export découpe ses exports en lots pour ne pas saturer la mémoire de l'iPhone, il n'y a donc
// aucun état de session entre deux envois.
//
// ponytail: deux points d'une même métrique sur un même jour dans un même lot (export horaire) se
// remplacent l'un l'autre, le dernier gagne — le total du jour n'est pas recalculé. Health Auto
// Export doit être configuré en agrégation quotidienne (c'est ce que décrit le guide iOS).
// Upgrade si besoin : agréger par (metric_type, jour) avant écriture, somme pour steps/energy.
function ingest(db, userId, payload) {
  const { rows, unknown_metrics, skipped } = toRows(payload); // peut lever IngestError → 400

  const write = db.transaction((toWrite) => {
    for (const row of toWrite) {
      upsertMetric(db, userId, { ...row, source: "apple_health" });
    }
  });
  write(rows);

  // `written` plutôt qu'un couple inserted/ignored : depuis le passage des deux sources en
  // DO UPDATE, une ligne est toujours écrite, jamais ignorée — un compteur « ignored » serait
  // constamment à zéro, donc trompeur.
  return { received: rows.length + skipped, written: rows.length, skipped, unknown_metrics };
}

module.exports = { IngestError, METRIC_MAP, toRows, ingest };
