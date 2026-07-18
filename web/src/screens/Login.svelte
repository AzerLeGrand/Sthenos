<script>
  // Écran de connexion : formulaire username / mot de passe → POST /api/auth/login.
  // Erreurs affichées clairement (401 identifiants, 400 champs manquants, réseau).
  import { api, ApiError } from "../lib/api.js";
  import { onLoggedIn } from "../lib/stores.js";

  let username = "";
  let password = "";
  let submitting = false;
  let errorMessage = "";

  async function submit() {
    errorMessage = "";
    if (!username || !password) {
      errorMessage = "Identifiant et mot de passe requis.";
      return;
    }
    submitting = true;
    try {
      const user = await api.login(username, password);
      onLoggedIn(user);
    } catch (err) {
      // Messages distincts selon le code, sans révéler quel champ est faux (le serveur unifie déjà).
      if (err instanceof ApiError && err.status === 401) {
        errorMessage = "Identifiants invalides.";
      } else if (err instanceof ApiError && err.status === 400) {
        errorMessage = "Identifiant et mot de passe requis.";
      } else if (err instanceof ApiError && err.status === 0) {
        errorMessage = "Réseau indisponible. Réessayez.";
      } else {
        errorMessage = "Erreur serveur. Réessayez.";
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6">
  <div class="w-full max-w-sm">
    <h1 class="mb-1 text-center text-2xl font-semibold tracking-tight">Sthenos</h1>
    <p class="mb-8 text-center text-sm text-neutral-500">Suivi de musculation et de santé</p>

    <form class="flex flex-col gap-4" on:submit|preventDefault={submit}>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-neutral-400">Identifiant</span>
        <input
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 focus:border-neutral-500"
          type="text"
          autocomplete="username"
          bind:value={username}
          disabled={submitting}
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-neutral-400">Mot de passe</span>
        <input
          class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 focus:border-neutral-500"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={submitting}
        />
      </label>

      {#if errorMessage}
        <p class="text-sm text-red-400" role="alert">{errorMessage}</p>
      {/if}

      <button
        class="mt-2 rounded-lg bg-neutral-100 px-4 py-2.5 font-medium text-neutral-900 active:bg-neutral-300 disabled:opacity-50"
        type="submit"
        disabled={submitting}
      >
        {submitting ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  </div>
</div>
