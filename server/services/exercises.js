// Service catalogue d'exercices (couche logique). Construit les requêtes SQL filtrées ici,
// pas dans les routes. La table `exercises` est en lecture seule après seed (cf data-model.md §2.3).

// Colonnes renvoyées dans la liste : projection légère pour le sélecteur du catalogue
// (pas d'instructions_en ni de secondary_muscles, inutiles à la liste et lourds).
const LIST_COLUMNS = "id, name, category, equipment, target, muscle_group, image, gif_url";

// Construit la clause WHERE et les paramètres à partir des filtres fournis.
// Partagé entre la requête de comptage et la requête de page pour rester cohérent.
function buildWhere({ q, category, equipment }) {
  const conds = [];
  const params = {};
  if (q) {
    conds.push("name LIKE @q"); // LIKE insensible à la casse (ASCII) : noms en anglais
    params.q = `%${q}%`;
  }
  if (category) {
    conds.push("category = @category");
    params.category = category;
  }
  if (equipment) {
    conds.push("equipment = @equipment");
    params.equipment = equipment;
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  return { where, params };
}

// Liste paginée + recherche + filtres. `page` et `limit` sont supposés déjà validés/normalisés
// par la couche route (entiers positifs, limit borné). Retourne { total, page, limit, items }.
function listExercises(db, { q, category, equipment, page, limit }) {
  const { where, params } = buildWhere({ q, category, equipment });

  // Total (mêmes filtres, sans pagination) pour que le front connaisse le nombre de pages.
  const total = db.prepare(`SELECT COUNT(*) AS n FROM exercises ${where}`).get(params).n;

  // Page de résultats. ORDER BY id : ordre stable et déterministe entre les pages.
  const items = db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM exercises ${where} ORDER BY id LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset: (page - 1) * limit });

  return { total, page, limit, items };
}

// Détail complet d'un exercice. Retourne l'objet (avec secondary_muscles désérialisé en tableau)
// ou null si l'id est inconnu.
function getExerciseById(db, id) {
  const row = db.prepare("SELECT * FROM exercises WHERE id = ?").get(id);
  if (!row) return null;

  // secondary_muscles est stocké en JSON texte : on le rend au front comme tableau.
  // Parsing défensif : valeur absente ou JSON invalide → tableau vide.
  let secondary = [];
  if (row.secondary_muscles) {
    try {
      const parsed = JSON.parse(row.secondary_muscles);
      if (Array.isArray(parsed)) secondary = parsed;
    } catch {
      secondary = []; // JSON corrompu en base : on ne casse pas la réponse
    }
  }
  return { ...row, secondary_muscles: secondary };
}

// Valeurs distinctes de category et equipment présentes en base, pour les filtres du front.
// Valeurs brutes anglaises (la traduction FR vit côté front, cf exercise-dataset.md §6).
function getMeta(db) {
  const categories = db
    .prepare("SELECT DISTINCT category FROM exercises ORDER BY category")
    .all()
    .map((r) => r.category);
  const equipment = db
    .prepare("SELECT DISTINCT equipment FROM exercises ORDER BY equipment")
    .all()
    .map((r) => r.equipment);
  return { categories, equipment };
}

module.exports = { listExercises, getExerciseById, getMeta };
