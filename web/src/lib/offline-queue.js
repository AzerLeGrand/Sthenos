// File de synchronisation hors-ligne — LOGIQUE PURE (aucun accès IndexedDB ni fetch direct).
// Le stockage (`store`) et l'envoi réseau (`send`) sont injectés → testable sans navigateur, comme
// progression.js côté backend. Maintient un miroir mémoire des entrées (chargé du store à l'init,
// synchronisé à chaque enqueue/remove) pour offrir size()/pendingSetsFor() synchrones.
//
// Contrat d'une entrée : { key, type, payload, attempts, nextAttemptAt }. `key` = clé d'insertion
// du store (ordre de rejeu). L'id ressource (session/série) vit DANS payload, fixé une fois à
// l'enqueue et jamais régénéré au rejeu (idempotence, docs/data-model.md §1).
//
// Contrat de `send(entry)` : résout si le serveur a accepté, rejette sinon avec `err.status` :
//   0        → échec réseau (hors-ligne) : on arrête le flush, tout reste en file.
//   4xx      → rejet permanent (validation/conflit) : dead-letter (l'idempotence rend un 409 sûr).
//   5xx/autre→ transitoire : backoff, puis dead-letter au-delà de maxAttempts.

// Défauts de comportement (le front n'a pas de config.yml : source unique ici, surchargeable en test).
const DEFAULT_CONFIG = {
  backoffBaseMs: 2000, // délai de base du backoff exponentiel
  backoffMaxMs: 60000, // plafond du délai
  maxAttempts: 5, // au-delà, une entrée en échec serveur transitoire est abandonnée (dead-letter)
};

export function createQueue({ store, send, now = () => Date.now(), onChange = () => {}, config = {} }) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let entries = []; // miroir mémoire, ordonné par clé
  let flushing = false;

  const notify = () => onChange(entries.length);

  // Charge les entrées persistées (reprise après rechargement de page).
  async function init() {
    entries = await store.getAllOrdered();
    notify();
  }

  const size = () => entries.length;

  // Séries en attente pour une séance donnée (permet à getSession de les rejouer hors-ligne).
  function pendingSetsFor(sessionId) {
    return entries
      .filter((e) => e.type === "set:add" && e.payload.sessionId === sessionId)
      .map((e) => e.payload.set);
  }

  // Ajoute une écriture en fin de file. La clé (ordre) est attribuée par le store.
  async function enqueue(type, payload) {
    const entry = { type, payload, attempts: 0, nextAttemptAt: 0 };
    const key = await store.add(entry);
    entry.key = key;
    entries.push(entry);
    notify();
    return entry;
  }

  const backoff = (attempts) =>
    Math.min(cfg.backoffBaseMs * 2 ** (attempts - 1), cfg.backoffMaxMs);

  async function removeEntry(entry) {
    await store.remove(entry.key);
    entries = entries.filter((e) => e.key !== entry.key);
    notify();
  }

  // Draine la file dans l'ordre, UNE entrée à la fois. Garde `flushing` contre les déclenchements
  // concurrents (online + intervalle). Ne lève jamais : les erreurs sont gérées par entrée.
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const t = now();
      for (const entry of [...entries]) {
        if (entry.nextAttemptAt > t) continue; // pas encore due (backoff)
        try {
          await send(entry);
          await removeEntry(entry); // accepté → on retire
        } catch (err) {
          const status = err && typeof err.status === "number" ? err.status : undefined;
          if (status === 0) {
            break; // échec réseau : hors-ligne, on arrête (retry au prochain online/intervalle)
          }
          if (status >= 400 && status < 500) {
            await removeEntry(entry); // rejet permanent : dead-letter, ne bloque pas les suivantes
            continue;
          }
          // 5xx / erreur inconnue : transitoire → backoff, dead-letter au-delà de maxAttempts.
          entry.attempts += 1;
          if (entry.attempts >= cfg.maxAttempts) {
            await removeEntry(entry);
          } else {
            entry.nextAttemptAt = now() + backoff(entry.attempts);
            await store.update(entry);
          }
        }
      }
    } finally {
      flushing = false;
    }
  }

  return { init, size, pendingSetsFor, enqueue, flush };
}
