<script>
  // Écran Réglages en overlay (ouvert depuis l'en-tête, docs/frontend.md §3.4). Contient le profil
  // actif, la déconnexion et la section Santé (jeton d'ingestion + guide d'installation iOS).
  // Apparence et défauts d'entraînement viendront quand les briques backend existeront.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { session, settingsOpen, doLogout } from "../lib/stores.js";

  let loggingOut = false;

  // --- Jeton d'ingestion Apple Santé ---
  // Le guide iOS est ici et pas dans l'onglet Santé : il a besoin du jeton et de l'URL d'ingestion,
  // qui vivent sur cet écran. Un seul endroit à ouvrir pour configurer le pont.
  let token = null; // jeton courant, null tant qu'aucun n'a été généré
  let ingestUrl = ""; // construite par le serveur (base_url + ingest_path), jamais devinée ici
  let tokenStatus = "loading"; // loading | error | ready
  let regenerating = false;
  let confirming = false; // deuxième clic exigé avant d'invalider un jeton existant
  let revealed = false; // le jeton reste masqué par défaut (c'est un secret)
  let copied = false;

  async function loadToken() {
    tokenStatus = "loading";
    try {
      const data = await api.healthToken();
      token = data.health_ingest_token;
      ingestUrl = data.ingest_url;
      tokenStatus = "ready";
    } catch {
      tokenStatus = "error";
    }
  }

  async function regenerate() {
    // Un jeton existant est en service dans une automatisation : on demande confirmation avant
    // de le casser. La première génération, elle, ne détruit rien.
    if (token && !confirming) {
      confirming = true;
      return;
    }
    confirming = false;
    regenerating = true;
    try {
      const data = await api.regenerateHealthToken();
      token = data.health_ingest_token;
      ingestUrl = data.ingest_url;
      revealed = true; // affiché d'emblée : c'est le moment où l'utilisateur doit le recopier
      tokenStatus = "ready";
    } catch {
      tokenStatus = "error";
    } finally {
      regenerating = false;
    }
  }

  // Copie best-effort : l'API presse-papiers exige HTTPS et peut être refusée. En cas d'échec, le
  // jeton reste sélectionnable à la main, on n'affiche donc pas d'erreur bloquante.
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      revealed = true; // au moins le rendre visible pour une sélection manuelle
    }
  }

  onMount(loadToken);

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

    <!-- Section Santé : jeton d'ingestion propre à l'utilisateur (docs/health-integration.md §3). -->
    <section class="mb-6">
      <h3 class="mb-2 text-sm font-medium uppercase tracking-wide text-neutral-500">Santé</h3>
      <div class="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
        {#if tokenStatus === "loading"}
          <p class="py-2 text-sm text-neutral-400"><span class="animate-pulse">Chargement…</span></p>
        {:else if tokenStatus === "error"}
          <p class="mb-2 text-sm text-neutral-300">Chargement du jeton impossible.</p>
          <button
            class="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 active:bg-neutral-700"
            on:click={loadToken}
          >
            Réessayer
          </button>
        {:else}
          <p class="mb-1 text-sm text-neutral-300">Jeton d'ingestion Apple Santé</p>

          {#if token}
            <!-- Secret : masqué par défaut, révélé à la demande. -->
            <div class="mb-2 flex items-center gap-2">
              <code class="flex-1 break-all rounded bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300">
                {revealed ? token : "•".repeat(32)}
              </code>
              <button
                class="shrink-0 rounded px-2 py-1 text-xs text-neutral-400 active:text-neutral-100"
                on:click={() => (revealed = !revealed)}
              >
                {revealed ? "Masquer" : "Afficher"}
              </button>
            </div>
            <button
              class="mb-3 w-full rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 active:bg-neutral-700"
              on:click={() => copy(token)}
            >
              {copied ? "Copié" : "Copier le jeton"}
            </button>
          {:else}
            <p class="mb-3 text-xs text-neutral-500">
              Aucun jeton pour l'instant. Génère-en un pour configurer Health Auto Export.
            </p>
          {/if}

          {#if confirming}
            <p class="mb-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              Régénérer invalide immédiatement le jeton actuel. L'automatisation Health Auto Export
              déjà configurée cessera d'envoyer des données jusqu'à ce que tu y colles le nouveau
              jeton. Confirmer ?
            </p>
          {/if}
          <div class="flex gap-2">
            <button
              class="flex-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-100 active:bg-neutral-800 disabled:opacity-50"
              on:click={regenerate}
              disabled={regenerating}
            >
              {#if regenerating}
                Génération…
              {:else if !token}
                Générer
              {:else if confirming}
                Oui, régénérer
              {:else}
                Régénérer
              {/if}
            </button>
            {#if confirming}
              <button
                class="rounded-lg px-3 py-1.5 text-sm text-neutral-400 active:text-neutral-100"
                on:click={() => (confirming = false)}
              >
                Annuler
              </button>
            {/if}
          </div>

          <!-- Guide d'installation, texte statique (docs/health-integration.md §6). L'URL vient du
               serveur : le front ne connaît pas l'URL publique de déploiement. -->
          <details class="mt-4 border-t border-neutral-800 pt-3">
            <summary class="cursor-pointer text-sm text-neutral-400">
              Configurer Health Auto Export
            </summary>
            <div class="mt-2 space-y-2 text-xs leading-relaxed text-neutral-400">
              <p>
                Une PWA n'a aucun accès à Apple Santé : c'est l'app iOS <strong>Health Auto Export</strong>
                (version premium, nécessaire aux automatisations) qui pousse les données ici.
                À faire une fois, sur chaque iPhone.
              </p>
              <ol class="list-decimal space-y-1 pl-4">
                <li>Installe Health Auto Export depuis l'App Store et autorise-la à lire Apple Santé.</li>
                <li>
                  Onglet <em>Automations</em> → <em>Add Automation</em> → type <em>REST API</em>.
                </li>
                <li>
                  URL : <code class="break-all rounded bg-neutral-950 px-1 py-0.5 text-neutral-300">{ingestUrl}</code>
                  {#if ingestUrl}
                    <button
                      class="ml-1 rounded px-1 text-neutral-500 active:text-neutral-100"
                      on:click={() => copy(ingestUrl)}
                    >
                      copier
                    </button>
                  {/if}
                </li>
                <li>Méthode <em>POST</em>, format <em>JSON</em>.</li>
                <li>
                  En-tête (<em>Header</em>) :
                  <code class="rounded bg-neutral-950 px-1 py-0.5 text-neutral-300">Authorization</code>
                  avec pour valeur
                  <code class="rounded bg-neutral-950 px-1 py-0.5 text-neutral-300">Bearer &lt;ton jeton&gt;</code>.
                  Jamais dans l'URL : les paramètres d'URL finissent dans les journaux du serveur.
                </li>
                <li>
                  Sélectionne les métriques : poids, fréquence cardiaque au repos, variabilité
                  cardiaque, VO2 max, récupération cardiaque, pas, énergie active, sommeil.
                </li>
                <li>
                  Agrégation <strong>quotidienne</strong> et planification une fois par jour.
                  L'agrégation par heure n'est pas exploitée : chaque mesure est stockée par jour.
                </li>
              </ol>
              <p>
                <strong>Secours.</strong> iOS interdit l'accès aux données santé quand l'iPhone est
                verrouillé : l'automatisation ne part que pendant une période de déverrouillage. Si
                une journée manque, déclenche l'export à la main depuis le widget « sync » de Health
                Auto Export, iPhone déverrouillé. Aucune app web ne peut le faire à ta place.
              </p>
              <p>
                <strong>Raccourci « un seul bouton ».</strong> Pour tout faire d'un tap, crée un
                Raccourci iOS (app <em>Raccourcis</em>) qui enchaîne deux actions :
              </p>
              <ol class="list-decimal space-y-1 pl-4">
                <li>
                  <em>Exécuter l'automatisation</em> de sync Health Auto Export (pousse les données
                  du jour vers le serveur). C'est l'étape qui exige l'iPhone déverrouillé.
                </li>
                <li>
                  Une fois posé sur l'écran d'accueil, ce Raccourci force la synchro à la demande ;
                  l'analyse se recalcule ensuite au prochain matin, ou immédiatement via le bouton
                  « Lancer l'analyse maintenant » de l'onglet Santé.
                </li>
              </ol>
            </div>
          </details>
        {/if}
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
      Apparence et défauts d'entraînement : à venir.
    </p>
  </div>
</div>
