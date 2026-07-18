// Routes du catalogue d'exercices. Couche routes : validation des paramètres, codes de réponse.
// La logique SQL (filtres, pagination) vit dans server/services/exercises.js.
// Toutes ces routes sont protégées par requireAuth, appliqué au montage (voir index.js).

const express = require("express");

const { listExercises, getExerciseById, getMeta } = require("../services/exercises");

// Parse un entier positif depuis une query string. Retourne le nombre, ou null si absent,
// ou undefined si présent mais invalide (non entier ou < 1) — pour distinguer « défaut » d'« erreur ».
function parsePositiveInt(raw) {
  if (raw === undefined) return null; // absent → l'appelant applique le défaut
  if (!/^\d+$/.test(raw)) return undefined; // pas un entier → invalide
  const n = parseInt(raw, 10);
  return n >= 1 ? n : undefined; // 0 ou négatif → invalide
}

// Fabrique le routeur en recevant la base et la config de pagination par injection.
function exercisesRouter(db, pagination) {
  const router = express.Router();

  // GET /api/exercises — liste paginée + recherche + filtres.
  router.get("/", (req, res) => {
    // Pagination : valeurs par défaut depuis config ; rejet explicite si fournies mais invalides.
    const page = parsePositiveInt(req.query.page);
    const limitRaw = parsePositiveInt(req.query.limit);
    if (page === undefined || limitRaw === undefined) {
      return res.status(400).json({ error: "paramètre de pagination invalide" });
    }
    const effectivePage = page ?? 1;
    // limit : défaut si absent, borné au plafond configuré si trop grand.
    const effectiveLimit = Math.min(limitRaw ?? pagination.default_limit, pagination.max_limit);

    // Filtres : chaînes optionnelles. Une chaîne vide équivaut à « pas de filtre ».
    const q = (req.query.q || "").trim() || undefined;
    const category = (req.query.category || "").trim() || undefined;
    const equipment = (req.query.equipment || "").trim() || undefined;

    try {
      const result = listExercises(db, {
        q,
        category,
        equipment,
        page: effectivePage,
        limit: effectiveLimit,
      });
      return res.json(result);
    } catch (err) {
      console.error("exercises : liste échouée :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }
  });

  // GET /api/exercises/meta — valeurs distinctes de category/equipment.
  // Déclaré AVANT /:id pour ne pas être capturé comme un id.
  router.get("/meta", (req, res) => {
    try {
      return res.json(getMeta(db));
    } catch (err) {
      console.error("exercises : meta échouée :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }
  });

  // GET /api/exercises/:id — détail complet.
  router.get("/:id", (req, res) => {
    try {
      const exercise = getExerciseById(db, req.params.id);
      if (!exercise) return res.status(404).json({ error: "exercice introuvable" });
      return res.json(exercise);
    } catch (err) {
      console.error("exercises : détail échoué :", err.message);
      return res.status(500).json({ error: "erreur interne" });
    }
  });

  return router;
}

module.exports = { exercisesRouter };
