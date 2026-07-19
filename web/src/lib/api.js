// Couche d'appels API centralisée (docs/frontend.md §6) : un seul module encapsule fetch,
// la gestion d'erreurs, le cookie de session et la base URL. Aucun fetch dispersé ailleurs.

// Base URL configurable (rien en dur). Vide = même origine : en dev le proxy Vite renvoie
// vers Express, en prod nginx/Express servent le tout. Surchargeable via VITE_API_BASE.
const BASE = import.meta.env.VITE_API_BASE ?? "";

// Erreur typée : porte le code HTTP pour que l'appelant distingue 400 / 401 / 500 / réseau (0).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Callback déclenché sur 401 inattendu (session expirée en cours d'usage). Défini par stores.js
// pour ramener au login sans que chaque écran ait à gérer ce cas.
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Sérialise un objet de filtres en query string, en ignorant les valeurs vides.
function queryString(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") u.set(k, v);
  }
  const s = u.toString();
  return s ? "?" + s : "";
}

// Requête générique. `allow401` empêche le déclenchement du handler global quand un 401 est
// attendu (vérification de session, mauvais identifiants au login).
async function request(path, { method = "GET", body, allow401 = false } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: "include", // cookie de session httpOnly transmis
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Panne réseau (hors-ligne, serveur injoignable) : pas de code HTTP → status 0.
    throw new ApiError(0, "Réseau indisponible");
  }

  if (res.status === 401 && !allow401 && onUnauthorized) onUnauthorized();

  // Réponse potentiellement vide (logout) : parse défensif.
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null; // réponse non-JSON inattendue : on ne casse pas
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || "Erreur serveur");
  }
  return data;
}

export const api = {
  // Auth. me() et login() tolèrent le 401 (respectivement « pas connecté » et « identifiants faux »).
  me: () => request("/api/auth/me", { allow401: true }),
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", body: { username, password }, allow401: true }),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  // Catalogue d'exercices.
  listExercises: (params) => request("/api/exercises" + queryString(params)),
  exercisesMeta: () => request("/api/exercises/meta"),
  exercise: (id) => request("/api/exercises/" + encodeURIComponent(id)),

  // Routines (mode construction). Le serveur applique les défauts user_settings aux paramètres
  // d'exercice omis à l'ajout ; les réponses complètes (détail, reorder, delete d'exercice) sont
  // renvoyées par l'API pour repartir d'un état confirmé côté serveur.
  listRoutines: () => request("/api/routines"),
  createRoutine: (name) => request("/api/routines", { method: "POST", body: { name } }),
  getRoutine: (id) => request("/api/routines/" + id),
  updateRoutine: (id, name) => request("/api/routines/" + id, { method: "PATCH", body: { name } }),
  deleteRoutine: (id) => request("/api/routines/" + id, { method: "DELETE" }),
  addExerciseToRoutine: (id, params) =>
    request(`/api/routines/${id}/exercises`, { method: "POST", body: params }),
  updateRoutineExercise: (id, reId, params) =>
    request(`/api/routines/${id}/exercises/${reId}`, { method: "PATCH", body: params }),
  removeRoutineExercise: (id, reId) =>
    request(`/api/routines/${id}/exercises/${reId}`, { method: "DELETE" }),
  reorderRoutineExercises: (id, order) =>
    request(`/api/routines/${id}/exercises/reorder`, { method: "POST", body: { order } }),
};
