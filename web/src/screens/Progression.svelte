<script>
  // Onglet Progression (docs/frontend.md §3.2) : sélection d'un exercice déjà loggé et d'une période,
  // courbes de charge max et de volume par séance (uPlot), indicateurs de tendance. Tout le calcul
  // est côté serveur ; le front sélectionne, met en forme et affiche.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import AsyncState from "../components/AsyncState.svelte";
  import LineChart from "../components/LineChart.svelte";
  import { PERIODS, toUplotData, frNum, trendLabel } from "../lib/progression-format.js";

  // Liste des exercices loggés (sélecteur).
  let exercises = [];
  let listStatus = "loading"; // loading | error | empty | ready

  // Sélection courante et données associées.
  let selectedId = "";
  let period = "90"; // aligné sur default_period de config.yml ; le serveur reste la source de vérité
  let data = null;
  let dataStatus = "idle"; // idle | loading | error | ready

  async function loadList() {
    listStatus = "loading";
    try {
      exercises = await api.progressionExercises();
      if (exercises.length) {
        listStatus = "ready";
        selectedId = exercises[0].id; // sélectionne le plus récemment travaillé (tri serveur)
        loadData();
      } else {
        listStatus = "empty";
      }
    } catch {
      listStatus = "error";
    }
  }

  async function loadData() {
    if (!selectedId) return;
    dataStatus = "loading";
    try {
      data = await api.progression(selectedId, period);
      dataStatus = "ready";
    } catch {
      dataStatus = "error";
    }
  }

  // Recharge quand l'exercice ou la période change (le calcul reste serveur).
  function onSelectChange() {
    loadData();
  }

  // Séries au format uPlot. Réactif : recalculé à chaque nouvelle `data`.
  $: loadSeries = data ? toUplotData(data.series.max_load) : [[], []];
  $: volumeSeries = data ? toUplotData(data.series.volume) : [[], []];

  // Texte d'un indicateur de tendance (régression / fenêtre glissante).
  function regressionText(t) {
    if (t.regression.classification === "indetermine") return "Indéterminé";
    const s = t.regression.slope;
    return `${trendLabel(t.regression.classification)} (${s >= 0 ? "+" : ""}${frNum(s, 2)} kg/séance)`;
  }
  function rollingText(t) {
    if (!t.rolling.available) return "Indéterminé (pas assez de séances)";
    const p = t.rolling.pct_change;
    return `${trendLabel(t.rolling.classification)} (${p >= 0 ? "+" : ""}${frNum(p, 1)} %) sur ${t.rolling.window} séances`;
  }

  onMount(loadList);
</script>

<h2 class="mb-4 text-xl font-semibold">Progression</h2>

<AsyncState status={listStatus} errorMessage="Chargement des exercices impossible." onRetry={loadList}>
  <svelte:fragment slot="empty">
    <div class="py-16 text-center text-neutral-500">
      <p>Aucun exercice loggé pour l'instant.</p>
      <p class="mt-1 text-sm">Termine une séance pour voir tes courbes de progression ici.</p>
    </div>
  </svelte:fragment>

  <!-- Sélecteurs exercice + période -->
  <div class="mb-4 flex flex-col gap-3">
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-neutral-400">Exercice</span>
      <select
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
        bind:value={selectedId}
        on:change={onSelectChange}
      >
        {#each exercises as e (e.id)}
          <option value={e.id}>{e.name}</option>
        {/each}
      </select>
    </label>

    <div class="flex gap-2" role="group" aria-label="Période">
      {#each PERIODS as p (p.value)}
        <button
          class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium active:bg-neutral-800
            {period === p.value
            ? 'border-neutral-400 bg-neutral-800 text-neutral-100'
            : 'border-neutral-800 text-neutral-400'}"
          on:click={() => { period = p.value; loadData(); }}
        >
          {p.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- Données de l'exercice sélectionné -->
  {#if dataStatus === "loading"}
    <div class="flex items-center justify-center py-16 text-neutral-400">
      <span class="animate-pulse">Chargement…</span>
    </div>
  {:else if dataStatus === "error"}
    <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p class="text-neutral-300">Chargement de la progression impossible.</p>
      <button
        class="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 active:bg-neutral-700"
        on:click={loadData}
      >
        Réessayer
      </button>
    </div>
  {:else if dataStatus === "ready" && data}
    {#if data.session_count === 0}
      <div class="py-16 text-center text-neutral-500">
        <p>Aucune séance sur cette période.</p>
        <p class="mt-1 text-sm">Élargis la période ou termine une séance avec cet exercice.</p>
      </div>
    {:else}
      <!-- Tendance -->
      <div class="mb-4 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm">
        <p class="mb-1 text-neutral-400">
          Tendance sur {data.session_count} séance{data.session_count > 1 ? "s" : ""}
        </p>
        <p class="text-neutral-100">Régression : {regressionText(data.trend)}</p>
        <p class="text-neutral-100">Fenêtre glissante : {rollingText(data.trend)}</p>
      </div>

      <!-- Courbes -->
      <div class="mb-4">
        <h3 class="mb-1 text-sm font-medium text-neutral-300">Charge max par séance (kg)</h3>
        <LineChart data={loadSeries} label="Charge max" unit="kg" color="#60a5fa" />
      </div>
      <div class="mb-4">
        <h3 class="mb-1 text-sm font-medium text-neutral-300">Volume par séance</h3>
        <LineChart data={volumeSeries} label="Volume" unit="" color="#34d399" />
      </div>
    {/if}
  {/if}
</AsyncState>
