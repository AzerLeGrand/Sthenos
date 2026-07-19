<script>
  // Une série en mode séance (docs/frontend.md §3.1). Deux états :
  //  - `initial` fourni (série déjà loggée, reprise de séance) → vue LECTURE SEULE. Pas de ré-édition :
  //    le backend n'a pas de garde d'unicité (session, exercice, set_number) ni d'endpoint de
  //    correction ; re-logger casserait l'hypothèse « une ligne par set_number » du service DDP.
  //  - sinon → SAISIE : champs pré-remplis depuis la suggestion (modifiables), « valider » → POST.
  import { reasonLabel } from "../lib/labels.js";

  export let setNumber;
  export let suggestion = null; // { suggested_load, suggested_reps, reason, degraded } | null
  export let initial = null; // série déjà loggée { reps, load, rir } | null
  export let submit; // (payload) => Promise — POST addSet (fourni par SessionRunner)

  const frNum = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

  // Id client généré UNE fois pour cette ligne : un retry après échec réseau rejoue le même id
  // (idempotent côté serveur), il ne crée pas de doublon.
  const setId = crypto.randomUUID();

  // Vue loggée si la série existe déjà au chargement (reprise). Sinon saisie.
  let logged = initial; // { reps, load, rir } | null

  // Valeurs de saisie, pré-remplies depuis la suggestion (chaînes : contrôle du vide).
  let reps = suggestion && suggestion.suggested_reps != null ? String(suggestion.suggested_reps) : "";
  let load = suggestion && suggestion.suggested_load != null ? frNum(suggestion.suggested_load) : "";
  let rir = ""; // ressenti, jamais dicté par la suggestion

  let saving = false;
  let error = null;

  function parseIntStrict(str) {
    const t = str.trim();
    if (!/^\d+$/.test(t)) return { ok: false };
    return { ok: true, value: parseInt(t, 10) };
  }
  function parseFloatFr(str) {
    const t = str.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false };
    return { ok: true, value: parseFloat(t) };
  }

  // Validation miroir du backend : reps ≥ 0, load ≥ 0, rir ≥ 0 si renseigné.
  function build() {
    const r = parseIntStrict(reps);
    if (!r.ok) return { error: "Répétitions : entier ≥ 0 requis." };
    const l = parseFloatFr(load);
    if (!l.ok) return { error: "Charge : nombre ≥ 0 requis." };
    const payload = { id: setId, set_number: setNumber, reps: r.value, load: l.value };
    if (rir.trim() !== "") {
      const ri = parseIntStrict(rir);
      if (!ri.ok) return { error: "RIR : entier ≥ 0, ou vide." };
      payload.rir = ri.value;
    }
    return { payload };
  }

  async function validate() {
    error = null;
    const res = build();
    if (res.error) {
      error = res.error;
      return;
    }
    saving = true;
    try {
      await submit(res.payload); // POST ; SessionRunner met à jour l'avancement au succès
      logged = { reps: res.payload.reps, load: res.payload.load, rir: res.payload.rir ?? null };
    } catch (err) {
      error = err && err.message ? err.message : "Enregistrement impossible.";
    } finally {
      saving = false;
    }
  }
</script>

<div class="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
  <div class="mb-2 flex items-center justify-between">
    <span class="text-sm font-medium text-neutral-300">Série {setNumber}</span>
    {#if logged}
      <span class="text-xs font-medium text-emerald-400">✓ Loggée</span>
    {:else if suggestion}
      <span class="text-xs text-neutral-500">
        {reasonLabel(suggestion.reason)}{#if suggestion.degraded} · RIR non loggé la dernière fois{/if}
      </span>
    {/if}
  </div>

  {#if logged}
    <!-- Vue lecture seule d'une série déjà enregistrée -->
    <p class="text-sm text-neutral-400">
      {logged.reps} reps · {frNum(logged.load)} kg{#if logged.rir != null} · RIR {logged.rir}{/if}
    </p>
  {:else}
    <!-- Saisie : gros champs, mobile-first -->
    <div class="flex gap-2">
      <label class="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
        Reps
        <input
          class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-base text-neutral-100 focus:border-neutral-500"
          type="text" inputmode="numeric" bind:value={reps} disabled={saving}
        />
      </label>
      <label class="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
        Charge (kg)
        <input
          class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-base text-neutral-100 focus:border-neutral-500"
          type="text" inputmode="decimal" bind:value={load} disabled={saving}
        />
      </label>
      <label class="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
        RIR
        <input
          class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-base text-neutral-100 focus:border-neutral-500"
          type="text" inputmode="numeric" placeholder="—" bind:value={rir} disabled={saving}
        />
      </label>
    </div>

    {#if error}
      <p class="mt-2 text-sm text-red-300">{error}</p>
    {/if}

    <button
      class="mt-3 w-full rounded-lg bg-neutral-100 px-4 py-2.5 font-semibold text-neutral-900 active:bg-neutral-300 disabled:opacity-50"
      on:click={validate} disabled={saving}
    >
      {saving ? "Enregistrement…" : "Valider la série"}
    </button>
  {/if}
</div>
