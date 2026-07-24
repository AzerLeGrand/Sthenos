<script>
  // Onglet Entraînement — mode construction ET mode séance (docs/frontend.md §3.1).
  // Navigation à trois niveaux par état LOCAL : liste ↔ édition ↔ séance. Précédence séance > édition.
  // La séance en cours est PERSISTÉE (localStorage) pour survivre à un rechargement de page — y compris
  // hors-ligne (§4/§6) : au retour, on rouvre directement SessionRunner sur la même séance, dont les
  // séries déjà loguées (en file) réapparaissent « Loggée ». Effacée à la clôture.
  import { onMount } from "svelte";
  import RoutineList from "./RoutineList.svelte";
  import RoutineEditor from "./RoutineEditor.svelte";
  import SessionRunner from "./SessionRunner.svelte";

  const RUNNING_KEY = "sthenos.runningSession";

  let editingRoutineId = null; // niveau édition
  let runningSession = null; // { sessionId, routineId } — niveau séance

  onMount(() => {
    // Reprise d'une séance non clôturée après un rechargement.
    try {
      const raw = localStorage.getItem(RUNNING_KEY);
      if (raw) runningSession = JSON.parse(raw);
    } catch {
      /* localStorage indisponible : pas de reprise, sans casser l'app */
    }
  });

  function startRun(sessionId) {
    runningSession = { sessionId, routineId: editingRoutineId };
    try {
      localStorage.setItem(RUNNING_KEY, JSON.stringify(runningSession));
    } catch {
      /* pas de persistance : la séance reste utilisable, mais non reprise après reload */
    }
  }

  function finishRun() {
    runningSession = null;
    editingRoutineId = null; // retour à l'accueil de l'onglet (liste)
    try {
      localStorage.removeItem(RUNNING_KEY);
    } catch {
      /* rien à faire */
    }
  }
</script>

{#if runningSession}
  <SessionRunner
    sessionId={runningSession.sessionId}
    routineId={runningSession.routineId}
    onFinish={finishRun}
  />
{:else if editingRoutineId === null}
  <RoutineList onOpen={(id) => (editingRoutineId = id)} />
{:else}
  <RoutineEditor
    routineId={editingRoutineId}
    onBack={() => (editingRoutineId = null)}
    onDeleted={() => (editingRoutineId = null)}
    onStartSession={startRun}
  />
{/if}
