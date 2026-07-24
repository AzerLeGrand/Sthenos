// Test de la COUTURE entre la file et l'état réactif (le point non couvert par offline-queue.test.js
// et OfflineBanner.test.js pris séparément) : que le onChange de la file réelle mette bien à jour
// `offlineState.pending`, et que la bascule direct/file de queuedWrite fonctionne. File réelle +
// store fake + offlineState frais.
import { describe, it, expect, vi } from "vitest";
import { get, writable } from "svelte/store";
import { createSync } from "./sync.js";

function fakeStore() {
  let seq = 0;
  const map = new Map();
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

const setPayload = { sessionId: "s", set: { id: "a", set_number: 1 } };

describe("sync (couture file ↔ offlineState)", () => {
  it("hors-ligne : queuedWrite empile et offlineState.pending reflète la file", async () => {
    const offlineState = writable({ online: true, pending: 0 });
    const send = vi.fn();
    const sync = createSync({ store: fakeStore(), send, offlineState, isOnline: () => false });
    await sync.init();

    const res = await sync.queuedWrite("set:add", setPayload, { pending: true, id: "a" });

    expect(res).toEqual({ pending: true, id: "a" }); // résultat « en attente »
    expect(send).not.toHaveBeenCalled(); // hors-ligne → pas d'envoi direct
    expect(get(offlineState).pending).toBe(1); // <-- la couture : onChange(file) → pending
  });

  it("en ligne, file vide : envoi direct, renvoie la réponse serveur, rien en file", async () => {
    const offlineState = writable({ online: true, pending: 0 });
    const send = vi.fn().mockResolvedValue({ ok: true });
    const sync = createSync({ store: fakeStore(), send, offlineState, isOnline: () => true });
    await sync.init();

    const res = await sync.queuedWrite("set:add", setPayload, { pending: true, id: "a" });

    expect(res).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(get(offlineState).pending).toBe(0);
  });

  it("en ligne mais échec réseau : bascule en file, pending passe à 1", async () => {
    const offlineState = writable({ online: true, pending: 0 });
    const send = vi.fn().mockRejectedValue({ status: 0 });
    const sync = createSync({ store: fakeStore(), send, offlineState, isOnline: () => true });
    await sync.init();

    const res = await sync.queuedWrite("set:add", setPayload, { pending: true, id: "a" });

    expect(res).toEqual({ pending: true, id: "a" });
    expect(get(offlineState).pending).toBe(1);
  });

  it("erreur serveur réelle (400) : remontée, PAS mise en file", async () => {
    const offlineState = writable({ online: true, pending: 0 });
    const send = vi.fn().mockRejectedValue({ status: 400 });
    const sync = createSync({ store: fakeStore(), send, offlineState, isOnline: () => true });
    await sync.init();

    await expect(
      sync.queuedWrite("set:add", setPayload, { pending: true, id: "a" })
    ).rejects.toMatchObject({ status: 400 });
    expect(get(offlineState).pending).toBe(0);
  });
});
