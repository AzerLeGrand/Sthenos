// Couche d'appels API centralisée (docs/frontend.md §6) : un seul module encapsule fetch,
// la gestion d'erreurs, le cookie de session et la base URL. Aucun fetch dispersé ailleurs.
// C'est aussi le point d'insertion du hors-ligne (niveau 2, §4) : les écritures de séance basculent
// vers une file locale en cas d'échec réseau, les lectures nécessaires au logging ont un cache.
import { idbStore } from "./idb-store.js";
import { createSync } from "./sync.js";
import { offlineState } from "./offline-state.js";

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

// Rejoue une entrée de file vers le réseau (envoi direct ET vidage de file passent par ici : source
// unique du mapping type→endpoint). Le payload porte l'id ressource CLIENT, rejoué tel quel.
function networkSend(entry) {
  const p = entry.payload;
  switch (entry.type) {
    case "session:create":
      return request("/api/sessions", { method: "POST", body: p.session });
    case "session:patch":
      return request("/api/sessions/" + p.id, { method: "PATCH", body: { ended_at: p.ended_at } });
    case "set:add":
      return request(`/api/sessions/${p.sessionId}/sets`, { method: "POST", body: p.set });
    default:
      // Type inconnu (ne devrait pas arriver) : status 4xx → dead-letter, pas de boucle.
      return Promise.reject(new ApiError(400, "type de file inconnu : " + entry.type));
  }
}

// Instance de synchro (file + état réactif). Aucun effet de bord à l'import : les écouteurs et la
// reprise de la file persistée démarrent à initSync(), appelé une fois par App au montage.
const sync = createSync({ store: idbStore, send: networkSend, offlineState });

// À appeler une fois au démarrage de l'app connectée : reprend la file persistée, écoute la
// connectivité, lance un premier vidage si nécessaire. Ne casse pas l'app si IndexedDB est indispo.
export async function initSync() {
  try {
    await sync.init();
  } catch (err) {
    console.error("initSync : file hors-ligne indisponible :", err.message);
    return; // le mode en ligne reste pleinement fonctionnel sans la file
  }
  if (typeof window !== "undefined") sync.startConnectivity(window);
  if (sync.queue.size() > 0 && (typeof navigator === "undefined" || navigator.onLine)) {
    sync.queue.flush().catch(() => {});
  }
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
  // Cache read-through : la routine reste consultable hors-ligne une fois chargée (§4, §7).
  getRoutine: async (id) => {
    try {
      const data = await request("/api/routines/" + id);
      idbStore.putCache("routine:" + id, data).catch(() => {}); // cache best-effort, n'échoue pas la lecture
      return data;
    } catch (err) {
      if (err.status === 0) {
        const cached = await idbStore.getCache("routine:" + id);
        if (cached) return cached;
      }
      throw err;
    }
  },
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

  // Suggestion DDP d'un exercice de routine (une entrée par set_number). Consommée en mode séance.
  getSuggestion: (routineId, reId) =>
    request(`/api/routines/${routineId}/exercises/${reId}/suggestion`),

  // Séances et séries loggées. Id générés côté client (UUID), écriture idempotente (data-model.md §1).
  // Les écritures basculent vers la file locale en cas d'échec réseau (ou hors-ligne) et renvoient un
  // résultat « en attente » : les composants n'ont pas à distinguer synchro immédiate ou différée.
  createSession: (session) =>
    sync.queuedWrite("session:create", { session }, { pending: true, id: session.id }),
  patchSession: (id, ended_at) =>
    sync.queuedWrite("session:patch", { id, ended_at }, { pending: true, id }),
  addSet: (sessionId, set) =>
    sync.queuedWrite("set:add", { sessionId, set }, { pending: true, id: set.id }),

  // Lecture d'une séance : hors-ligne, on synthétise les séries en attente dans la file (reprise
  // après reload sans réseau, et pas de re-log — évite les doublons faute d'unicité serveur).
  getSession: async (id) => {
    try {
      return await request("/api/sessions/" + id);
    } catch (err) {
      if (err.status === 0) {
        await sync.ready; // attend le chargement de la file avant d'en lire les séries (anti-course)
        return {
          id,
          routine_id: null,
          started_at: null,
          ended_at: null,
          status: "in_progress",
          sets: sync.queue.pendingSetsFor(id),
        };
      }
      throw err;
    }
  },
};
