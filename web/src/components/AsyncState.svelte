<script>
  // Enveloppe réutilisable des états d'un appel réseau (docs/frontend.md §6) :
  // chargement, erreur avec réessai, vide. Le contenu prêt passe par le slot par défaut ;
  // l'état vide peut être personnalisé via le slot nommé « empty ».
  export let status = "loading"; // "loading" | "error" | "empty" | "ready"
  export let errorMessage = "Une erreur est survenue.";
  export let onRetry = null; // fonction de réessai, ou null si non applicable
</script>

{#if status === "loading"}
  <div class="flex items-center justify-center py-16 text-neutral-400">
    <span class="animate-pulse">Chargement…</span>
  </div>
{:else if status === "error"}
  <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
    <p class="text-neutral-300">{errorMessage}</p>
    {#if onRetry}
      <button
        class="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 active:bg-neutral-700"
        on:click={onRetry}
      >
        Réessayer
      </button>
    {/if}
  </div>
{:else if status === "empty"}
  <slot name="empty">
    <div class="flex items-center justify-center py-16 text-neutral-500">Aucun résultat.</div>
  </slot>
{:else}
  <slot />
{/if}
