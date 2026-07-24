// Tests composant de SessionRunner — verrouillent les TROIS régressions déjà corrigées à l'écran,
// pour qu'elles restent couvertes sans dépendre d'un test visuel. `lib/api.js` est entièrement mocké
// (le vrai module tire import.meta.env + fetch, hors sujet ici), on monte le VRAI SessionRunner.
//
// Rappel des bugs couverts :
//   1. suggestion résolue APRÈS montage → les lignes de série apparaissent, pré-remplies
//      (le pilotage réactif du chargement + le montage gardé sur suggestion résolue).
//   2. tous les exercices complets → « Terminer » clôture directement, sans confirmation
//      d'incomplétude (allComplete réactif à `logged`, pas figé via une fonction).
//   3. suggestion en cours de chargement → bandeau affiché, AUCUNE ligne vide rendue.

import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de la couche API (même chemin relatif que celui importé par SessionRunner).
vi.mock("../lib/api.js", () => ({
  ApiError: class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
  api: {
    getSession: vi.fn(),
    getRoutine: vi.fn(),
    getSuggestion: vi.fn(),
    addSet: vi.fn(),
    patchSession: vi.fn(),
  },
}));

import { api } from "../lib/api.js";
import SessionRunner from "./SessionRunner.svelte";

// --- Fabriques de données de test ---
const routine = {
  id: 1,
  name: "Push",
  created_at: "2026-01-01T00:00:00Z",
  exercises: [
    {
      id: 10, // routine_exercise id
      exercise_id: "0025",
      position: 1,
      n_series: 3,
      rep_min: 8,
      rep_max: 10,
      rir_cible: 1,
      increment: 2.5,
      goal: "hypertrophy",
      rest_seconds: null,
      name: "barbell bench press",
      category: "chest",
      equipment: "barbell",
      image: "images/0025.jpg",
    },
  ],
};

// Suggestion « hold » : suggested_load 100, suggested_reps 10 (cas de reprise après séance complète).
const suggestionHold = {
  routine_exercise_id: 10,
  exercise_id: "0025",
  goal: "hypertrophy",
  suggestions: [1, 2, 3].map((n) => ({
    set_number: n,
    suggested_load: 100,
    suggested_reps: 10,
    reason: "hold",
  })),
};

const session = (sets = []) => ({
  id: "sess-1",
  routine_id: 1,
  started_at: "2026-01-02T10:00:00Z",
  ended_at: null,
  status: "in_progress",
  sets,
});

const props = () => ({ sessionId: "sess-1", routineId: 1, onFinish: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionRunner", () => {
  it("bug dernier tour : la suggestion résolue après montage remplit les lignes de série", async () => {
    api.getSession.mockResolvedValue(session([]));
    api.getRoutine.mockResolvedValue(routine);
    api.getSuggestion.mockResolvedValue(suggestionHold);

    render(SessionRunner, props());

    // L'exercice se charge (routine).
    expect(await screen.findByText("barbell bench press")).toBeInTheDocument();

    // Une fois la suggestion résolue, les 3 lignes apparaissent PRÉ-REMPLIES (10 reps, 100 kg) avec
    // le motif traduit. Si le pilotage réactif du chargement ou le montage gardé cassait, ces
    // valeurs ne s'afficheraient pas (fields vides / lignes absentes) — c'est la régression.
    const loads = await screen.findAllByDisplayValue("100");
    expect(loads).toHaveLength(3);
    expect(screen.getAllByDisplayValue("10")).toHaveLength(3);
    expect(screen.getAllByText("Maintiens")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Valider la série" })).toHaveLength(3);
  });

  it("bug 1 : après avoir loggé toutes les séries, Terminer clôture SANS confirmation d'incomplétude", async () => {
    api.getSession.mockResolvedValue(session([]));
    api.getRoutine.mockResolvedValue(routine);
    api.getSuggestion.mockResolvedValue(suggestionHold);
    api.addSet.mockImplementation((sid, set) => Promise.resolve({ ...set, session_id: sid, created_at: "now" }));
    api.patchSession.mockResolvedValue({ ...session([]), status: "completed", ended_at: "now" });

    const p = props();
    render(SessionRunner, p);

    // Valide les 3 séries (pré-remplies) → met à jour `logged` APRÈS montage : c'est ce qui figeait
    // allComplete à false dans la régression.
    const validate = await screen.findAllByRole("button", { name: "Valider la série" });
    expect(validate).toHaveLength(3);
    for (const b of validate) await fireEvent.click(b);

    // Les 3 séries passent en « Loggée ».
    await waitFor(() => expect(screen.getAllByText("✓ Loggée")).toHaveLength(3));

    // Terminer → doit clôturer directement (allComplete recalculé à true).
    await fireEvent.click(screen.getByRole("button", { name: "Terminer la séance" }));

    await waitFor(() => expect(api.patchSession).toHaveBeenCalledTimes(1));
    expect(p.onFinish).toHaveBeenCalledTimes(1);
    // Aucune confirmation d'incomplétude ne doit apparaître.
    expect(screen.queryByText(/ne sont pas terminés/)).toBeNull();
  });

  it("bug 2 : pendant le chargement de la suggestion, bandeau affiché et AUCUNE ligne vide", async () => {
    api.getSession.mockResolvedValue(session([]));
    api.getRoutine.mockResolvedValue(routine);
    api.getSuggestion.mockReturnValue(new Promise(() => {})); // ne se résout jamais → reste "loading"

    render(SessionRunner, props());

    // Le bandeau de chargement s'affiche…
    expect(await screen.findByText("Chargement des suggestions…")).toBeInTheDocument();
    // …et aucune ligne de saisie n'est rendue tant que la suggestion n'est pas résolue.
    expect(screen.queryByRole("button", { name: "Valider la série" })).toBeNull();
    expect(screen.queryAllByDisplayValue("100")).toHaveLength(0);
  });
});
