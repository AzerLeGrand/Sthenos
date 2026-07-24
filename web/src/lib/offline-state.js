// État réactif de la synchronisation hors-ligne, exposé comme un store Svelte SINGLETON (feuille :
// n'importe quel composant peut le lire sans tirer la couche réseau). Alimenté par lib/sync.js
// (taille de la file + connectivité). Le bandeau le lit DIRECTEMENT (`$offlineState`), jamais à
// travers une fonction — cf note de réactivité Svelte 4, docs/frontend.md §6.
import { writable } from "svelte/store";

// online : connectivité courante. pending : nombre d'écritures en attente de synchro dans la file.
export const offlineState = writable({ online: true, pending: 0 });
