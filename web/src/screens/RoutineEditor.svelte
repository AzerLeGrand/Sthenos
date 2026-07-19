<script>
  // Niveau 2 du mode construction (docs/frontend.md §3.1) : édition d'une routine. Liste ordonnée
  // des exercices avec leurs paramètres, ajout via le catalogue en mode sélection, édition/retrait
  // des paramètres, réordonnancement (monter/descendre), renommage et suppression de la routine.
  // Chaque action rejoue l'état depuis la réponse serveur (état confirmé, pas de désynchro).
  import { onMount } from "svelte";
  import { api, ApiError } from "../lib/api.js";
  import AsyncState from "../components/AsyncState.svelte";
  import ExerciseCatalog from "./ExerciseCatalog.svelte";
  import RoutineExerciseForm from "./RoutineExerciseForm.svelte";

  export let routineId;
  export let onBack; // () => void — retour à la liste
  export let onDeleted; // () => void — la routine a été supprimée, retour à la liste
  export let onStartSession; // (sessionId) => void — séance créée, bascule vers SessionRunner

  let routine = null; // { id, name, created_at, exercises: [...] }
  let status = "loading"; // loading | error | ready

  let busy = false; // une action réseau (reorder/remove/rename/delete) est en cours
  let actionError = null; // erreur d'une action, affichée en haut

  // Overlays / modales (état local ; navigation contenue dans l'éditeur).
  let selecting = false; // overlay catalogue (sélection d'un exercice)
  let formMode = null; // null | 'add' | 'edit'
  let formExercise = null; // exercice affiché dans l'en-tête du formulaire
  let formInitial = null; // paramètres existants (edit) ou null (add)
  let editingReId = null; // id du routine_exercise en cours d'édition
  let formSaving = false;
  let formError = null;

  let renaming = false;
  let renameValue = "";
  let renameError = null;

  let confirming = null; // null | { type:'routine' } | { type:'exercise', reId, name }

  let starting = false; // création de séance en cours
  let startError = null;

  const frNum = (n) => String(n).replace(".", ","); // virgule décimale (convention FR)

  async function load() {
    status = "loading";
    try {
      routine = await api.getRoutine(routineId);
      status = "ready";
    } catch {
      status = "error";
    }
  }

  // Résumé d'un exercice pour la ligne (increment/repos consultables dans le formulaire d'édition).
  const summary = (e) => `${e.n_series} séries · ${e.rep_min}-${e.rep_max} reps · RIR ${e.rir_cible}`;

  // --- Ajout d'un exercice ---
  function openCatalog() {
    actionError = null;
    selecting = true;
  }
  function onExerciseChosen(ex) {
    // L'exercice est choisi dans le catalogue : on ferme le catalogue et on ouvre le formulaire.
    selecting = false;
    formMode = "add";
    formExercise = ex;
    formInitial = null;
    editingReId = null;
    formError = null;
  }

  // --- Édition des paramètres d'un exercice déjà présent ---
  function openEdit(e) {
    formMode = "edit";
    formExercise = e;
    formInitial = e;
    editingReId = e.id;
    formError = null;
  }

  function closeForm() {
    formMode = null;
    formExercise = null;
    formInitial = null;
    editingReId = null;
    formError = null;
  }

  async function submitForm(params) {
    formSaving = true;
    formError = null;
    try {
      if (formMode === "add") {
        // Le POST renvoie le routine_exercise créé (enrichi) : on l'ajoute en fin de liste.
        const re = await api.addExerciseToRoutine(routineId, {
          exercise_id: formExercise.id,
          ...params,
        });
        routine.exercises = [...routine.exercises, re];
      } else {
        // Le PATCH renvoie le routine_exercise mis à jour : on remplace l'élément correspondant.
        const re = await api.updateRoutineExercise(routineId, editingReId, params);
        routine.exercises = routine.exercises.map((e) => (e.id === re.id ? re : e));
      }
      closeForm();
    } catch (err) {
      formError = err instanceof ApiError ? err.message : "Enregistrement impossible.";
    } finally {
      formSaving = false;
    }
  }

  // --- Réordonnancement (monter/descendre) ---
  async function move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= routine.exercises.length) return;
    const order = routine.exercises.map((e) => e.id);
    [order[index], order[to]] = [order[to], order[index]];
    busy = true;
    actionError = null;
    try {
      // reorder renvoie le détail complet : on repart de l'état confirmé serveur.
      routine = await api.reorderRoutineExercises(routineId, order);
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : "Réorganisation impossible.";
    } finally {
      busy = false;
    }
  }

  // --- Retrait d'un exercice / suppression de la routine (avec confirmation) ---
  async function confirmYes() {
    busy = true;
    actionError = null;
    const c = confirming;
    try {
      if (c.type === "exercise") {
        // DELETE d'un exercice renvoie le détail complet.
        routine = await api.removeRoutineExercise(routineId, c.reId);
        confirming = null;
      } else {
        await api.deleteRoutine(routineId);
        onDeleted();
      }
    } catch (err) {
      actionError = err instanceof ApiError ? err.message : "Suppression impossible.";
      confirming = null;
    } finally {
      busy = false;
    }
  }

  // --- Renommage ---
  function startRename() {
    renameValue = routine.name;
    renameError = null;
    renaming = true;
  }
  async function saveRename() {
    const name = renameValue.trim();
    if (!name) {
      renameError = "Le nom ne peut pas être vide.";
      return;
    }
    busy = true;
    renameError = null;
    try {
      const updated = await api.updateRoutine(routineId, name);
      routine.name = updated.name;
      renaming = false;
    } catch (err) {
      renameError = err instanceof ApiError ? err.message : "Renommage impossible.";
    } finally {
      busy = false;
    }
  }

  // Démarre une séance : crée la session (id client, idempotent) liée à la routine, puis bascule
  // vers SessionRunner. On ne remet pas `starting` à false en cas de succès : on quitte l'écran.
  async function startSession() {
    starting = true;
    startError = null;
    try {
      const id = crypto.randomUUID();
      await api.createSession({ id, routine_id: routineId, started_at: new Date().toISOString() });
      onStartSession(id);
    } catch (err) {
      startError = err instanceof ApiError ? err.message : "Démarrage impossible.";
      starting = false;
    }
  }

  onMount(load);
</script>

<!-- En-tête : retour + nom (+ renommage) + suppression de la routine -->
<div class="mb-4 flex items-center gap-2">
  <button
    class="flex-none rounded-lg px-2 py-1 text-neutral-400 active:text-neutral-100"
    aria-label="Retour" on:click={onBack}
  >
    ‹ Routines
  </button>
</div>

<AsyncState {status} errorMessage="Chargement de la routine impossible." onRetry={load}>
  {#if routine}
    <!-- Titre + actions routine -->
    {#if renaming}
      <div class="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        <input
          class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
          type="text" bind:value={renameValue} disabled={busy}
          on:keydown={(e) => e.key === "Enter" && saveRename()}
        />
        {#if renameError}<p class="mt-2 text-sm text-red-300">{renameError}</p>{/if}
        <div class="mt-3 flex gap-3">
          <button class="flex-1 rounded-lg border border-neutral-700 px-4 py-2 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50" on:click={() => (renaming = false)} disabled={busy}>Annuler</button>
          <button class="flex-1 rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-900 active:bg-neutral-300 disabled:opacity-50" on:click={saveRename} disabled={busy}>Enregistrer</button>
        </div>
      </div>
    {:else}
      <div class="mb-4 flex items-center justify-between gap-2">
        <h2 class="min-w-0 truncate text-xl font-semibold">{routine.name}</h2>
        <div class="flex flex-none gap-2 text-sm">
          <button class="rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 active:bg-neutral-800" on:click={startRename} disabled={busy}>Renommer</button>
          <button class="rounded-lg border border-red-900/50 px-3 py-1.5 text-red-300 active:bg-red-950/40" on:click={() => (confirming = { type: "routine" })} disabled={busy}>Supprimer</button>
        </div>
      </div>
    {/if}

    {#if actionError}
      <p class="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{actionError}</p>
    {/if}

    <!-- Démarrer une séance à partir de cette routine (désactivé si aucun exercice) -->
    <button
      class="mb-4 w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white active:bg-emerald-800 disabled:opacity-40"
      on:click={startSession}
      disabled={busy || starting || routine.exercises.length === 0}
    >
      {starting ? "Démarrage…" : "Démarrer une séance"}
    </button>
    {#if startError}
      <p class="mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">{startError}</p>
    {/if}

    <!-- Liste ordonnée des exercices -->
    {#if routine.exercises.length === 0}
      <div class="py-12 text-center text-neutral-500">
        <p>Aucun exercice dans cette routine.</p>
        <p class="mt-1 text-sm">Ajoute un mouvement depuis le catalogue.</p>
      </div>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each routine.exercises as e, i (e.id)}
          <li class="rounded-lg border border-neutral-800 bg-neutral-900 p-2">
            <div class="flex items-center gap-3">
              <img class="h-12 w-12 flex-none rounded-md bg-neutral-800 object-cover" src={`/${e.image}`} alt="" loading="lazy" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-neutral-100">{e.name}</p>
                <p class="truncate text-xs text-neutral-500">
                  {summary(e)}{#if e.goal === "strength"} · <span class="text-amber-500/80">Force</span>{/if}
                </p>
              </div>
              <!-- Monter / descendre -->
              <div class="flex flex-none flex-col">
                <button class="px-2 text-neutral-400 active:text-neutral-100 disabled:opacity-30" aria-label="Monter" on:click={() => move(i, -1)} disabled={busy || i === 0}>▲</button>
                <button class="px-2 text-neutral-400 active:text-neutral-100 disabled:opacity-30" aria-label="Descendre" on:click={() => move(i, 1)} disabled={busy || i === routine.exercises.length - 1}>▼</button>
              </div>
            </div>
            <div class="mt-2 flex gap-2 text-sm">
              <button class="flex-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-neutral-300 active:bg-neutral-800 disabled:opacity-50" on:click={() => openEdit(e)} disabled={busy}>Modifier</button>
              <button class="flex-1 rounded-lg border border-red-900/50 px-3 py-1.5 text-red-300 active:bg-red-950/40 disabled:opacity-50" on:click={() => (confirming = { type: "exercise", reId: e.id, name: e.name })} disabled={busy}>Retirer</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Ajouter un exercice -->
    <button
      class="mt-4 w-full rounded-lg border border-dashed border-neutral-700 px-4 py-3 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50"
      on:click={openCatalog} disabled={busy}
    >
      + Ajouter un exercice
    </button>
  {/if}
</AsyncState>

<!-- Overlay catalogue (mode sélection). z-20 : sous le détail (z-30) rendu par App via le store. -->
{#if selecting}
  <div class="fixed inset-0 z-20 flex flex-col bg-neutral-950">
    <header
      class="flex items-center justify-between border-b border-neutral-800 px-4 py-3"
      style="padding-top: calc(env(safe-area-inset-top) + 0.75rem);"
    >
      <span class="text-lg font-semibold">Ajouter un exercice</span>
      <button class="rounded-full px-2 text-xl text-neutral-400 active:text-neutral-100" aria-label="Fermer" on:click={() => (selecting = false)}>✕</button>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      <ExerciseCatalog onSelect={onExerciseChosen} />
    </div>
  </div>
{/if}

<!-- Formulaire des paramètres (ajout ou édition) -->
{#if formMode}
  <RoutineExerciseForm
    mode={formMode}
    exercise={formExercise}
    initial={formInitial}
    saving={formSaving}
    serverError={formError}
    onSubmit={submitForm}
    onCancel={closeForm}
  />
{/if}

<!-- Confirmation de suppression (routine ou exercice) -->
{#if confirming}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" role="presentation">
    <div class="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <p class="text-neutral-100">
        {#if confirming.type === "routine"}
          Supprimer la routine « {routine.name} » et tous ses exercices ?
        {:else}
          Retirer « {confirming.name} » de la routine ?
        {/if}
      </p>
      <div class="mt-4 flex gap-3">
        <button class="flex-1 rounded-lg border border-neutral-700 px-4 py-2.5 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50" on:click={() => (confirming = null)} disabled={busy}>Annuler</button>
        <button class="flex-1 rounded-lg bg-red-600 px-4 py-2.5 font-medium text-white active:bg-red-700 disabled:opacity-50" on:click={confirmYes} disabled={busy}>
          {busy ? "Suppression…" : "Supprimer"}
        </button>
      </div>
    </div>
  </div>
{/if}
