// Service de seed du dataset d'exercices.
// Lit le JSON du dataset (chemin depuis config), mappe chaque enregistrement vers la table
// `exercises` (cf docs/exercise-dataset.md §4), et fait un upsert idempotent.
// Robustesse : un enregistrement fautif (champ obligatoire manquant) ou un média absent est
// consigné mais n'interrompt jamais l'import. Rapport final en console ET dans un fichier.
//
// Lancement : `npm run seed` (point d'entrée séparé du serveur, cf require.main plus bas).

const fs = require("fs");
const path = require("path");

const { loadConfig } = require("../config");
const { openDatabase } = require("../db");

// Colonnes NOT NULL de la table `exercises` : leur absence dans un enregistrement source
// disqualifie la ligne (on la saute plutôt que de provoquer une erreur SQL).
const REQUIRED = ["id", "name", "category", "equipment", "image", "gif_url"];

// Requête d'upsert idempotente : réinsère ou met à jour sur conflit de clé primaire.
// Relancer le seed ne duplique rien et applique les évolutions éventuelles du dataset.
const UPSERT_SQL = `
  INSERT INTO exercises
    (id, name, category, equipment, target, muscle_group, secondary_muscles, instructions_en, image, gif_url)
  VALUES
    (@id, @name, @category, @equipment, @target, @muscle_group, @secondary_muscles, @instructions_en, @image, @gif_url)
  ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, category=excluded.category, equipment=excluded.equipment,
    target=excluded.target, muscle_group=excluded.muscle_group,
    secondary_muscles=excluded.secondary_muscles, instructions_en=excluded.instructions_en,
    image=excluded.image, gif_url=excluded.gif_url
`;

// Transforme un enregistrement source en objet de colonnes prêt pour l'upsert.
// - category se rabat sur body_part (champs redondants dans le dataset).
// - secondary_muscles sérialisé en JSON texte (non normalisé, cf data-model.md §2.3).
// - seul instructions.en est retenu (interface FR, contenu EN — cf exercise-dataset.md §3).
function mapRecord(rec) {
  return {
    id: rec.id,
    name: rec.name,
    category: rec.category ?? rec.body_part,
    equipment: rec.equipment,
    target: rec.target ?? null,
    muscle_group: rec.muscle_group ?? null,
    secondary_muscles: JSON.stringify(rec.secondary_muscles ?? []),
    instructions_en: (rec.instructions && rec.instructions.en) || null,
    image: rec.image,
    gif_url: rec.gif_url,
  };
}

// Vérifie l'existence sur disque des médias référencés. On joint le dossier configuré au
// basename du chemin du dataset : robuste au préfixe (`images/`, `videos/`) et sans chemin en dur.
// Retourne la liste des médias absents pour cet enregistrement ([] si tout est présent).
function checkMedia(rec, config) {
  const missing = [];
  const image = path.join(config.paths.media_images, path.basename(rec.image));
  const gif = path.join(config.paths.media_videos, path.basename(rec.gif_url));
  if (!fs.existsSync(image)) missing.push(`image absente (${rec.image})`);
  if (!fs.existsSync(gif)) missing.push(`gif absent (${rec.gif_url})`);
  return missing;
}

// Construit le texte du rapport de fin à partir des stats accumulées.
function buildReport(stats) {
  const lines = [];
  lines.push("=== Seed exercices — rapport ===");
  lines.push(`Généré le      : ${new Date().toISOString()}`);
  lines.push(`Lus            : ${stats.total}`);
  lines.push(`Importés       : ${stats.imported}`);

  lines.push(`Ignorés (champ obligatoire manquant) : ${stats.skipped.length}`);
  if (stats.skipped.length > 0) {
    for (const s of stats.skipped) lines.push(`  - ${s.id} : manque ${s.missing.join(", ")}`);
  }

  lines.push(`Erreurs d'insertion : ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    for (const e of stats.errors) lines.push(`  - ${e.id} : ${e.message}`);
  }

  lines.push(`Médias manquants : ${stats.missingMedia.length}`);
  for (const m of stats.missingMedia) lines.push(`  - ${m.id} : ${m.what.join(", ")}`);

  // Valeurs distinctes triées par fréquence décroissante. La comparaison à la table de
  // correspondance FR (exercise-dataset.md §6) reste manuelle : elle vit côté front, pas ici.
  const dump = (label, map) => {
    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(`${label} (${entries.length} distinctes) :`);
    for (const [val, n] of entries) lines.push(`  ${val} (${n})`);
  };
  dump("Catégories rencontrées", stats.categories);
  dump("Équipements rencontrés", stats.equipment);

  return lines.join("\n") + "\n";
}

// Exécute le seed complet. Retourne les stats (utile pour un test/inspection).
function seed() {
  const config = loadConfig();
  const db = openDatabase(config.paths.db_file);

  // Lecture + parsing du dataset. Fichier absent ou JSON malformé = arrêt net (rien à importer).
  const jsonPath = path.resolve(config.paths.exercises_json);
  let raw;
  try {
    raw = fs.readFileSync(jsonPath, "utf8");
  } catch (err) {
    throw new Error(`Dataset introuvable ou illisible (${jsonPath}) : ${err.message}`);
  }
  let records;
  try {
    records = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Dataset JSON malformé (${jsonPath}) : ${err.message}`);
  }
  if (!Array.isArray(records)) {
    throw new Error("Dataset invalide : la racine de exercises.json doit être un tableau.");
  }

  const stats = {
    total: records.length,
    imported: 0,
    skipped: [],
    errors: [],
    missingMedia: [],
    categories: new Map(),
    equipment: new Map(),
  };

  const upsert = db.prepare(UPSERT_SQL);
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  // Une transaction unique pour ~1324 lignes (rapide). Chaque ligne est traitée en try/catch
  // pour qu'un enregistrement fautif ne fasse pas échouer tout le lot.
  const runAll = db.transaction((rows) => {
    for (const rec of rows) {
      // Champs obligatoires : on saute la ligne si l'un manque (consigné, non fatal).
      const missing = REQUIRED.filter((f) => {
        const v = f === "category" ? rec.category ?? rec.body_part : rec[f];
        return v === undefined || v === null || v === "";
      });
      if (missing.length > 0) {
        stats.skipped.push({ id: rec.id || "?", missing });
        continue;
      }

      try {
        upsert.run(mapRecord(rec));
        stats.imported++;
        bump(stats.categories, rec.category ?? rec.body_part);
        bump(stats.equipment, rec.equipment);

        const mediaMissing = checkMedia(rec, config);
        if (mediaMissing.length > 0) stats.missingMedia.push({ id: rec.id, what: mediaMissing });
      } catch (err) {
        // Erreur SQL inattendue sur une ligne : consignée, l'import continue.
        stats.errors.push({ id: rec.id || "?", message: err.message });
      }
    }
  });
  runAll(records);

  // Rapport : console + fichier (data/seed-report.txt, à côté du dataset, non versionné).
  const report = buildReport(stats);
  console.log(report);
  const reportPath = path.join(path.dirname(jsonPath), "seed-report.txt");
  try {
    fs.writeFileSync(reportPath, report, "utf8");
    console.log(`Rapport écrit dans ${reportPath}`);
  } catch (err) {
    // Échec d'écriture du rapport : non bloquant, l'import a déjà eu lieu.
    console.error(`Impossible d'écrire le rapport (${reportPath}) : ${err.message}`);
  }

  db.close();
  return stats;
}

// Point d'entrée : lancé uniquement en exécution directe (`node server/services/seed.js`),
// jamais au `require` depuis le serveur.
if (require.main === module) {
  try {
    seed();
  } catch (err) {
    console.error("Échec du seed :", err.message);
    process.exit(1);
  }
}

module.exports = { seed };
