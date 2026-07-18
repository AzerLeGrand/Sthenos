<script>
  // Barre d'onglets fixée en bas (pattern mobile, atteignable au pouce) — docs/frontend.md §3.
  // Trois onglets : Entraînement, Progression, Santé. Les Réglages ne sont pas ici (ils sont
  // dans l'en-tête, §3.4). Icônes emoji en placeholder : la DA fine est hors périmètre (§9).
  import { activeTab } from "../lib/stores.js";

  const tabs = [
    { id: "training", label: "Entraînement", icon: "🏋️" },
    { id: "progression", label: "Progression", icon: "📈" },
    { id: "health", label: "Santé", icon: "❤️" },
  ];
</script>

<nav
  class="fixed inset-x-0 bottom-0 z-20 flex border-t border-neutral-800 bg-neutral-900/95 backdrop-blur"
  style="padding-bottom: env(safe-area-inset-bottom);"
>
  {#each tabs as t}
    <button
      class="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors {$activeTab ===
      t.id
        ? 'text-neutral-100'
        : 'text-neutral-500'}"
      aria-current={$activeTab === t.id ? "page" : undefined}
      on:click={() => activeTab.set(t.id)}
    >
      <span class="text-xl" aria-hidden="true">{t.icon}</span>
      {t.label}
    </button>
  {/each}
</nav>
