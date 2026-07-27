// Self-check des indicateurs corporels : `node server/services/body-metrics.test.js`.
// Couvre l'extraction de date calendaire (pur), l'upsert des deux sources, la lecture d'une série
// (dédoublonnage par jour, priorité à 'manual', filtre de période), le sélecteur de métriques,
// puis le jeton d'ingestion et son middleware Bearer. Base :memory:, indépendant de tout seed.

const assert = require("assert");
const Database = require("better-sqlite3");

const {
  METRIC_UNITS,
  isKnownMetric,
  toCalendarDay,
  upsertMetric,
  upsertManual,
  listAvailableMetrics,
  getMetricSeries,
} = require("./body-metrics");
const { generateToken, getHealthToken, regenerateHealthToken } = require("./settings");
const { makeRequireHealthToken } = require("../middleware/requireHealthToken");

// --- metric_type connus -----------------------------------------------------
assert.strictEqual(isKnownMetric("weight"), true);
assert.strictEqual(isKnownMetric("sleep_hours"), true);
assert.strictEqual(isKnownMetric("blood_glucose"), false, "métrique non retenue → 400 côté route");
assert.strictEqual(isKnownMetric("constructor"), false, "pas de fuite du prototype d'Object");
assert.strictEqual(isKnownMetric(null), false);
assert.strictEqual(Object.keys(METRIC_UNITS).length, 8, "les 8 métriques de health-integration.md §4");

// --- toCalendarDay : jour LOCAL, jamais de conversion UTC -------------------
assert.strictEqual(toCalendarDay("2026-07-26"), "2026-07-26", "valeur d'un <input type=date>");
assert.strictEqual(toCalendarDay("2026-07-26 00:30:00 +0200"), "2026-07-26", "format Health Auto Export");
assert.strictEqual(toCalendarDay("2026-07-26T00:30:00+02:00"), "2026-07-26", "variante ISO");
assert.strictEqual(toCalendarDay("2026-13-01"), null, "mois impossible");
assert.strictEqual(toCalendarDay("2026-07-32"), null, "jour impossible");
assert.strictEqual(toCalendarDay("hier"), null);
assert.strictEqual(toCalendarDay(20260726), null, "non-chaîne");

// --- base de test -----------------------------------------------------------
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    health_ingest_token TEXT UNIQUE
  );
  CREATE TABLE body_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, metric_type TEXT NOT NULL, value REAL NOT NULL,
    unit TEXT, recorded_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('manual','apple_health')),
    UNIQUE (user_id, metric_type, recorded_at, source)
  );
`);
db.prepare("INSERT INTO users (username) VALUES ('alice')").run();
db.prepare("INSERT INTO users (username) VALUES ('bob')").run();

// --- saisie manuelle : upsert, la resaisie corrige --------------------------
let saved = upsertManual(db, 1, { metric_type: "weight", value: 78.4, recorded_at: "2026-07-26" });
assert.deepStrictEqual(saved, {
  metric_type: "weight",
  value: 78.4,
  unit: "kg",
  recorded_at: "2026-07-26",
  source: "manual",
});
upsertManual(db, 1, { metric_type: "weight", value: 78.1, recorded_at: "2026-07-26" });
let rows = db.prepare("SELECT * FROM body_metrics WHERE user_id = 1 AND metric_type = 'weight'").all();
assert.strictEqual(rows.length, 1, "resaisie du même jour : pas de doublon");
assert.strictEqual(rows[0].value, 78.1, "resaisie du même jour : valeur corrigée");

// --- deux sources le même jour : deux lignes distinctes ---------------------
// La contrainte d'unicité inclut `source` : une balance connectée n'écraserait pas la saisie
// manuelle, et réciproquement. C'est la lecture qui tranche (voir plus bas).
upsertMetric(db, 1, {
  metric_type: "weight",
  value: 79.9,
  recorded_at: "2026-07-26",
  source: "apple_health",
});
assert.strictEqual(
  db.prepare("SELECT COUNT(*) c FROM body_metrics WHERE user_id=1 AND recorded_at='2026-07-26'").get().c,
  2,
  "manual et apple_health cohabitent sur le même jour"
);

// --- lecture : dédoublonnage par jour, 'manual' gagne -----------------------
let série = getMetricSeries(db, 1, "weight", "all");
assert.strictEqual(série.point_count, 1, "un seul point pour le jour, pas deux x identiques");
assert.deepStrictEqual(série.series[0], { date: "2026-07-26", value: 78.1, source: "manual" });
assert.strictEqual(série.unit, "kg");
assert.strictEqual(série.period, "all");
assert.strictEqual(série.metric_type, "weight");

// --- métrique valide sans donnée : 200 avec série vide, pas une erreur ------
série = getMetricSeries(db, 1, "hrv", "all");
assert.deepStrictEqual(série.series, []);
assert.strictEqual(série.point_count, 0);
assert.strictEqual(série.unit, METRIC_UNITS.hrv, "unité par défaut quand aucun point n'en porte");

// --- filtre de période ------------------------------------------------------
const jour = (il_y_a) => new Date(Date.now() - il_y_a * 86400000).toISOString().slice(0, 10);
for (const d of [5, 45, 200]) {
  upsertMetric(db, 1, {
    metric_type: "resting_hr",
    value: 50 + d,
    recorded_at: jour(d),
    source: "apple_health",
  });
}
assert.strictEqual(getMetricSeries(db, 1, "resting_hr", "30").point_count, 1, "30 jours");
assert.strictEqual(getMetricSeries(db, 1, "resting_hr", "90").point_count, 2, "90 jours");
assert.strictEqual(getMetricSeries(db, 1, "resting_hr", "all").point_count, 3, "tout");
// Ordre chronologique croissant : indispensable à la courbe.
const dates = getMetricSeries(db, 1, "resting_hr", "all").series.map((p) => p.date);
assert.deepStrictEqual(dates, [...dates].sort(), "série triée par date croissante");

// --- cloisonnement par utilisateur ------------------------------------------
upsertManual(db, 2, { metric_type: "weight", value: 62, recorded_at: "2026-07-26" });
assert.strictEqual(getMetricSeries(db, 1, "weight", "all").series[0].value, 78.1, "user 1 inchangé");
assert.strictEqual(getMetricSeries(db, 2, "weight", "all").series[0].value, 62, "user 2 isolé");

// --- sélecteur : métriques ayant au moins une donnée ------------------------
const dispo = listAvailableMetrics(db, 1);
assert.deepStrictEqual(
  dispo.map((m) => m.metric_type),
  ["resting_hr", "weight"],
  "seules les métriques renseignées, hrv absente"
);
const poids = dispo.find((m) => m.metric_type === "weight");
assert.strictEqual(poids.point_count, 2, "les deux sources sont comptées");
assert.strictEqual(poids.last_recorded_at, "2026-07-26");
assert.strictEqual(poids.unit, "kg");
assert.deepStrictEqual(
  listAvailableMetrics(db, 2).map((m) => m.metric_type),
  ["weight"],
  "sélecteur propre à chaque utilisateur"
);

// --- jeton d'ingestion ------------------------------------------------------
assert.strictEqual(getHealthToken(db, 1), null, "aucun jeton à la création du compte");
const t1 = regenerateHealthToken(db, 1);
assert.match(t1, /^[0-9a-f]{64}$/, "32 octets en hexadécimal");
assert.strictEqual(getHealthToken(db, 1), t1);
const t2 = regenerateHealthToken(db, 1);
assert.notStrictEqual(t2, t1, "la régénération produit un nouveau jeton");
assert.strictEqual(getHealthToken(db, 1), t2, "et invalide l'ancien (colonne écrasée)");
assert.notStrictEqual(generateToken(), generateToken(), "deux tirages ne collisionnent pas");
assert.throws(() => regenerateHealthToken(db, 99), /introuvable/, "utilisateur inexistant : échec explicite");

// --- middleware Bearer ------------------------------------------------------
const requireHealthToken = makeRequireHealthToken(db);

// Faux req/res minimalistes : on n'a besoin que de get(), status() et json().
function appel(authorization) {
  const req = { get: (h) => (h.toLowerCase() === "authorization" ? authorization : undefined) };
  const res = {
    code: 200,
    body: null,
    status(c) {
      this.code = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  let passé = false;
  requireHealthToken(req, res, () => {
    passé = true;
  });
  return { req, res, passé };
}

let a = appel(undefined);
assert.strictEqual(a.res.code, 401, "en-tête absent : 401");
assert.strictEqual(a.passé, false);
assert.strictEqual(appel("").res.code, 401, "en-tête vide : 401");
assert.strictEqual(appel(t2).res.code, 401, "jeton sans préfixe Bearer : 401");
assert.strictEqual(appel("Basic " + t2).res.code, 401, "mauvais schéma : 401");
assert.strictEqual(appel("Bearer " + "0".repeat(64)).res.code, 401, "jeton inconnu, même longueur : 401");
assert.strictEqual(appel("Bearer court").res.code, 401, "jeton de longueur différente : 401, pas de crash");
assert.strictEqual(appel("Bearer " + t1).res.code, 401, "ancien jeton régénéré : 401");

a = appel("Bearer " + t2);
assert.strictEqual(a.passé, true, "jeton valide : la requête passe");
assert.deepStrictEqual(a.req.healthUser, { id: 1, username: "alice" }, "routé vers le bon profil");
assert.strictEqual(a.req.user, undefined, "n'ouvre PAS une session applicative (req.user intouché)");

// Le jeton de bob route vers bob, pas vers alice.
const tb = regenerateHealthToken(db, 2);
assert.deepStrictEqual(appel("Bearer " + tb).req.healthUser, { id: 2, username: "bob" });
assert.strictEqual(appel("bearer " + tb).passé, true, "schéma insensible à la casse (RFC 7235)");

console.log("body-metrics.test.js : OK");
