// Configuration Vite du front Sthenos.
// - Svelte compilé, Tailwind v4 via son plugin Vite (pas de tailwind.config.js nécessaire).
// - En dev : proxy des appels serveur (/api, /images, /videos) vers Express, pour rester
//   en même origine (cookie de session partagé) — cf docs/frontend.md §2.
// - En prod : build vers dist/, servi en statique par Express (docs/infra.md).
// - PWA : manifest + service worker générés par vite-plugin-pwa (docs/frontend.md §5).

import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Cible du proxy dev : le serveur Express local. Surchargeable par variable d'environnement
// pour ne rien coder en dur (port/hôte de dev différents selon l'environnement).
// IMPORTANT : le port ci-dessous (3000) doit rester synchronisé avec `server.port` de config.yml.
// Si tu changes server.port dans config.yml, mets à jour VITE_DEV_API_TARGET (ou ce défaut),
// sinon le proxy /api|/images|/videos du dev pointe dans le vide.
const API_TARGET = process.env.VITE_DEV_API_TARGET || "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Sthenos",
        short_name: "Sthenos",
        description: "Suivi de musculation et de santé",
        lang: "fr",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Ne pas intercepter les appels API ni les médias : ils passent par le réseau.
        // Le cache hors-ligne des données (niveau 2, IndexedDB) est hors périmètre phase 2.
        navigateFallbackDenylist: [/^\/api/, /^\/images/, /^\/videos/],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/images": { target: API_TARGET, changeOrigin: true },
      "/videos": { target: API_TARGET, changeOrigin: true },
    },
  },
});
