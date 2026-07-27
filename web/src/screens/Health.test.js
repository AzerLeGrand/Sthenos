// Tests composant de la section « Analyse du jour » de Health — verrouillent l'affichage CONDITIONNEL
// des indicateurs : un indicateur absent du payload n'est pas rendu (pas de « — » ni de 0), un
// sous-calcul indisponible s'affiche comme tel. `lib/api.js` est mocké (le vrai tire import.meta.env
// + fetch, hors sujet). On monte le VRAI Health.
//
// Portée volontairement limitée à l'analyse du jour : les courbes et la saisie de poids sont déjà
// couvertes ailleurs et hors du périmètre de cette phase.

import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/api.js", () => ({
  api: {
    // Dépendances de l'écran hors analyse : réponses vides suffisantes pour un montage propre.
    bodyMetrics: vi.fn(() => Promise.resolve([])),
    bodyMetricSeries: vi.fn(() => Promise.resolve({ metric_type: "weight", unit: "kg", period: "90", point_count: 0, series: [] })),
    dailySummary: vi.fn(),
    runDailySummary: vi.fn(),
  },
}));

import { api } from "../lib/api.js";
import Health from "./Health.svelte";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Health — analyse du jour", () => {
  it("payload complet : les trois indicateurs présents sont affichés", async () => {
    api.dailySummary.mockResolvedValue({
      date: "2026-07-27",
      generated_at: "2026-07-27T08:00:00Z",
      payload: {
        sleep_hours: 7.5,
        resting_hr: { value: 58, baseline: 55, delta: 3, baseline_days: 7, available: true },
        hrv_trend: { window: 7, pct_change: 9.8, available: true },
      },
    });
    render(Health);

    await waitFor(() => expect(screen.getByText("Sommeil")).toBeTruthy());
    expect(screen.getByText("7,5 h")).toBeTruthy();
    expect(screen.getByText("FC de repos")).toBeTruthy();
    expect(screen.getByText(/ligne de base 55/)).toBeTruthy();
    expect(screen.getByText("Variabilité cardiaque")).toBeTruthy();
    expect(screen.getByText(/9,8/)).toBeTruthy();
  });

  it("métrique absente ce jour : l'indicateur n'est PAS rendu (pas de placeholder)", async () => {
    // Montre non portée la nuit : pas de sleep_hours ni hrv_trend ; seule la FC repos est là.
    api.dailySummary.mockResolvedValue({
      date: "2026-07-27",
      generated_at: "2026-07-27T08:00:00Z",
      payload: {
        resting_hr: { value: 58, baseline: 55, delta: 3, baseline_days: 7, available: true },
      },
    });
    render(Health);

    await waitFor(() => expect(screen.getByText("FC de repos")).toBeTruthy());
    expect(screen.queryByText("Sommeil")).toBeNull();
    expect(screen.queryByText("Variabilité cardiaque")).toBeNull();
  });

  it("sous-calcul indisponible : indicateur présent, annoncé indisponible", async () => {
    api.dailySummary.mockResolvedValue({
      date: "2026-07-27",
      generated_at: "2026-07-27T08:00:00Z",
      payload: {
        resting_hr: { value: 58, baseline: null, delta: null, baseline_days: 7, available: false },
        hrv_trend: { window: 7, pct_change: null, available: false },
      },
    });
    render(Health);

    await waitFor(() => expect(screen.getByText("FC de repos")).toBeTruthy());
    expect(screen.getByText(/ligne de base indisponible/)).toBeTruthy();
    expect(screen.getByText(/tendance indisponible/)).toBeTruthy();
  });

  it("aucune analyse encore : message dédié, le bouton la déclenche", async () => {
    api.dailySummary.mockResolvedValue({ date: "2026-07-27", generated_at: null, payload: null });
    api.runDailySummary.mockResolvedValue({
      date: "2026-07-27",
      generated_at: "2026-07-27T09:00:00Z",
      payload: { sleep_hours: 8 },
    });
    render(Health);

    await waitFor(() => expect(screen.getByText(/Pas encore d'analyse/)).toBeTruthy());
    await fireEvent.click(screen.getByText("Lancer l'analyse maintenant"));
    await waitFor(() => expect(screen.getByText("Sommeil")).toBeTruthy());
    expect(api.runDailySummary).toHaveBeenCalledOnce();
  });
});
