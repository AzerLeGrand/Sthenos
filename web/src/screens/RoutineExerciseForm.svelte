<script>
  // Formulaire des paramètres d'un exercice dans une routine (docs/frontend.md §3.1), en modal.
  // Deux modes :
  //  - 'add'  : ajout. Les champs optionnels laissés vides sont OMIS du POST → le serveur applique
  //             les défauts user_settings (pas de valeur inventée côté front, cf décision de session).
  //             Seul n_series est requis (le backend n'a pas de défaut pour lui). goal a un défaut d'UI.
  //  - 'edit' : modification. Tous les champs sont pré-remplis avec les valeurs réelles ; validation
  //             complète. rest_seconds vidé → effacé (null) ; les autres restent obligatoires.
  export let mode = "add"; // 'add' | 'edit'
  export let exercise; // { name, image, ... } pour l'en-tête (item catalogue en add, re en edit)
  export let initial = null; // params existants en mode edit, null en add
  export let saving = false; // désactive le formulaire pendant l'appel réseau (piloté par le parent)
  export let serverError = null; // message d'erreur renvoyé par le serveur, affiché tel quel
  export let onSubmit; // (params) => void
  export let onCancel; // () => void

  // Valeurs des champs, en chaînes (contrôle total du « vide = omettre »). Pré-remplies en edit.
  const s = (v) => (v === null || v === undefined ? "" : String(v));
  let n_series = initial ? s(initial.n_series) : "";
  let rep_min = initial ? s(initial.rep_min) : "";
  let rep_max = initial ? s(initial.rep_max) : "";
  let rir_cible = initial ? s(initial.rir_cible) : "";
  let increment = initial ? s(initial.increment).replace(".", ",") : ""; // virgule FR à l'affichage
  let rest_seconds = initial ? s(initial.rest_seconds) : "";
  let goal = initial ? initial.goal : "hypertrophy";

  let error = null; // message de validation front

  // Parse un entier depuis une chaîne. Retourne { ok, value } ; ok=false si non entier.
  function parseIntStrict(str) {
    const t = str.trim();
    if (!/^-?\d+$/.test(t)) return { ok: false };
    return { ok: true, value: parseInt(t, 10) };
  }
  // Parse un décimal (accepte la virgule FR). Retourne { ok, value }.
  function parseFloatFr(str) {
    const t = str.trim().replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false };
    return { ok: true, value: parseFloat(t) };
  }

  // Construit et valide les paramètres. Retourne { params } ou { error }.
  function build() {
    const params = {};

    // n_series : requis dans les deux modes.
    const ns = parseIntStrict(n_series);
    if (!ns.ok || ns.value < 1) return { error: "Le nombre de séries doit être un entier ≥ 1." };
    params.n_series = ns.value;

    // Bornes de reps. En add : optionnelles mais indissociables (l'une remplie impose l'autre,
    // sinon le serveur mélangerait avec un défaut et pourrait obtenir min > max).
    const minFilled = rep_min.trim() !== "";
    const maxFilled = rep_max.trim() !== "";
    const required = mode === "edit";
    if (required || minFilled || maxFilled) {
      if (!minFilled || !maxFilled)
        return { error: "Renseignez les deux bornes de répétitions, ou aucune." };
      const mn = parseIntStrict(rep_min);
      const mx = parseIntStrict(rep_max);
      if (!mn.ok || mn.value < 1 || !mx.ok || mx.value < 1)
        return { error: "Les bornes de répétitions doivent être des entiers ≥ 1." };
      if (mn.value > mx.value) return { error: "La borne basse dépasse la borne haute." };
      params.rep_min = mn.value;
      params.rep_max = mx.value;
    }

    // RIR cible.
    if (required || rir_cible.trim() !== "") {
      const r = parseIntStrict(rir_cible);
      if (!r.ok || r.value < 0) return { error: "Le RIR cible doit être un entier ≥ 0." };
      params.rir_cible = r.value;
    }

    // Incrément (décimal).
    if (required || increment.trim() !== "") {
      const inc = parseFloatFr(increment);
      if (!inc.ok || inc.value <= 0) return { error: "L'incrément doit être un nombre > 0." };
      params.increment = inc.value;
    }

    // goal : toujours défini.
    params.goal = goal;

    // rest_seconds : optionnel. En edit, vidé → null (efface). En add, vide → omis.
    if (rest_seconds.trim() !== "") {
      const rs = parseIntStrict(rest_seconds);
      if (!rs.ok || rs.value < 0) return { error: "Le repos doit être un entier de secondes ≥ 0." };
      params.rest_seconds = rs.value;
    } else if (mode === "edit") {
      params.rest_seconds = null;
    }

    return { params };
  }

  function submit() {
    error = null;
    const res = build();
    if (res.error) {
      error = res.error;
      return;
    }
    onSubmit(res.params);
  }
</script>

<!-- Modal en bas d'écran (motif ExerciseDetail). z-30 : jamais concurrent du catalogue (fermé avant). -->
<div class="fixed inset-0 z-30 flex items-end justify-center bg-black/70 sm:items-center" role="presentation">
  <div
    class="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-neutral-800 bg-neutral-900 sm:rounded-2xl"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <div class="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
      <span class="text-sm font-medium text-neutral-400">
        {mode === "edit" ? "Modifier les paramètres" : "Ajouter à la routine"}
      </span>
      <button
        class="rounded-full px-2 text-xl text-neutral-400 active:text-neutral-100"
        aria-label="Fermer"
        on:click={onCancel}
      >
        ✕
      </button>
    </div>

    <div class="overflow-y-auto p-4">
      <!-- En-tête : quel exercice -->
      <div class="mb-4 flex items-center gap-3">
        <img class="h-12 w-12 flex-none rounded-md bg-neutral-800 object-cover" src={`/${exercise.image}`} alt="" />
        <p class="min-w-0 truncate font-medium text-neutral-100">{exercise.name}</p>
      </div>

      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span class="text-neutral-400">Séries de travail<span class="text-red-400"> *</span></span>
          <input
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
            type="text" inputmode="numeric" placeholder="ex. 3" bind:value={n_series} disabled={saving}
          />
        </label>

        <div class="flex gap-3">
          <label class="flex flex-1 flex-col gap-1 text-sm">
            <span class="text-neutral-400">Reps min</span>
            <input
              class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
              type="text" inputmode="numeric" placeholder={mode === "edit" ? "" : "défaut"} bind:value={rep_min} disabled={saving}
            />
          </label>
          <label class="flex flex-1 flex-col gap-1 text-sm">
            <span class="text-neutral-400">Reps max</span>
            <input
              class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
              type="text" inputmode="numeric" placeholder={mode === "edit" ? "" : "défaut"} bind:value={rep_max} disabled={saving}
            />
          </label>
        </div>

        <div class="flex gap-3">
          <label class="flex flex-1 flex-col gap-1 text-sm">
            <span class="text-neutral-400">RIR cible</span>
            <input
              class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
              type="text" inputmode="numeric" placeholder={mode === "edit" ? "" : "défaut"} bind:value={rir_cible} disabled={saving}
            />
          </label>
          <label class="flex flex-1 flex-col gap-1 text-sm">
            <span class="text-neutral-400">Incrément (kg)</span>
            <input
              class="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
              type="text" inputmode="decimal" placeholder={mode === "edit" ? "" : "défaut"} bind:value={increment} disabled={saving}
            />
          </label>
        </div>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-neutral-400">Objectif</span>
          <select
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
            bind:value={goal} disabled={saving}
          >
            <option value="hypertrophy">Hypertrophie</option>
            <option value="strength">Force</option>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="text-neutral-400">Repos (secondes, optionnel)</span>
          <input
            class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 focus:border-neutral-500"
            type="text" inputmode="numeric" placeholder="ex. 120" bind:value={rest_seconds} disabled={saving}
          />
        </label>

        {#if mode === "add"}
          <p class="text-xs text-neutral-500">
            Les champs laissés vides utilisent tes valeurs par défaut (modifiables ensuite).
          </p>
        {/if}

        {#if error || serverError}
          <p class="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error || serverError}
          </p>
        {/if}

        <div class="mt-1 flex gap-3">
          <button
            class="flex-1 rounded-lg border border-neutral-700 px-4 py-2.5 font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50"
            on:click={onCancel} disabled={saving}
          >
            Annuler
          </button>
          <button
            class="flex-1 rounded-lg bg-neutral-100 px-4 py-2.5 font-medium text-neutral-900 active:bg-neutral-300 disabled:opacity-50"
            on:click={submit} disabled={saving}
          >
            {saving ? "Enregistrement…" : mode === "edit" ? "Enregistrer" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
