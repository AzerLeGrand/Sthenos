<script>
  // Racine de l'application. Décide de l'écran selon l'état de session, monte l'en-tête,
  // l'onglet actif, la barre d'onglets et les overlays (Réglages, détail d'exercice).
  import { onMount } from "svelte";
  import {
    sessionStatus,
    session,
    activeTab,
    settingsOpen,
    detailExerciseId,
    checkSession,
  } from "./lib/stores.js";
  import AsyncState from "./components/AsyncState.svelte";
  import TabBar from "./components/TabBar.svelte";
  import Login from "./screens/Login.svelte";
  import Training from "./screens/Training.svelte";
  import Progression from "./screens/Progression.svelte";
  import Health from "./screens/Health.svelte";
  import Settings from "./screens/Settings.svelte";
  import ExerciseDetail from "./screens/ExerciseDetail.svelte";

  // Vérifie la session au chargement (évite de redemander la connexion inutilement).
  onMount(checkSession);
</script>

{#if $sessionStatus === "loading"}
  <AsyncState status="loading" />
{:else if $sessionStatus === "error"}
  <AsyncState
    status="error"
    errorMessage="Impossible de joindre le serveur."
    onRetry={checkSession}
  />
{:else if $sessionStatus === "anon"}
  <Login />
{:else}
  <!-- Application connectée -->
  <header
    class="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur"
    style="padding-top: calc(env(safe-area-inset-top) + 0.75rem);"
  >
    <span class="text-lg font-semibold tracking-tight">Sthenos</span>
    <button
      class="rounded-full p-1 text-xl text-neutral-400 active:text-neutral-100"
      aria-label="Réglages"
      on:click={() => settingsOpen.set(true)}
    >
      ⚙️
    </button>
  </header>

  <!-- Contenu de l'onglet actif. Marges pour l'en-tête fixe et la barre d'onglets fixe. -->
  <main class="min-h-screen px-4 pb-24 pt-20">
    {#if $activeTab === "training"}
      <Training />
    {:else if $activeTab === "progression"}
      <Progression />
    {:else if $activeTab === "health"}
      <Health />
    {/if}
  </main>

  <TabBar />

  <!-- Overlays -->
  {#if $settingsOpen}
    <Settings />
  {/if}
  {#if $detailExerciseId}
    <ExerciseDetail id={$detailExerciseId} />
  {/if}
{/if}
