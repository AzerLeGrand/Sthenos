// Service routines (couche logique). Construit ici le SQL (préparé), pas dans les routes,
// comme server/services/exercises.js. Toutes les fonctions reçoivent `db` par injection.
// Les routes garantissent la propriété (user_id de session) AVANT d'appeler la plupart d'entre elles.

// Défaut de la colonne routine_exercises.goal (data-model.md §2.5). C'est le défaut du schéma SQL,
// PAS une préférence utilisateur : il ne vit donc pas dans user_settings, contrairement aux autres
// défauts (rir/rep/increment) qui, eux, sont amorcés par profil. Nommé pour ne pas répéter la chaîne.
const DEFAULT_GOAL = "hypertrophy";

// Projection enrichie d'un routine_exercise : ses paramètres + les champs utiles de l'exercice
// associé (name, category, equipment, image), pour éviter un aller-retour séparé côté front.
const RE_SELECT = `
  SELECT re.id, re.exercise_id, re.position, re.n_series, re.rep_min, re.rep_max,
         re.rir_cible, re.increment, re.goal, re.rest_seconds,
         e.name, e.category, e.equipment, e.image
  FROM routine_exercises re
  JOIN exercises e ON e.id = re.exercise_id`;

// Garde de propriété unique, réutilisée par toutes les routes /:id* : retourne la routine
// { id, name, created_at } si elle existe ET appartient à l'utilisateur, sinon null. Ne distingue
// jamais « inexistante » de « à autrui » (pas de fuite d'existence d'une routine d'un tiers).
function getOwnedRoutine(db, id, userId) {
  return (
    db
      .prepare("SELECT id, name, created_at FROM routines WHERE id = ? AND user_id = ?")
      .get(id, userId) || null
  );
}

// Liste des routines de l'utilisateur, avec le nombre d'exercices (LEFT JOIN pour compter 0 aussi).
function listRoutines(db, userId) {
  return db
    .prepare(
      `SELECT r.id, r.name, r.created_at, COUNT(re.id) AS exercise_count
       FROM routines r
       LEFT JOIN routine_exercises re ON re.routine_id = r.id
       WHERE r.user_id = ?
       GROUP BY r.id
       ORDER BY r.created_at`
    )
    .all(userId);
}

// Crée une routine et retourne sa forme « résumé » (comme un élément de listRoutines).
function createRoutine(db, userId, name) {
  const created_at = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO routines (user_id, name, created_at) VALUES (?, ?, ?)")
    .run(userId, name, created_at);
  return { id: info.lastInsertRowid, name, created_at, exercise_count: 0 };
}

// Renomme (propriété déjà vérifiée par la route).
function renameRoutine(db, id, name) {
  db.prepare("UPDATE routines SET name = ? WHERE id = ?").run(name, id);
}

// Nombre d'exercices d'une routine (pour la forme résumé après renommage).
function countExercises(db, routineId) {
  return db.prepare("SELECT COUNT(*) AS n FROM routine_exercises WHERE routine_id = ?").get(routineId)
    .n;
}

// Suppression en cascade APPLICATIVE, en transaction. La FK routine_exercises.routine_id de la
// migration 001 n'a pas d'ON DELETE CASCADE, et SQLite ne permet pas de l'ajouter par ALTER
// (il faudrait reconstruire la table). Avec foreign_keys=ON, supprimer la routine sans purger ses
// enfants échouerait sur la contrainte : on purge d'abord les enfants, puis la routine.
// ponytail: cascade applicative ; passer à ON DELETE CASCADE si d'autres tables enfants s'ajoutent.
function deleteRoutine(db, id) {
  db.transaction(() => {
    db.prepare("DELETE FROM routine_exercises WHERE routine_id = ?").run(id);
    db.prepare("DELETE FROM routines WHERE id = ?").run(id);
  })();
}

// Exercices d'une routine, enrichis et ordonnés par position (les trous de position sont tolérés :
// ORDER BY les ignore, cf plan). Utilisé pour le détail complet.
function getRoutineExercises(db, routineId) {
  return db.prepare(`${RE_SELECT} WHERE re.routine_id = ? ORDER BY re.position`).all(routineId);
}

// Détail complet : la routine (résumé) + ses exercices enrichis.
function getRoutineDetail(db, routine) {
  return { ...routine, exercises: getRoutineExercises(db, routine.id) };
}

// Un routine_exercise enrichi par son id (retour de POST/PATCH exercice).
function getRoutineExerciseById(db, reId) {
  return db.prepare(`${RE_SELECT} WHERE re.id = ?`).get(reId) || null;
}

// Ids des exercices d'une routine, dans l'ordre de position (validation du reorder).
function getRoutineExerciseIds(db, routineId) {
  return db
    .prepare("SELECT id FROM routine_exercises WHERE routine_id = ? ORDER BY position")
    .all(routineId)
    .map((r) => r.id);
}

// Existence d'un exercice du catalogue (validation de exercise_id à l'ajout).
function exerciseExists(db, id) {
  return !!db.prepare("SELECT 1 FROM exercises WHERE id = ?").get(id);
}

// Défauts d'entraînement de l'utilisateur (user_settings, data-model.md §2.2), pour amorcer
// les champs omis à l'ajout d'un exercice. Retourne la ligne ou null (compte sans settings).
function getUserDefaults(db, userId) {
  return (
    db
      .prepare(
        "SELECT default_rir, default_rep_min, default_rep_max, default_increment FROM user_settings WHERE user_id = ?"
      )
      .get(userId) || null
  );
}

// Insère un exercice en fin de routine : position = dernier + 1 (COALESCE pour la 1re, → 1).
// `p` contient des paramètres déjà validés et complétés par les défauts. Retourne l'id inséré.
function addRoutineExercise(db, routineId, p) {
  const position = db
    .prepare("SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM routine_exercises WHERE routine_id = ?")
    .get(routineId).pos;
  const info = db
    .prepare(
      `INSERT INTO routine_exercises
         (routine_id, exercise_id, position, n_series, rep_min, rep_max, rir_cible, increment, goal, rest_seconds)
       VALUES
         (@routine_id, @exercise_id, @position, @n_series, @rep_min, @rep_max, @rir_cible, @increment, @goal, @rest_seconds)`
    )
    .run({
      routine_id: routineId,
      exercise_id: p.exercise_id,
      position,
      n_series: p.n_series,
      rep_min: p.rep_min,
      rep_max: p.rep_max,
      rir_cible: p.rir_cible,
      increment: p.increment,
      goal: p.goal,
      rest_seconds: p.rest_seconds ?? null,
    });
  return info.lastInsertRowid;
}

// Un routine_exercise appartient-il bien à cette routine ? (double garde après la propriété
// de la routine, pour PATCH/DELETE d'un exercice). Retourne la ligne de paramètres ou null.
function getRoutineExerciseInRoutine(db, reId, routineId) {
  return (
    db
      .prepare(
        `SELECT id, exercise_id, n_series, rep_min, rep_max, rir_cible, increment, goal, rest_seconds
         FROM routine_exercises WHERE id = ? AND routine_id = ?`
      )
      .get(reId, routineId) || null
  );
}

// Met à jour les paramètres modifiables d'un routine_exercise (pas la position ni l'exercise_id).
// `p` est l'ensemble complet déjà fusionné (existant + modifications) et validé.
function updateRoutineExercise(db, reId, p) {
  db.prepare(
    `UPDATE routine_exercises
       SET n_series = @n_series, rep_min = @rep_min, rep_max = @rep_max, rir_cible = @rir_cible,
           increment = @increment, goal = @goal, rest_seconds = @rest_seconds
     WHERE id = @id`
  ).run({
    id: reId,
    n_series: p.n_series,
    rep_min: p.rep_min,
    rep_max: p.rep_max,
    rir_cible: p.rir_cible,
    increment: p.increment,
    goal: p.goal,
    rest_seconds: p.rest_seconds ?? null,
  });
}

// Retire un exercice. On ne recompacte pas les positions restantes : un trou (1,2,4) s'ordonne
// aussi bien et MAX+1 reste correct pour le prochain ajout (cf plan, trous tolérés).
function deleteRoutineExercise(db, reId) {
  db.prepare("DELETE FROM routine_exercises WHERE id = ?").run(reId);
}

// Réordonne : la route a validé que `order` est exactement l'ensemble des ids de la routine.
// On réassigne des positions contiguës 1..n dans l'ordre fourni, en une transaction.
function reorderRoutineExercises(db, routineId, order) {
  db.transaction((ids) => {
    const upd = db.prepare("UPDATE routine_exercises SET position = ? WHERE id = ? AND routine_id = ?");
    ids.forEach((id, i) => upd.run(i + 1, id, routineId));
  })(order);
}

// Validation pure (sans base) des paramètres d'un routine_exercise, une fois fusionnés avec les
// défauts (POST) ou l'existant (PATCH). Retourne un message d'erreur FR ou null si tout est valide.
// Exportée pour être testable sans monter Express (la route l'appelle telle quelle).
function validateParams(p) {
  const isInt = (v) => Number.isInteger(v);
  if (!isInt(p.n_series) || p.n_series < 1) return "n_series doit être un entier ≥ 1";
  if (!isInt(p.rep_min) || p.rep_min < 1) return "rep_min doit être un entier ≥ 1";
  if (!isInt(p.rep_max) || p.rep_max < 1) return "rep_max doit être un entier ≥ 1";
  if (p.rep_min > p.rep_max) return "rep_min ne peut pas dépasser rep_max";
  if (!isInt(p.rir_cible) || p.rir_cible < 0) return "rir_cible doit être un entier ≥ 0";
  if (!Number.isFinite(p.increment) || p.increment <= 0) return "increment doit être un nombre > 0";
  if (p.goal !== "hypertrophy" && p.goal !== "strength")
    return "goal doit valoir 'hypertrophy' ou 'strength'";
  if (p.rest_seconds !== null && p.rest_seconds !== undefined) {
    if (!isInt(p.rest_seconds) || p.rest_seconds < 0)
      return "rest_seconds doit être un entier ≥ 0 ou absent";
  }
  return null;
}

module.exports = {
  DEFAULT_GOAL,
  getOwnedRoutine,
  listRoutines,
  createRoutine,
  renameRoutine,
  countExercises,
  deleteRoutine,
  getRoutineExercises,
  getRoutineDetail,
  getRoutineExerciseById,
  getRoutineExerciseIds,
  exerciseExists,
  getUserDefaults,
  addRoutineExercise,
  getRoutineExerciseInRoutine,
  updateRoutineExercise,
  deleteRoutineExercise,
  reorderRoutineExercises,
  validateParams,
};
