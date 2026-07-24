<script>
  // Bandeau discret d'état de synchronisation (docs/frontend.md §4). Lit `offlineState` DIRECTEMENT
  // (`$offlineState`) — jamais à travers une fonction masquant la dépendance (note §6). Ne bloque
  // pas la saisie : simple barre fine sous l'en-tête. Visible seulement s'il y a quelque chose à
  // signaler (hors-ligne, ou des écritures en attente de synchro).
  import { offlineState } from "../lib/offline-state.js";

  $: ({ online, pending } = $offlineState);
  $: show = !online || pending > 0;
</script>

{#if show}
  <div
    class="fixed inset-x-0 z-20 border-b border-neutral-800 px-4 py-1.5 text-center text-xs font-medium
      {online ? 'bg-amber-950/70 text-amber-300' : 'bg-neutral-800 text-neutral-300'}"
    style="top: calc(env(safe-area-inset-top) + 3rem);"
    role="status"
  >
    {#if !online}
      Hors-ligne{#if pending > 0} · {pending} en attente{/if}
    {:else}
      Synchronisation · {pending} en attente
    {/if}
  </div>
{/if}
