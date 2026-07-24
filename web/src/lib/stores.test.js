// Tests de la logique de session, en particulier l'AUTH OPTIMISTE HORS-LIGNE : au reload sans réseau,
// l'app doit s'ouvrir depuis le dernier profil connu plutôt que de bloquer sur l'écran d'erreur
// (bug reproduit à l'étape 5 du test hors-ligne). api.js est mocké (pas de fetch réel).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

vi.mock("../lib/api.js", () => ({
  api: { me: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}));

import { api } from "../lib/api.js";
import { checkSession, sessionStatus, session } from "../lib/stores.js";

const USER_KEY = "sthenos.user";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("checkSession", () => {
  it("hors-ligne (réseau injoignable) avec profil en cache → authed", async () => {
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, username: "alice" }));
    api.me.mockRejectedValue({ status: 0 });
    await checkSession();
    expect(get(sessionStatus)).toBe("authed");
    expect(get(session)).toEqual({ id: 1, username: "alice" });
  });

  it("hors-ligne sans profil en cache → error", async () => {
    api.me.mockRejectedValue({ status: 0 });
    await checkSession();
    expect(get(sessionStatus)).toBe("error");
  });

  it("401 → anon et purge du cache profil", async () => {
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, username: "alice" }));
    api.me.mockRejectedValue({ status: 401 });
    await checkSession();
    expect(get(sessionStatus)).toBe("anon");
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it("succès → authed et met le profil en cache", async () => {
    api.me.mockResolvedValue({ id: 2, username: "bob" });
    await checkSession();
    expect(get(sessionStatus)).toBe("authed");
    expect(JSON.parse(localStorage.getItem(USER_KEY))).toEqual({ id: 2, username: "bob" });
  });

  it("serveur joignable mais en erreur (500) → error, même avec un cache (pas d'optimiste)", async () => {
    localStorage.setItem(USER_KEY, JSON.stringify({ id: 1, username: "alice" }));
    api.me.mockRejectedValue({ status: 500 });
    await checkSession();
    expect(get(sessionStatus)).toBe("error");
  });
});
