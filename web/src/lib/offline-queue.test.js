// Tests de la LOGIQUE PURE de file (sans navigateur) : ordre de rejeu, séquentialité, gestion des
// échecs (réseau / 4xx / 5xx), non-perte d'entrées, id non régénéré, reprise après reload.
// Store en mémoire respectant l'interface attendue (add/getAllOrdered/update/remove).
import { describe, it, expect, vi } from "vitest";
import { createQueue } from "./offline-queue.js";

function fakeStore(initial = []) {
  let seq = 0;
  const map = new Map();
  for (const e of initial) {
    const k = ++seq;
    map.set(k, { ...e, key: k });
  }
  return {
    async add(entry) {
      const k = ++seq;
      map.set(k, { ...entry, key: k });
      return k;
    },
    async getAllOrdered() {
      return [...map.keys()].sort((a, b) => a - b).map((k) => ({ ...map.get(k) }));
    },
    async update(entry) {
      map.set(entry.key, { ...entry });
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

const setEntry = (id, sessionId = "s") => ["set:add", { sessionId, set: { id, set_number: 1 } }];

describe("offline-queue", () => {
  it("enqueue persiste et notifie la nouvelle taille", async () => {
    const onChange = vi.fn();
    const q = createQueue({ store: fakeStore(), send: vi.fn(), onChange });
    await q.init();
    await q.enqueue(...setEntry("a"));
    expect(q.size()).toBe(1);
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("flush rejoue dans l'ordre d'insertion et retire les entrées acceptées", async () => {
    const sent = [];
    const send = vi.fn((e) => (sent.push(e.payload.set.id), Promise.resolve()));
    const q = createQueue({ store: fakeStore(), send });
    await q.init();
    await q.enqueue(...setEntry("a"));
    await q.enqueue(...setEntry("b"));
    await q.flush();
    expect(sent).toEqual(["a", "b"]);
    expect(q.size()).toBe(0);
  });

  it("flush envoie UNE entrée à la fois (jamais deux envois concurrents)", async () => {
    let active = 0;
    let maxActive = 0;
    const send = vi.fn(
      () =>
        new Promise((r) => {
          active++;
          maxActive = Math.max(maxActive, active);
          setTimeout(() => (active--, r()), 5);
        })
    );
    const q = createQueue({ store: fakeStore(), send });
    await q.init();
    await q.enqueue(...setEntry("a"));
    await q.enqueue(...setEntry("b"));
    await q.flush();
    expect(maxActive).toBe(1);
  });

  it("échec réseau (status 0) : arrêt du flush, rien perdu, ordre préservé", async () => {
    const send = vi.fn().mockRejectedValue({ status: 0 });
    const q = createQueue({ store: fakeStore(), send });
    await q.init();
    await q.enqueue(...setEntry("a"));
    await q.enqueue(...setEntry("b"));
    await q.flush();
    expect(q.size()).toBe(2); // rien retiré
    expect(send).toHaveBeenCalledTimes(1); // stop dès le premier échec réseau
  });

  it("erreur 4xx : dead-letter, ne bloque pas les entrées suivantes", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ status: 400 }) // a → rejet permanent
      .mockResolvedValueOnce(undefined); // b → accepté
    const q = createQueue({ store: fakeStore(), send });
    await q.init();
    await q.enqueue(...setEntry("a"));
    await q.enqueue(...setEntry("b"));
    await q.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0); // a abandonnée, b envoyée
  });

  it("erreur 5xx : backoff puis dead-letter au-delà de maxAttempts", async () => {
    let t = 1000;
    const send = vi.fn().mockRejectedValue({ status: 500 });
    const q = createQueue({
      store: fakeStore(),
      send,
      now: () => t,
      config: { backoffBaseMs: 10, backoffMaxMs: 100, maxAttempts: 3 },
    });
    await q.init();
    await q.enqueue(...setEntry("a"));

    await q.flush(); // tentative 1 → nextAttemptAt = 1010
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(1);

    await q.flush(); // pas encore due (t=1000) → aucun envoi
    expect(send).toHaveBeenCalledTimes(1);

    t = 1010;
    await q.flush(); // tentative 2 → nextAttemptAt = 1030
    expect(send).toHaveBeenCalledTimes(2);

    t = 1030;
    await q.flush(); // tentative 3 → attempts atteint max → dead-letter
    expect(send).toHaveBeenCalledTimes(3);
    expect(q.size()).toBe(0);
  });

  it("un rejeu réutilise le MÊME id (pas de régénération)", async () => {
    let t = 0;
    const seen = [];
    const send = vi.fn((e) => (seen.push(e.payload.set.id), Promise.reject({ status: 500 })));
    const q = createQueue({
      store: fakeStore(),
      send,
      now: () => t,
      config: { backoffBaseMs: 1, backoffMaxMs: 1, maxAttempts: 10 },
    });
    await q.init();
    await q.enqueue(...setEntry("fixed"));
    await q.flush();
    t = 100;
    await q.flush();
    expect(seen).toEqual(["fixed", "fixed"]);
  });

  it("init reprend les entrées persistées (reprise après reload)", async () => {
    const store = fakeStore([
      { type: "set:add", payload: { sessionId: "s", set: { id: "x" } }, attempts: 0, nextAttemptAt: 0 },
    ]);
    const send = vi.fn().mockResolvedValue(undefined);
    const q = createQueue({ store, send });
    await q.init();
    expect(q.size()).toBe(1);
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it("pendingSetsFor ne renvoie que les séries de la séance visée", async () => {
    const q = createQueue({ store: fakeStore(), send: vi.fn() });
    await q.init();
    await q.enqueue("session:create", { session: { id: "s" } });
    await q.enqueue(...setEntry("a", "s"));
    await q.enqueue(...setEntry("b", "other"));
    expect(q.pendingSetsFor("s")).toEqual([{ id: "a", set_number: 1 }]);
  });
});
