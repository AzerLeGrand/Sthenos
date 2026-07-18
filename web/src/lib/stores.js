// Stores Svelte (docs/frontend.md §6) : état applicatif partagé. Pas de lib d'état externe,
// inutile à cette échelle. Navigation par stores plutôt qu'un router (5 écrans).

import { writable } from "svelte/store";
import { api, setUnauthorizedHandler } from "./api.js";

export const session = writable(null); // { id, username } | null
export const sessionStatus = writable("loading"); // "loading" | "authed" | "anon" | "error"
export const activeTab = writable("training"); // "training" | "progression" | "health"
export const detailExerciseId = writable(null); // id d'exercice ouvert en overlay, ou null
export const settingsOpen = writable(false); // overlay Réglages ouvert

// 401 inattendu (session expirée pendant l'usage) : on ramène au login proprement.
setUnauthorizedHandler(() => {
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
    sessionStatus.set("authed");
  } catch (err) {
    if (err.status === 401) sessionStatus.set("anon"); // pas connecté : cas normal
    else sessionStatus.set("error"); // réseau / serveur : écran avec réessai
  }
}

// Connexion réussie : on bascule dans l'application.
export function onLoggedIn(user) {
  session.set(user);
  sessionStatus.set("authed");
}

// Déconnexion : best-effort côté serveur, mais on déconnecte côté client quoi qu'il arrive.
export async function doLogout() {
  try {
    await api.logout();
  } catch {
    // Échec réseau du logout : on déconnecte quand même localement.
  }
  session.set(null);
  activeTab.set("training");
  settingsOpen.set(false);
  detailExerciseId.set(null);
  sessionStatus.set("anon");
}
