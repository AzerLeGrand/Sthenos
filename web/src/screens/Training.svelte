<script>
  // Onglet Entraînement. À terme : construction de routines et logging en séance (phase 3).
  // Pour l'instant, il héberge le catalogue d'exercices comme sélecteur autonome — le composant
  // sera rebranché comme sous-écran de « ajouter un exercice » quand les routines existeront.
  import ExerciseCatalog from "./ExerciseCatalog.svelte";
</script>

<h2 class="mb-2 text-xl font-semibold">Entraînement</h2>
<p class="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
  La construction de routines et le logging en séance arrivent en phase 3. En attendant, parcours
  le catalogue d'exercices.
</p>

<ExerciseCatalog />
