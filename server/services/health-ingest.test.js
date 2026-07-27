// Self-check du service d'ingestion Apple Santé : `node server/services/health-ingest.test.js`.
// Couvre le parsing pur (mapping, alias, extracteurs, payloads malformés, cas limite de fuseau
// horaire) puis l'écriture idempotente sur une base :memory:. Indépendant de tout seed.

const assert = require("assert");
const Database = require("better-sqlite3");

const { IngestError, METRIC_MAP, toRows, ingest } = require("./health-ingest");
const { METRIC_UNITS } = require("./body-metrics");

// Fabrique un payload Health Auto Export à partir d'une liste de métriques.
const payload = (metrics) => ({ data: { metrics, workouts: [] } });

// --- cohérence des deux constantes -----------------------------------------
// Tout metric_type visé par METRIC_MAP doit exister dans la liste canonique de body-metrics.js,
// sinon la métrique serait écrite en base mais invisible au sélecteur et refusée en lecture (400).
for (const [name, spec] of Object.entries(METRIC_MAP)) {
  assert.ok(METRIC_UNITS[spec.type], `${name} → metric_type inconnu : ${spec.type}`);
}

// --- payload valide ---------------------------------------------------------
let out = toRows(
  payload([
    {
      name: "resting_heart_rate",
      units: "bpm",
      data: [
        { date: "2026-07-25 08:00:00 +0200", qty: 52 },
        { date: "2026-07-26 08:00:00 +0200", qty: 54 },
      ],
    },
  ])
);
assert.strictEqual(out.rows.length, 2);
assert.deepStrictEqual(out.rows[0], {
  metric_type: "resting_hr",
  value: 52,
  recorded_at: "2026-07-25",
  unit: "bpm",
});
assert.deepStrictEqual(out.unknown_metrics, []);
assert.strictEqual(out.skipped, 0);

// --- CAS LIMITE FUSEAU HORAIRE (verrou de non-régression) -------------------
// Point à 00:30 en heure locale avec offset +0200 : l'instant UTC correspondant est 22:30 la
// VEILLE. Une extraction qui passerait par `new Date(...)` puis toISOString() classerait donc ce
// point le 2026-07-25. On attend 2026-07-26 : le jour LOCAL, tel qu'écrit dans la chaîne.
out = toRows(
  payload([{ name: "step_count", units: "count", data: [{ date: "2026-07-26 00:30:00 +0200", qty: 8421 }] }])
);
assert.strictEqual(out.rows[0].recorded_at, "2026-07-26", "jour local conservé, pas de bascule UTC");
assert.strictEqual(
  new Date("2026-07-26T00:30:00+02:00").toISOString().slice(0, 10),
  "2026-07-25",
  "contrôle : la conversion UTC donnerait bien la veille (c'est ce qu'on évite)"
);
// Même vérification avec un offset négatif, où c'est le soir qui basculerait sur le lendemain UTC.
out = toRows(
  payload([{ name: "step_count", data: [{ date: "2026-07-26 23:30:00 -0500", qty: 9000 }] }])
);
assert.strictEqual(out.rows[0].recorded_at, "2026-07-26", "offset négatif : jour local conservé");

// --- extracteurs particuliers ----------------------------------------------
// Sommeil : pas de `qty`, mais totalSleep / asleep.
out = toRows(
  payload([
    {
      name: "sleep_analysis",
      units: "hr",
      data: [
        { date: "2026-07-26", totalSleep: 7.4, asleep: 7.1, deep: 1.2 },
        { date: "2026-07-25", asleep: 6.8 }, // pas de totalSleep → repli sur asleep
        { date: "2026-07-24", startDate: "…", endDate: "…", value: "core" }, // phase non agrégée
      ],
    },
  ])
);
assert.deepStrictEqual(
  out.rows.map((r) => [r.recorded_at, r.value]),
  [
    ["2026-07-26", 7.4],
    ["2026-07-25", 6.8],
  ],
  "sommeil : totalSleep prioritaire, repli sur asleep"
);
assert.strictEqual(out.skipped, 1, "phase de sommeil non agrégée : écartée, pas devinée");

// Repli qty → avg pour les métriques envoyées agrégées.
out = toRows(payload([{ name: "heart_rate_variability", data: [{ date: "2026-07-26", avg: 61, min: 40, max: 90 }] }]));
assert.strictEqual(out.rows[0].value, 61, "pas de qty : repli sur avg");
assert.strictEqual(out.rows[0].metric_type, "hrv");

// --- alias et casse ---------------------------------------------------------
out = toRows(payload([{ name: "Body_Mass", units: "kg", data: [{ date: "2026-07-26", qty: 78.4 }] }]));
assert.strictEqual(out.rows[0].metric_type, "weight", "alias + casse tolérés");

// --- métrique inconnue ignorée proprement -----------------------------------
out = toRows(
  payload([
    { name: "blood_glucose", units: "mg/dL", data: [{ date: "2026-07-26", qty: 92 }] },
    { name: "step_count", units: "count", data: [{ date: "2026-07-26", qty: 8421 }] },
  ])
);
assert.strictEqual(out.rows.length, 1, "seule la métrique retenue est convertie");
assert.deepStrictEqual(out.unknown_metrics, ["blood_glucose"], "l'inconnue est signalée, pas perdue");

// --- unité : celle annoncée par l'app prime, sinon défaut du type -----------
out = toRows(payload([{ name: "active_energy", units: "kJ", data: [{ date: "2026-07-26", qty: 2400 }] }]));
assert.strictEqual(out.rows[0].unit, "kJ");
out = toRows(payload([{ name: "active_energy", data: [{ date: "2026-07-26", qty: 2400 }] }]));
assert.strictEqual(out.rows[0].unit, METRIC_UNITS.active_energy, "unité absente : défaut du type");

// --- points douteux comptés, jamais devinés ---------------------------------
out = toRows(
  payload([
    {
      name: "step_count",
      data: [
        { date: "hier", qty: 100 }, // date illisible
        { date: "2026-13-45", qty: 100 }, // date impossible
        { date: "2026-07-26" }, // pas de valeur
        { date: "2026-07-26", qty: "8421" }, // valeur non numérique
        { date: "2026-07-26", qty: NaN }, // NaN
        null, // point non-objet
        { date: "2026-07-26", qty: 8421 }, // le seul valide
      ],
    },
  ])
);
assert.strictEqual(out.rows.length, 1);
assert.strictEqual(out.skipped, 6, "chaque point douteux est compté");

// --- payloads malformés : IngestError (→ 400), jamais de crash --------------
for (const bad of [null, undefined, 42, "texte", [], {}, { data: {} }, { data: { metrics: "nope" } }]) {
  assert.throws(() => toRows(bad), IngestError, `payload rejeté : ${JSON.stringify(bad)}`);
}
// Entrée de métrique inexploitable au milieu d'un lot : le reste du lot passe quand même.
out = toRows(payload([null, { units: "bpm" }, { name: "step_count", data: [{ date: "2026-07-26", qty: 1 }] }]));
assert.strictEqual(out.rows.length, 1);
assert.strictEqual(out.skipped, 2);
// `data` absent ou non-tableau : métrique reconnue mais sans point, pas une erreur.
out = toRows(payload([{ name: "step_count" }, { name: "step_count", data: "nope" }]));
assert.deepStrictEqual(out, { rows: [], unknown_metrics: [], skipped: 0 });

// --- écriture en base :memory: ---------------------------------------------
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE body_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, metric_type TEXT NOT NULL, value REAL NOT NULL,
    unit TEXT, recorded_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual','apple_health')),
    UNIQUE (user_id, metric_type, recorded_at, source)
  );
`);

const p1 = payload([
  { name: "step_count", units: "count", data: [{ date: "2026-07-26 12:00:00 +0200", qty: 4000 }] },
  { name: "blood_glucose", data: [{ date: "2026-07-26", qty: 92 }] },
]);
let res = ingest(db, 1, p1);
assert.deepStrictEqual(res, { received: 1, written: 1, skipped: 0, unknown_metrics: ["blood_glucose"] });

// Rejeu du MÊME lot : pas de doublon (contrainte d'unicité), valeur inchangée.
ingest(db, 1, p1);
let rows = db.prepare("SELECT * FROM body_metrics WHERE user_id = 1").all();
assert.strictEqual(rows.length, 1, "rejeu du même lot : aucun doublon");
assert.strictEqual(rows[0].value, 4000);

// Export du soir : même jour, total complet → DO UPDATE corrige (ce que DO NOTHING gèlerait).
ingest(
  db,
  1,
  payload([{ name: "step_count", units: "count", data: [{ date: "2026-07-26 22:00:00 +0200", qty: 11500 }] }])
);
rows = db.prepare("SELECT * FROM body_metrics WHERE user_id = 1").all();
assert.strictEqual(rows.length, 1, "toujours une seule ligne pour le jour");
assert.strictEqual(rows[0].value, 11500, "total partiel corrigé par l'export complet");
assert.strictEqual(rows[0].source, "apple_health");

// Cloisonnement des utilisateurs : le jeton route vers un profil, pas vers l'autre.
ingest(db, 2, payload([{ name: "step_count", data: [{ date: "2026-07-26", qty: 300 }] }]));
assert.strictEqual(db.prepare("SELECT COUNT(*) c FROM body_metrics WHERE user_id = 2").get().c, 1);
assert.strictEqual(db.prepare("SELECT value v FROM body_metrics WHERE user_id = 1").get().v, 11500);

console.log("health-ingest.test.js : OK");
