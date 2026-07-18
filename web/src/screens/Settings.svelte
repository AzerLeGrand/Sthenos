<script>
  // Écran Réglages en overlay (ouvert depuis l'en-tête, docs/frontend.md §3.4). Squelette minimal
  // pour cette phase : profil actif + déconnexion. Le reste (jeton santé, défauts d'entraînement,
  // apparence) viendra quand les briques backend correspondantes existeront.
  import { session, settingsOpen, doLogout } from "../lib/stores.js";

  let loggingOut = false;

  async function logout() {
    loggingOut = true;
    await doLogout(); // réinitialise la session → App bascule sur l'écran de connexion
  }

  function close() {
    settingsOpen.set(false);
  }
</script>

<div class="fixed inset-0 z-30 flex flex-col bg-neutral-950">
  <header
    class="flex items-center justify-between border-b border-neutral-800 px-4 py-3"
    style="padding-top: calc(env(safe-area-inset-top) + 0.75rem);"
  >
    <span class="text-lg font-semibold">Réglages</span>
    <button
      class="rounded-full px-2 text-xl text-neutral-400 active:text-neutral-100"
      aria-label="Fermer"
      on:click={close}
    >
      ✕
    </button>
  </header>

  <div class="flex-1 overflow-y-auto p-4">
    <section class="mb-6">
      <h3 class="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">Profil actif</h3>
      <div class="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
        <p class="font-medium text-neutral-100">{$session?.username ?? "—"}</p>
      </div>
    </section>

    <button
      class="w-full rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-2.5 font-medium text-red-300 active:bg-red-950/70 disabled:opacity-50"
      on:click={logout}
      disabled={loggingOut}
    >
      {loggingOut ? "Déconnexion…" : "Se déconnecter"}
    </button>

    <p class="mt-6 text-center text-xs text-neutral-600">
      Jeton santé, apparence et défauts d'entraînement : à venir.
    </p>
  </div>
</div>
