<script>
  // Onglet Entraînement — mode construction de routines (docs/frontend.md §3.1).
  // Navigation à deux niveaux par état LOCAL (contenue dans l'onglet, pas de store global) :
  //  - liste des routines (RoutineList) ;
  //  - édition d'une routine (RoutineEditor).
  // Le changement d'onglet démonte ce composant (App.svelte) → retour naturel au niveau liste.
  // Le mode séance (logging) et les suggestions DDP viendront avec le hors-ligne (session suivante).
  import RoutineList from "./RoutineList.svelte";
  import RoutineEditor from "./RoutineEditor.svelte";

  let editingRoutineId = null; // null = niveau liste ; sinon = édition de cette routine
</script>

{#if editingRoutineId === null}
  <RoutineList onOpen={(id) => (editingRoutineId = id)} />
{:else}
  <RoutineEditor
    routineId={editingRoutineId}
    onBack={() => (editingRoutineId = null)}
    onDeleted={() => (editingRoutineId = null)}
  />
{/if}
