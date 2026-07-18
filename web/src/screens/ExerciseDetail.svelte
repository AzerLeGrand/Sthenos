<script>
  // Détail d'un exercice en overlay modal (par-dessus le catalogue, contexte de sélection
  // préservé en fond). C'est ICI qu'on charge le GIF animé — jamais dans la liste (docs/frontend.md §8).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { categoryLabel, equipmentLabel } from "../lib/labels.js";
  import { detailExerciseId } from "../lib/stores.js";
  import AsyncState from "../components/AsyncState.svelte";

  export let id;

  let exercise = null;
  let status = "loading";

  async function load() {
    status = "loading";
    try {
      exercise = await api.exercise(id);
      status = "ready";
    } catch {
      status = "error";
    }
  }

  function close() {
    detailExerciseId.set(null);
  }

  onMount(load);
</script>

<!-- Fond assombri : clic hors carte = fermeture -->
<div
  class="fixed inset-0 z-30 flex items-end justify-center bg-black/70 sm:items-center"
  on:click|self={close}
  role="presentation"
>
  <div
    class="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <div class="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <span class="text-sm font-medium text-neutral-400">Détail de l'exercice</span>
      <button
        class="rounded-full px-2 text-xl text-neutral-400 active:text-neutral-100"
        aria-label="Fermer"
        on:click={close}
      >
        ✕
      </button>
    </div>

    <div class="overflow-y-auto p-4">
      <AsyncState {status} errorMessage="Impossible de charger cet exercice." onRetry={load}>
        {#if exercise}
          <!-- GIF animé, chargé uniquement à l'ouverture du détail -->
          <img
            class="mb-4 w-full rounded-lg bg-neutral-800"
            src={`/${exercise.gif_url}`}
            alt={exercise.name}
          />

          <h2 class="text-lg font-semibold text-neutral-100">{exercise.name}</h2>
          <p class="mt-1 text-sm text-neutral-400">
            {categoryLabel(exercise.category)} · {equipmentLabel(exercise.equipment)}
          </p>

          <!-- Contenu du dataset : reste en anglais (docs/frontend.md §7) -->
          {#if exercise.target}
            <p class="mt-3 text-sm"><span class="text-neutral-500">Target :</span> {exercise.target}</p>
          {/if}
          {#if exercise.muscle_group}
            <p class="text-sm"><span class="text-neutral-500">Muscle group :</span> {exercise.muscle_group}</p>
          {/if}
          {#if exercise.secondary_muscles && exercise.secondary_muscles.length}
            <p class="text-sm">
              <span class="text-neutral-500">Secondary :</span> {exercise.secondary_muscles.join(", ")}
            </p>
          {/if}

          {#if exercise.instructions_en}
            <p class="mt-3 whitespace-pre-line text-sm leading-relaxed text-neutral-300">
              {exercise.instructions_en}
            </p>
          {/if}
        {/if}
      </AsyncState>
    </div>
  </div>
</div>
