// Module unique de configuration. Lit config.yml au démarrage, valide la présence et le type
// de chaque clé attendue, échoue explicitement si une clé obligatoire manque ou est invalide
// (pas de démarrage silencieux avec des valeurs implicites — cf docs/config.md §2).
// Le reste du code importe UNIQUEMENT ce module, jamais config.yml en dur.

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// Schéma attendu : chaque feuille est le type JS requis. "?" en suffixe = clé optionnelle.
// Sert à la fois de documentation exécutable et de validateur.
const SCHEMA = {
  server: { port: "number", host: "string", base_url: "string" },
  paths: {
    db_file: "string",
    media_images: "string",
    media_videos: "string",
    web_dist: "string",
    exercises_json: "string",
  },
  auth: { session_secret: "string", cookie_secure: "boolean", cookie_same_site: "string" },
  health: {
    ingest_path: "string",
    analysis_start: "string",
    analysis_end: "string",
    timezone: "string",
  },
  progression: {
    easy_delta: "number",
    deload_pct: "number",
    stall_sessions: "number",
    load_rounding_step: "number",
  },
  user_defaults: {
    default_rir: "number",
    default_rep_min: "number",
    default_rep_max: "number",
    default_increment: "number",
    theme: "string",
    weight_unit: "string",
  },
  "logging?": { level: "string" }, // section optionnelle
};

// Valide récursivement `value` contre `schema`, en accumulant les erreurs avec leur chemin.
// Retourne la liste des messages d'erreur (vide si tout est valide).
function validate(schema, value, prefix, errors) {
  for (const rawKey of Object.keys(schema)) {
    const optional = rawKey.endsWith("?");
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    const expected = schema[rawKey];
    const actual = value ? value[key] : undefined;
    const dotted = prefix ? `${prefix}.${key}` : key;

    if (actual === undefined || actual === null) {
      if (!optional) errors.push(`clé manquante : ${dotted}`);
      continue;
    }

    if (typeof expected === "object") {
      if (typeof actual !== "object" || Array.isArray(actual)) {
        errors.push(`${dotted} doit être un objet`);
        continue;
      }
      validate(expected, actual, dotted, errors);
    } else if (typeof actual !== expected) {
      errors.push(`${dotted} doit être de type ${expected} (reçu : ${typeof actual})`);
    }
  }
  return errors;
}

// Charge et valide la configuration. `throw` si le fichier est introuvable, illisible,
// mal formé, ou si une clé obligatoire manque / a le mauvais type.
function loadConfig(configPath) {
  const resolved = path.resolve(configPath || process.env.STHENOS_CONFIG || "config.yml");

  let raw;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    throw new Error(`Impossible de lire la configuration (${resolved}) : ${err.message}`);
  }

  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`config.yml invalide (YAML mal formé) : ${err.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("config.yml vide ou racine non-objet");
  }

  const errors = validate(SCHEMA, parsed, "", []);
  if (errors.length > 0) {
    throw new Error(`Configuration invalide :\n  - ${errors.join("\n  - ")}`);
  }

  return parsed;
}

module.exports = { loadConfig };
