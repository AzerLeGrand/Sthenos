<script>
  // Graphique en ligne minimal basé sur uPlot (léger, docs/frontend.md §1). Réutilisé pour la charge
  // et le volume. Reçoit une série déjà mise en forme [[x…],[y…]] ; n'agrège rien.
  // Redimensionne à la largeur du conteneur (ResizeObserver) — l'écran est mobile-first.
  import { onMount, onDestroy } from "svelte";
  import uPlot from "uplot";
  import "uplot/dist/uPlot.min.css";
  import { frNum } from "../lib/progression-format.js";

  export let data = [[], []]; // format uPlot : [xs (secondes unix), ys]
  export let label = ""; // légende de la série
  export let unit = ""; // unité affichée dans l'infobulle (ex. "kg")
  export let color = "#a3a3a3";

  let container;
  let chart = null;
  let resizeObs = null;

  // Options uPlot. Axe temps par défaut (x en secondes). Couleurs sobres pour le thème sombre.
  function options(width) {
    return {
      width,
      height: 180,
      cursor: { y: false },
      legend: { show: false },
      scales: { x: { time: true } },
      axes: [
        { stroke: "#737373", grid: { stroke: "#26262620" }, ticks: { stroke: "#404040" } },
        {
          stroke: "#737373",
          grid: { stroke: "#262626" },
          ticks: { stroke: "#404040" },
          // Valeurs de l'axe Y en virgule décimale (convention FR).
          values: (u, splits) => splits.map((v) => frNum(v)),
        },
      ],
      series: [
        // Infobulle de l'axe X : date lisible.
        { value: (u, ts) => (ts == null ? "" : new Date(ts * 1000).toLocaleDateString("fr-FR")) },
        {
          label,
          stroke: color,
          width: 2,
          points: { show: true, size: 5, stroke: color, fill: color },
          // Infobulle Y : nombre FR + unité.
          value: (u, v) => (v == null ? "—" : `${frNum(v)} ${unit}`.trim()),
        },
      ],
    };
  }

  function build() {
    if (!container) return;
    const width = container.clientWidth || 320;
    chart = new uPlot(options(width), data, container);
  }

  // Reconstruit la donnée sans recréer l'instance quand `data` change (réactif).
  $: if (chart && data) chart.setData(data);

  onMount(() => {
    build();
    // Suit la largeur du conteneur (rotation, redimensionnement de la fenêtre).
    if (typeof ResizeObserver !== "undefined") {
      resizeObs = new ResizeObserver(() => {
        if (chart && container) chart.setSize({ width: container.clientWidth || 320, height: 180 });
      });
      resizeObs.observe(container);
    }
  });

  onDestroy(() => {
    if (resizeObs) resizeObs.disconnect();
    if (chart) chart.destroy();
  });
</script>

<div bind:this={container} class="w-full"></div>
