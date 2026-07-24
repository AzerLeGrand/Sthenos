// Stores Svelte (docs/frontend.md §6) : état applicatif partagé. Pas de lib d'état externe,
// inutile à cette échelle. Navigation par stores plutôt qu'un router (5 écrans).

import { writable } from "svelte/store";
import { api, setUnauthorizedHandler } from "./api.js";

export const session = writable(null); // { id, username } | null
export const sessionStatus = writable("loading"); // "loading" | "authed" | "anon" | "error"
export const activeTab = writable("training"); // "training" | "progression" | "health"
export const detailExerciseId = writable(null); // id d'exercice ouvert en overlay, ou null
export const settingsOpen = writable(false); // overlay Réglages ouvert

// Cache local du profil connecté (id + username, non sensible : le cookie httpOnly reste la seule
// vraie preuve d'identité). Sert à ouvrir l'app HORS-LIGNE : sans réseau on ne peut pas revérifier
// la session au serveur, on repart donc du dernier profil connu. Le serveur reste le gardien : toute
// écriture différée qui synchroniserait sous une session expirée serait rejetée (401) au flush.
const USER_KEY = "sthenos.user";
function cacheUser(u) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch {
    /* stockage indisponible : sans cache, l'ouverture hors-ligne retombera sur l'écran d'erreur */
  }
}
function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function clearCachedUser() {
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* rien à faire */
  }
}

// 401 inattendu (session expirée pendant l'usage) : on ramène au login et on purge le cache profil.
setUnauthorizedHandler(() => {
  clearCachedUser();
  session.set(null);
  sessionStatus.set("anon");
});

// Vérifie la session au démarrage via GET /api/auth/me pour ne pas redemander la connexion
// inutilement (docs/frontend.md §3, gestion de session).
export async function checkSession() {
  sessionStatus.set("loading");
  try {
    const user = await api.me();
    session.set(user);
    cacheUser(user);
    sessionStatus.set("authed");
  } catch (err) {
    if (err.status === 401) {
      clearCachedUser();
      session.set(null);
      sessionStatus.set("anon"); // pas connecté : cas normal
    } else if (err.status === 0) {
      // Réseau injoignable : si on connaît le dernier profil, on ouvre l'app en mode hors-ligne
      // optimiste (permet de reprendre une séance et de vider la file). Sinon écran d'erreur.
      const cached = readCachedUser();
      if (cached) {
        session.set(cached);
        sessionStatus.set("authed");
      } else {
        sessionStatus.set("error");
      }
    } else {
      sessionStatus.set("error"); // serveur joignable mais en erreur : écran avec réessai
    }
  }
}

// Connexion réussie : on bascule dans l'application.
export function onLoggedIn(user) {
  session.set(user);
  cacheUser(user);
  sessionStatus.set("authed");
}

// Déconnexion : best-effort côté serveur, mais on déconnecte côté client quoi qu'il arrive.
export async function doLogout() {
  try {
    await api.logout();
  } catch {
    // Échec réseau du logout : on déconnecte quand même localement.
  }
  clearCachedUser();
  session.set(null);
  activeTab.set("training");
  settingsOpen.set(false);
  detailExerciseId.set(null);
  sessionStatus.set("anon");
}
