<script>
  // Onglet Santé (docs/frontend.md §3.3) : saisie manuelle du poids, courbes des indicateurs
  // corporels — les uns saisis à la main, les autres remontés d'Apple Santé par Health Auto Export.
  // Même structure que l'onglet Progression : sélecteurs, courbe, états explicites. Le serveur
  // agrège, dédoublonne les jours et filtre la période ; le front sélectionne et affiche.
  // La configuration du pont Apple Santé (jeton, URL, raccourci iOS) vit dans Réglages, avec le
  // jeton dont elle dépend.
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import AsyncState from "../components/AsyncState.svelte";
  import LineChart from "../components/LineChart.svelte";
  import { PERIODS, toUplotData, frNum, parseFloatFr } from "../lib/progression-format.js";
  import { metricOptions, metricLabel, MANUAL_METRIC, todayLocal } from "../lib/health-format.js";

  // Sélecteur de métriques (poids toujours présent, autres seulement si données existantes).
  let options = [];
  let listStatus = "loading"; // loading | error | ready

  // Sélection courante et série associée.
  let selected = MANUAL_METRIC;
  let period = "90"; // aligné sur default_period de config.yml ; le serveur reste la source de vérité
  let data = null;
  let dataStatus = "idle"; // idle | loading | error | ready

  // Analyse quotidienne (docs/health-integration.md §7). Le cron la produit chaque matin ; le bouton
  // la recalcule à la demande. Chaque indicateur n'est affiché que s'il est présent dans le payload.
  let summary = null; // { date, generated_at, payload } — payload null tant qu'aucune analyse
  let summaryStatus = "loading"; // loading | error | ready
  let running = false;

  async function loadSummary() {
    summaryStatus = "loading";
    try {
      summary = await api.dailySummary();
      summaryStatus = "ready";
    } catch {
      summaryStatus = "error";
    }
  }

  async function runSummary() {
    running = true;
    try {
      summary = await api.runDailySummary();
      summaryStatus = "ready";
    } catch {
      summaryStatus = "error";
    } finally {
      running = false;
    }
  }

  // Payload courant (raccourci de lecture réactif). Référence `summary` directement (docs/frontend.md §6).
  $: sum = summary && summary.payload ? summary.payload : null;

  // Formulaire de saisie manuelle du poids.
  let formDate = todayLocal();
  let formValue = "";
  let formError = "";
  let saving = false;

  async function loadList() {
    listStatus = "loading";
    try {
      options = metricOptions(await api.bodyMetrics());
      // Si la métrique sélectionnée a disparu de la liste, on retombe sur le poids (toujours offert).
      if (!options.some((o) => o.value === selected)) selected = MANUAL_METRIC;
      listStatus = "ready";
      loadData();
    } catch {
      listStatus = "error";
    }
  }

  async function loadData() {
    dataStatus = "loading";
    try {
      data = await api.bodyMetricSeries(selected, period);
      dataStatus = "ready";
    } catch {
      dataStatus = "error";
    }
  }

  // Enregistre une mesure manuelle. Validation miroir du backend (nombre > 0, date AAAA-MM-JJ) pour
  // que l'erreur soit signalée avant l'aller-retour réseau ; le serveur revalide de son côté.
  async function saveWeight() {
    formError = "";
    const v = parseFloatFr(formValue);
    if (!v.ok || v.value <= 0) {
      formError = "Poids : nombre strictement positif attendu (ex. 78,4).";
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      formError = "Date invalide.";
      return;
    }

    saving = true;
    try {
      await api.addBodyMetric(MANUAL_METRIC, v.value, formDate);
      formValue = "";
      // Une première saisie fait apparaître le poids dans le sélecteur : on recharge la liste,
      // qui enchaîne sur le rechargement de la courbe.
      await loadList();
    } catch (err) {
      // Message du serveur s'il y en a un (400 de validation), sinon message générique.
      formError = err && err.message ? err.message : "Enregistrement impossible.";
    } finally {
      saving = false;
    }
  }

  // Série au format uPlot. Réactif : recalculé à chaque nouvelle `data`. Référence `data`
  // directement, jamais via une fonction — Svelte ne trace pas les dépendances lues dans un corps
  // de fonction (docs/frontend.md §6).
  $: series = data ? toUplotData(data.series) : [[], []];
  // Unité affichée : celle renvoyée par le serveur (elle peut varier selon la source, ex. kJ/kcal).
  $: unit = data && data.unit ? data.unit : "";

  onMount(() => {
    loadList();
    loadSummary();
  });
</script>

<h2 class="mb-4 text-xl font-semibold">Santé</h2>

<!-- Analyse quotidienne (docs/health-integration.md §7). Chaque indicateur n'apparaît que s'il est
     présent dans le payload : une métrique absente ce jour-là (montre non portée) est simplement
     omise, jamais affichée comme « — » ou 0. Un sous-calcul sans historique suffisant (baseline,
     tendance) reste présent mais annoncé indisponible. -->
<section class="mb-5 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
  <div class="mb-2 flex items-baseline justify-between">
    <h3 class="text-sm font-medium text-neutral-300">Analyse du jour</h3>
    {#if sum}
      <span class="text-xs text-neutral-600">{summary.date}</span>
    {/if}
  </div>

  {#if summaryStatus === "loading"}
    <p class="py-4 text-center text-sm text-neutral-500 animate-pulse">Chargement…</p>
  {:else if summaryStatus === "error"}
    <div class="flex flex-col items-center gap-2 py-4 text-center">
      <p class="text-sm text-neutral-300">Analyse indisponible.</p>
      <button
        class="rounded-lg bg-neutral-800 px-3 py-1.5 text-sm font-medium text-neutral-100 active:bg-neutral-700"
        on:click={loadSummary}
      >
        Réessayer
      </button>
    </div>
  {:else if sum}
    <dl class="space-y-1.5 text-sm">
      {#if sum.sleep_hours !== undefined}
        <div class="flex justify-between">
          <dt class="text-neutral-400">Sommeil</dt>
          <dd class="text-neutral-100">{frNum(sum.sleep_hours)} h</dd>
        </div>
      {/if}
      {#if sum.resting_hr}
        <div class="flex justify-between">
          <dt class="text-neutral-400">FC de repos</dt>
          <dd class="text-neutral-100">
            {frNum(sum.resting_hr.value)} bpm
            {#if sum.resting_hr.available}
              <span class="text-neutral-500">
                (ligne de base {frNum(sum.resting_hr.baseline)},
                <span class={sum.resting_hr.delta > 0 ? "text-red-400" : sum.resting_hr.delta < 0 ? "text-green-400" : "text-neutral-500"}>
                  {sum.resting_hr.delta > 0 ? "+" : ""}{frNum(sum.resting_hr.delta)}</span>)
              </span>
            {:else}
              <span class="text-neutral-600">(ligne de base indisponible)</span>
            {/if}
          </dd>
        </div>
      {/if}
      {#if sum.hrv_trend}
        <div class="flex justify-between">
          <dt class="text-neutral-400">Variabilité cardiaque</dt>
          <dd class="text-neutral-100">
            {#if sum.hrv_trend.available}
              <span class={sum.hrv_trend.pct_change > 0 ? "text-green-400" : sum.hrv_trend.pct_change < 0 ? "text-red-400" : "text-neutral-500"}>
                {sum.hrv_trend.pct_change > 0 ? "+" : ""}{frNum(sum.hrv_trend.pct_change)} %</span>
              <span class="text-neutral-500">sur {sum.hrv_trend.window} j</span>
            {:else}
              <span class="text-neutral-600">tendance indisponible</span>
            {/if}
          </dd>
        </div>
      {/if}
    </dl>
    {#if !sum.sleep_hours && !sum.resting_hr && !sum.hrv_trend}
      <p class="py-2 text-sm text-neutral-500">Aucune donnée Apple Santé pour ce jour.</p>
    {/if}
  {:else}
    <p class="py-2 text-sm text-neutral-500">Pas encore d'analyse aujourd'hui.</p>
  {/if}

  <button
    class="mt-3 w-full rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-200 active:bg-neutral-800 disabled:opacity-50"
    on:click={runSummary}
    disabled={running}
  >
    {running ? "Analyse en cours…" : "Lancer l'analyse maintenant"}
  </button>
</section>

<!-- Saisie manuelle du poids : indépendante du chargement des courbes, donc hors de AsyncState.
     Sans balance connectée, Apple Santé ne fournit pas le poids (docs/health-integration.md §4). -->
<form class="mb-5 rounded-lg border border-neutral-800 bg-neutral-900 p-3" on:submit|preventDefault={saveWeight}>
  <h3 class="mb-2 text-sm font-medium text-neutral-300">Noter mon poids</h3>
  <div class="flex gap-2">
    <label class="flex flex-1 flex-col gap-1 text-xs">
      <span class="text-neutral-500">Date</span>
      <input
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500"
        type="date"
        bind:value={formDate}
        max={todayLocal()}
        disabled={saving}
      />
    </label>
    <label class="flex w-28 flex-col gap-1 text-xs">
      <span class="text-neutral-500">Poids (kg)</span>
      <input
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500"
        type="text"
        inputmode="decimal"
        placeholder="78,4"
        bind:value={formValue}
        disabled={saving}
      />
    </label>
  </div>
  {#if formError}
    <p class="mt-2 text-sm text-red-400">{formError}</p>
  {/if}
  <button
    class="mt-3 w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 active:bg-neutral-300 disabled:opacity-50"
    type="submit"
    disabled={saving}
  >
    {saving ? "Enregistrement…" : "Enregistrer"}
  </button>
  <p class="mt-2 text-xs text-neutral-600">
    Une seconde saisie sur la même date remplace la précédente.
  </p>
</form>

<AsyncState status={listStatus} errorMessage="Chargement des indicateurs impossible." onRetry={loadList}>
  <!-- Sélecteurs indicateur + période -->
  <div class="mb-4 flex flex-col gap-3">
    <label class="flex flex-col gap-1 text-sm">
      <span class="text-neutral-400">Indicateur</span>
      <select
        class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
        bind:value={selected}
        on:change={loadData}
      >
        {#each options as o (o.value)}
          <option value={o.value}>{o.label}</option>
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

  <!-- Série de l'indicateur sélectionné -->
  {#if dataStatus === "loading"}
    <div class="flex items-center justify-center py-16 text-neutral-400">
      <span class="animate-pulse">Chargement…</span>
    </div>
  {:else if dataStatus === "error"}
    <div class="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p class="text-neutral-300">Chargement de l'indicateur impossible.</p>
      <button
        class="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-100 active:bg-neutral-700"
        on:click={loadData}
      >
        Réessayer
      </button>
    </div>
  {:else if dataStatus === "ready" && data}
    {#if data.point_count === 0}
      <div class="py-16 text-center text-neutral-500">
        <p>Aucune donnée sur cette période.</p>
        <p class="mt-1 text-sm">
          {#if selected === MANUAL_METRIC}
            Note ton poids ci-dessus, ou élargis la période.
          {:else}
            Élargis la période, ou vérifie la synchronisation Apple Santé dans les Réglages.
          {/if}
        </p>
      </div>
    {:else}
      <div class="mb-2 flex items-baseline justify-between">
        <h3 class="text-sm font-medium text-neutral-300">{metricLabel(selected)}</h3>
        <!-- Dernière valeur connue : l'information la plus consultée, avant même la courbe. -->
        <span class="text-sm text-neutral-100">
          {frNum(data.series[data.point_count - 1].value)}
          <span class="text-neutral-500">{unit}</span>
        </span>
      </div>
      <LineChart data={series} label={metricLabel(selected)} {unit} color="#f472b6" />
      <p class="mt-2 text-xs text-neutral-600">
        {data.point_count} mesure{data.point_count > 1 ? "s" : ""} sur la période.
      </p>
    {/if}
  {/if}
</AsyncState>
