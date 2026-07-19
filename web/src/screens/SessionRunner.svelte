<script>
  // Mode séance en ligne (docs/frontend.md §3.1). Parcourt les exercices de la routine dans l'ordre,
  // affiche la suggestion DDP par série (motif traduit) et logge chaque série immédiatement (POST).
  // Pas de hors-ligne ici, mais l'écriture passe par lib/api.js avec des id clients : point d'insertion
  // d'une future file de synchro sans réécrire ce composant.
  import { onMount } from "svelte";
  import { api, ApiError } from "../lib/api.js";
  import AsyncState from "../components/AsyncState.svelte";
  import SetRow from "./SetRow.svelte";

  export let sessionId;
  export let routineId;
  export let onFinish; // () => void — séance clôturée, retour à l'accueil de l'onglet

  let status = "loading"; // loading | error | ready (chargement initial routine + session)
  let routine = null; // { id, name, exercises: [...] } ordonné par position
  let currentIndex = 0;

  // Avancement : source de vérité UI (indépendante du réseau → prête pour le hors-ligne).
  // logged[exercise_id] = tableau des set_number déjà loggés. loggedByKey = valeurs pour la reprise.
  let logged = {};
  let loggedByKey = {};

  // Cache des suggestions par routine_exercise (fetchée une fois par exercice, jamais recalculée
  // pendant la séance). { [reId]: { status, data } }.
  let suggestions = {};

  // Clôture.
  let confirmingFinish = false;
  let finishing = false;
  let finishError = null;

  $: exercises = routine ? routine.exercises : [];
  $: current = exercises[currentIndex] || null;

  const countLogged = (ex) => (logged[ex.exercise_id] || []).length;
  const isComplete = (ex) => countLogged(ex) >= ex.n_series;
  const isStarted = (ex) => countLogged(ex) > 0;
  $: allComplete = exercises.length > 0 && exercises.every(isComplete);

  async function load() {
    status = "loading";
    try {
      const [session, r] = await Promise.all([api.getSession(sessionId), api.getRoutine(routineId)]);
      routine = r;

      // Reconstitue l'avancement depuis les séries déjà loggées (reprise d'une séance en cours).
      const byEx = {};
      const byKey = {};
      for (const s of session.sets) {
        (byEx[s.exercise_id] = byEx[s.exercise_id] || []).push(s.set_number);
        byKey[`${s.exercise_id}:${s.set_number}`] = { reps: s.reps, load: s.load, rir: s.rir };
      }
      logged = byEx;
      loggedByKey = byKey;

      // Démarre sur le premier exercice non terminé (ou le premier si tout est fait).
      const firstTodo = r.exercises.findIndex((ex) => !isComplete(ex));
      currentIndex = firstTodo === -1 ? 0 : firstTodo;

      status = "ready";
      ensureSuggestion();
    } catch {
      status = "error";
    }
  }

  // Charge la suggestion de l'exercice courant si absente du cache. Appelée à chaque navigation.
  async function ensureSuggestion() {
    if (!current) return;
    const reId = current.id;
    if (suggestions[reId] && suggestions[reId].status !== "error") return; // déjà en cache/en cours
    suggestions = { ...suggestions, [reId]: { status: "loading", data: null } };
    try {
      const data = await api.getSuggestion(routineId, reId);
      suggestions = { ...suggestions, [reId]: { status: "ready", data } };
    } catch {
      suggestions = { ...suggestions, [reId]: { status: "error", data: null } };
    }
  }

  $: currentSuggestion = current ? suggestions[current.id] : null;

  function goto(i) {
    if (i < 0 || i >= exercises.length) return;
    currentIndex = i;
    ensureSuggestion();
  }

  // POST d'une série (lié à l'exercice courant). Met à jour l'avancement local au succès ; relance
  // l'erreur pour que SetRow l'affiche inline sans bloquer le reste de l'écran.
  async function logSet(exerciseId, payload) {
    await api.addSet(sessionId, { ...payload, exercise_id: exerciseId });
    const arr = logged[exerciseId] || [];
    logged = { ...logged, [exerciseId]: [...arr, payload.set_number] };
  }

  // Suggestion d'une série donnée (par set_number) pour l'exercice courant, ou null.
  function suggestionFor(sn) {
    const s = currentSuggestion && currentSuggestion.status === "ready" ? currentSuggestion.data : null;
    return s ? s.suggestions.find((x) => x.set_number === sn) || null : null;
  }

  function askFinish() {
    finishError = null;
    if (allComplete) doFinish();
    else confirmingFinish = true;
  }

  async function doFinish() {
    finishing = true;
    finishError = null;
    try {
      await api.patchSession(sessionId, new Date().toISOString());
      onFinish();
    } catch (err) {
      finishError = err instanceof ApiError ? err.message : "Clôture impossible.";
      finishing = false;
      confirmingFinish = false;
    }
  }

  onMount(load);
</script>

<AsyncState {status} errorMessage="Chargement de la séance impossible." onRetry={load}>
  {#if routine && current}
    <!-- Overview : pastilles d'avancement, tap = saut direct -->
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      {#each exercises as ex, i (ex.id)}
        <button
          class="flex h-9 w-9 flex-none items-center justify-center rounded-full border text-sm font-medium
            {i === currentIndex ? 'border-neutral-100 text-neutral-100' : 'border-neutral-700 text-neutral-400'}
            {isComplete(ex) ? 'bg-emerald-900/40' : isStarted(ex) ? 'bg-neutral-800' : ''}"
          on:click={() => goto(i)}
          aria-label={`Exercice ${i + 1}`}
        >
          {isComplete(ex) ? "✓" : i + 1}
        </button>
      {/each}
    </div>

    <!-- En-tête de l'exercice courant -->
    <div class="mb-4 flex items-center gap-3">
      <img class="h-16 w-16 flex-none rounded-lg bg-neutral-800 object-cover" src={`/${current.image}`} alt="" />
      <div class="min-w-0">
        <p class="text-xs text-neutral-500">Exercice {currentIndex + 1}/{exercises.length}</p>
        <p class="truncate text-lg font-semibold text-neutral-100">{current.name}</p>
        <p class="text-xs text-neutral-500">
          {current.n_series} séries · {current.rep_min}-{current.rep_max} reps · RIR {current.rir_cible}{#if current.goal === "strength"} · <span class="text-amber-500/80">Force</span>{/if}
        </p>
      </div>
    </div>

    <!-- État du chargement des suggestions : inline, ne bloque jamais la saisie -->
    {#if currentSuggestion && currentSuggestion.status === "loading"}
      <p class="mb-3 text-sm text-neutral-500">Chargement des suggestions…</p>
    {:else if currentSuggestion && currentSuggestion.status === "error"}
      <div class="mb-3 flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm">
        <span class="text-neutral-400">Suggestions indisponibles.</span>
        <button class="rounded-lg bg-neutral-800 px-3 py-1 text-neutral-100 active:bg-neutral-700" on:click={ensureSuggestion}>Réessayer</button>
      </div>
    {/if}

    <!-- Séries : une ligne par set_number. La clé inclut l'exercice → remontage à chaque changement. -->
    <div class="flex flex-col gap-3">
      {#each Array(current.n_series) as _, k (`${current.id}-${k + 1}`)}
        <SetRow
          setNumber={k + 1}
          suggestion={suggestionFor(k + 1)}
          initial={loggedByKey[`${current.exercise_id}:${k + 1}`] || null}
          submit={(payload) => logSet(current.exercise_id, payload)}
        />
      {/each}
    </div>

    <!-- Navigation entre exercices -->
    <div class="mt-4 flex gap-3">
      <button
        class="flex-1 rounded-lg border border-neutral-700 px-4 py-2.5 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-40"
        on:click={() => goto(currentIndex - 1)} disabled={currentIndex === 0}
      >
        ‹ Précédent
      </button>
      <button
        class="flex-1 rounded-lg border border-neutral-700 px-4 py-2.5 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-40"
        on:click={() => goto(currentIndex + 1)} disabled={currentIndex === exercises.length - 1}
      >
        Suivant ›
      </button>
    </div>

    {#if finishError}
      <p class="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{finishError}</p>
    {/if}

    <!-- Clôture : disponible à tout moment (séance écourtable), confirmée si incomplète -->
    <button
      class="mt-3 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white active:bg-emerald-800 disabled:opacity-50"
      on:click={askFinish} disabled={finishing}
    >
      {finishing ? "Clôture…" : "Terminer la séance"}
    </button>
  {/if}
</AsyncState>

<!-- Confirmation si des exercices ne sont pas terminés -->
{#if confirmingFinish}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation">
    <div class="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p class="text-neutral-100">Des exercices ne sont pas terminés. Terminer la séance quand même ?</p>
      <div class="mt-4 flex gap-3">
        <button class="flex-1 rounded-lg border border-neutral-700 px-4 py-2.5 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50" on:click={() => (confirmingFinish = false)} disabled={finishing}>Continuer</button>
        <button class="flex-1 rounded-lg bg-emerald-700 px-4 py-2.5 font-medium text-white active:bg-emerald-800 disabled:opacity-50" on:click={doFinish} disabled={finishing}>
          {finishing ? "Clôture…" : "Terminer"}
        </button>
      </div>
    </div>
  </div>
{/if}
