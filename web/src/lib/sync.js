// Orchestration hors-ligne : câble la file (offline-queue) à l'état réactif (offlineState) et à la
// connectivité, et expose la bascule direct/file des écritures. Tout est injecté (store, send,
// offlineState, isOnline, now) → cette couture est testable avec une file réelle + un store fake
// (sync.test.js), là où offline-queue.test.js teste la logique pure et OfflineBanner.test.js l'UI.
import { createQueue } from "./offline-queue.js";

const FLUSH_INTERVAL_MS = 30000; // tentative de vidage périodique (front sans config.yml : source unique)

const defaultIsOnline = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

export function createSync({
  store,
  send,
  offlineState,
  isOnline = defaultIsOnline,
  now = () => Date.now(),
  config = {},
}) {
  // Couture testée : chaque changement de taille de file met à jour `pending` de l'état réactif.
  const setPending = (n) => offlineState.update((s) => ({ ...s, pending: n }));
  const setOnline = (v) => offlineState.update((s) => ({ ...s, online: v }));

  const queue = createQueue({ store, send, now, onChange: setPending, config });

  // Barrière de disponibilité : résolue quand la file persistée est chargée. Les lectures qui
  // dépendent du contenu de la file (getSession hors-ligne) l'attendent, pour éviter la course
  // « lecture avant chargement » au démarrage (séries en file non vues → risque de re-log).
  let resolveReady;
  const ready = new Promise((res) => (resolveReady = res));

  const isNetworkError = (err) => err && err.status === 0;

  // Bascule direct/file. `pendingResult` est renvoyé quand l'écriture est différée (les composants
  // n'exploitent pas la valeur, ils n'attendent que la résolution de la promesse).
  async function queuedWrite(type, payload, pendingResult) {
    // File vide ET en ligne : on tente l'envoi direct. File non vide → on empile pour préserver
    // l'ordre (éviter qu'une série parte avant que sa session existe).
    if (queue.size() === 0 && isOnline()) {
      try {
        return await send({ type, payload });
      } catch (err) {
        if (isNetworkError(err)) {
          await queue.enqueue(type, payload);
          return pendingResult;
        }
        throw err; // vraie erreur serveur (ex. validation) : on la remonte, la file ne l'aiderait pas
      }
    }
    await queue.enqueue(type, payload);
    if (isOnline()) queue.flush().catch(() => {}); // blip déjà résorbé : vidange opportuniste
    return pendingResult;
  }

  // Reprend la file persistée puis reflète l'état initial. Lève `ready` dans tous les cas (même si
  // IndexedDB échoue : file vide) pour ne jamais bloquer une lecture qui l'attend.
  async function init() {
    try {
      await queue.init();
      setOnline(isOnline());
    } finally {
      resolveReady();
    }
  }

  // Écoute la connectivité et vide périodiquement. `win` injecté (window en prod).
  function startConnectivity(win) {
    setOnline(isOnline());
    win.addEventListener("online", () => {
      setOnline(true);
      queue.flush().catch(() => {});
    });
    win.addEventListener("offline", () => setOnline(false));
    const interval = setInterval(() => {
      if (isOnline()) queue.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(interval); // pour un éventuel teardown (tests)
    };
  }

  return { queue, queuedWrite, init, startConnectivity, ready };
}
