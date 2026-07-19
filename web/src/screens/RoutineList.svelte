<script>
  // Niveau 1 du mode construction (docs/frontend.md §3.1) : liste des routines de l'utilisateur
  // (nom + nombre d'exercices), création d'une routine. Après création, on bascule directement dans
  // l'édition de la routine créée (enchaîner sur l'ajout d'exercices) via le callback onOpen.
  import { onMount } from "svelte";
  import { api, ApiError } from "../lib/api.js";
  import AsyncState from "../components/AsyncState.svelte";

  export let onOpen; // (routineId) => void — ouvre l'éditeur de cette routine

  let routines = [];
  let status = "loading"; // loading | error | empty | ready

  let creating = false; // formulaire de création ouvert
  let newName = "";
  let saving = false;
  let createError = null;

  async function load() {
    status = "loading";
    try {
      routines = await api.listRoutines();
      status = routines.length ? "ready" : "empty";
    } catch {
      status = "error";
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) {
      createError = "Donne un nom à la routine.";
      return;
    }
    saving = true;
    createError = null;
    try {
      const routine = await api.createRoutine(name);
      onOpen(routine.id); // enchaîne sur l'édition
    } catch (err) {
      createError = err instanceof ApiError ? err.message : "Création impossible.";
      saving = false;
    }
  }

  onMount(load);
</script>

<div class="mb-4 flex items-center justify-between">
  <h2 class="text-xl font-semibold">Mes routines</h2>
  {#if !creating}
    <button
      class="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 active:bg-neutral-300"
      on:click={() => { creating = true; newName = ""; createError = null; }}
    >
      + Créer
    </button>
  {/if}
</div>

<!-- Formulaire de création inline -->
{#if creating}
  <div class="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-neutral-400">Nom de la routine</span>
      <input
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
        type="text" placeholder="ex. Push" bind:value={newName} disabled={saving}
        on:keydown={(e) => e.key === "Enter" && create()}
      />
    </label>
    {#if createError}
      <p class="mt-2 text-sm text-red-300">{createError}</p>
    {/if}
    <div class="mt-3 flex gap-3">
      <button
        class="flex-1 rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50"
        on:click={() => (creating = false)} disabled={saving}
      >
        Annuler
      </button>
      <button
        class="flex-1 rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-900 active:bg-neutral-300 disabled:opacity-50"
        on:click={create} disabled={saving}
      >
        {saving ? "Création…" : "Créer"}
      </button>
    </div>
  </div>
{/if}

<AsyncState {status} errorMessage="Chargement des routines impossible." onRetry={load}>
  <svelte:fragment slot="empty">
    <div class="py-16 text-center text-neutral-500">
      <p>Aucune routine pour l'instant.</p>
      <p class="mt-1 text-sm">Crée ta première routine pour commencer à construire tes séances.</p>
    </div>
  </svelte:fragment>

  <ul class="flex flex-col gap-2">
    {#each routines as r (r.id)}
      <li>
        <button
          class="flex w-full items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-left active:bg-neutral-800"
          on:click={() => onOpen(r.id)}
        >
          <span class="min-w-0 truncate font-medium text-neutral-100">{r.name}</span>
          <span class="ml-3 flex-none text-sm text-neutral-500">
            {r.exercise_count} exercice{r.exercise_count > 1 ? "s" : ""}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</AsyncState>
