<script>
  // Catalogue d'exercices en mode SÉLECTEUR (docs/frontend.md §3.1) : recherche par nom,
  // filtres catégorie/équipement (via meta + table de correspondance FR), liste paginée à
  // vignettes JPG. Le clic ouvre le détail en overlay (GIF chargé là, pas ici — §8).
  import { onMount } from "svelte";
  import { api } from "../lib/api.js";
  import { categoryLabel, equipmentLabel } from "../lib/labels.js";
  import { detailExerciseId } from "../lib/stores.js";
  import AsyncState from "../components/AsyncState.svelte";

  // Mode SÉLECTION : si `onSelect` est fourni, le clic sur une ligne renvoie l'exercice à l'appelant
  // (ajout à une routine) au lieu d'ouvrir le détail. Un bouton « voir » reste disponible pour
  // consulter le détail (GIF, instructions) sans déclencher la sélection — il ouvre ExerciseDetail
  // via le store global (rendu par App au-dessus du catalogue ; son ✕ revient ici). onSelect null =
  // comportement de consultation d'origine (toute la ligne ouvre le détail).
  export let onSelect = null;
  $: selecting = typeof onSelect === "function";

  // Ouvre le détail en overlay (store global). Utilisé par le clic de ligne en consultation et par
  // le bouton « voir » en mode sélection.
  function openDetail(id) {
    detailExerciseId.set(id);
  }

  // Filtres (valeurs brutes EN côté API ; libellés FR à l'affichage).
  let q = "";
  let category = "";
  let equipment = "";
  let page = 1;

  // Métadonnées des filtres.
  let meta = { categories: [], equipment: [] };
  let metaStatus = "loading";

  // Résultats de la liste.
  let result = { total: 0, page: 1, limit: 0, items: [] };
  let listStatus = "loading";

  // Listes de filtres triées sur le libellé FR (l'API renvoie les valeurs brutes triées EN).
  $: categoryOptions = [...meta.categories].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b), "fr")
  );
  $: equipmentOptions = [...meta.equipment].sort((a, b) =>
    equipmentLabel(a).localeCompare(equipmentLabel(b), "fr")
  );

  $: totalPages = result.limit ? Math.max(1, Math.ceil(result.total / result.limit)) : 1;

  async function loadMeta() {
    metaStatus = "loading";
    try {
      meta = await api.exercisesMeta();
      metaStatus = "ready";
    } catch {
      metaStatus = "error";
    }
  }

  async function loadList() {
    listStatus = "loading";
    try {
      // limit non transmis : le serveur applique default_limit (rien codé en dur côté front).
      result = await api.listExercises({ q, category, equipment, page });
      listStatus = result.items.length ? "ready" : "empty";
    } catch {
      listStatus = "error";
    }
  }

  // Recherche : débounce léger pour ne pas lancer une requête à chaque frappe.
  let searchTimer;
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      page = 1;
      loadList();
    }, 300);
  }

  function onFilterChange() {
    page = 1;
    loadList();
  }

  function goToPage(p) {
    page = p;
    loadList();
  }

  onMount(() => {
    loadMeta();
    loadList();
  });
</script>

<!-- Barre de recherche + filtres -->
<div class="mb-4 flex flex-col gap-3">
  <input
    class="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-neutral-100 focus:border-neutral-500"
    type="search"
    placeholder="Rechercher un exercice…"
    bind:value={q}
    on:input={onSearchInput}
  />

  <div class="flex gap-3">
    <select
      class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-neutral-100 focus:border-neutral-500"
      bind:value={category}
      on:change={onFilterChange}
      disabled={metaStatus !== "ready"}
    >
      <option value="">Toutes parties</option>
      {#each categoryOptions as c}
        <option value={c}>{categoryLabel(c)}</option>
      {/each}
    </select>

    <select
      class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-neutral-100 focus:border-neutral-500"
      bind:value={equipment}
      on:change={onFilterChange}
      disabled={metaStatus !== "ready"}
    >
      <option value="">Tout équipement</option>
      {#each equipmentOptions as e}
        <option value={e}>{equipmentLabel(e)}</option>
      {/each}
    </select>
  </div>
</div>

<!-- Liste paginée -->
<AsyncState status={listStatus} errorMessage="Chargement du catalogue impossible." onRetry={loadList}>
  <svelte:fragment slot="empty">
    <div class="py-16 text-center text-neutral-500">Aucun exercice ne correspond.</div>
  </svelte:fragment>

  <ul class="flex flex-col gap-2">
    {#each result.items as ex (ex.id)}
      <li class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-2">
        <!-- Contenu de la ligne : sélectionne (mode sélection) ou ouvre le détail (consultation) -->
        <button
          class="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-70"
          on:click={() => (selecting ? onSelect(ex) : openDetail(ex.id))}
        >
          <img
            class="h-14 w-14 flex-none rounded-md bg-neutral-800 object-cover"
            src={`/${ex.image}`}
            alt=""
            loading="lazy"
          />
          <div class="min-w-0">
            <p class="truncate font-medium text-neutral-100">{ex.name}</p>
            <p class="truncate text-xs text-neutral-500">
              {categoryLabel(ex.category)} · {equipmentLabel(ex.equipment)}
            </p>
          </div>
        </button>

        <!-- En mode sélection : consulter le mouvement sans l'ajouter. Bouton frère (pas imbriqué). -->
        {#if selecting}
          <button
            class="flex-none rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 active:bg-neutral-800"
            on:click={() => openDetail(ex.id)}
          >
            Voir
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <!-- Pagination -->
  {#if totalPages > 1}
    <div class="mt-4 flex items-center justify-between text-sm">
      <button
        class="rounded-lg bg-neutral-800 px-3 py-1.5 disabled:opacity-40"
        disabled={page <= 1}
        on:click={() => goToPage(page - 1)}
      >
        Précédent
      </button>
      <span class="text-neutral-400">Page {result.page} / {totalPages}</span>
      <button
        class="rounded-lg bg-neutral-800 px-3 py-1.5 disabled:opacity-40"
        disabled={page >= totalPages}
        on:click={() => goToPage(page + 1)}
      >
        Suivant
      </button>
    </div>
  {/if}
</AsyncState>
