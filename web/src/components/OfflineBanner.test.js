// Test composant du bandeau : vérifie que l'indicateur se met à jour RÉACTIVEMENT quand l'état de la
// file change (la classe de bug réactivité Svelte sur état async — cf note §6). Monte le vrai
// composant et pilote le store singleton offlineState.
import { describe, it, expect, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, screen } from "@testing-library/svelte";
import { offlineState } from "../lib/offline-state.js";
import OfflineBanner from "./OfflineBanner.svelte";

beforeEach(() => offlineState.set({ online: true, pending: 0 }));

describe("OfflineBanner", () => {
  it("en ligne et rien en attente : masqué", () => {
    render(OfflineBanner);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("hors-ligne : affiche « Hors-ligne »", async () => {
    render(OfflineBanner);
    offlineState.set({ online: false, pending: 0 });
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent("Hors-ligne");
  });

  it("réactif : passer pending 0 → 3 met à jour le compteur affiché", async () => {
    render(OfflineBanner);
    offlineState.set({ online: false, pending: 0 });
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent("Hors-ligne");

    offlineState.set({ online: false, pending: 3 });
    await tick();
    expect(screen.getByRole("status")).toHaveTextContent("3 en attente");
  });

  it("en ligne avec file non vide : affiche « Synchronisation · N en attente »", async () => {
    render(OfflineBanner);
    offlineState.set({ online: true, pending: 2 });
    await tick();
    const el = screen.getByRole("status");
    expect(el).toHaveTextContent("Synchronisation");
    expect(el).toHaveTextContent("2 en attente");
  });
});
