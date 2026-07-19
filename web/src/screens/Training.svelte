<script>
  // Onglet Entraînement — mode construction ET mode séance (docs/frontend.md §3.1).
  // Navigation à trois niveaux par état LOCAL (contenue dans l'onglet, pas de store global) :
  //  - liste des routines (RoutineList) ;
  //  - édition d'une routine (RoutineEditor) ;
  //  - séance en cours (SessionRunner).
  // Précédence : séance > édition > liste. Le changement d'onglet démonte ce composant (App.svelte).
  import RoutineList from "./RoutineList.svelte";
  import RoutineEditor from "./RoutineEditor.svelte";
  import SessionRunner from "./SessionRunner.svelte";

  let editingRoutineId = null; // niveau édition
  let runningSession = null; // { sessionId, routineId } — niveau séance
</script>

{#if runningSession}
  <SessionRunner
    sessionId={runningSession.sessionId}
    routineId={runningSession.routineId}
    onFinish={() => { runningSession = null; editingRoutineId = null; }}
  />
{:else if editingRoutineId === null}
  <RoutineList onOpen={(id) => (editingRoutineId = id)} />
{:else}
  <RoutineEditor
    routineId={editingRoutineId}
    onBack={() => (editingRoutineId = null)}
    onDeleted={() => (editingRoutineId = null)}
    onStartSession={(sessionId) => (runningSession = { sessionId, routineId: editingRoutineId })}
  />
{/if}
