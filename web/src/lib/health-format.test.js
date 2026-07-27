// Tests des helpers de l'onglet Santé (vitest, comme progression-format.test.js).
import { describe, it, expect } from "vitest";
import { METRIC_LABELS, metricLabel, metricOptions, todayLocal } from "./health-format.js";

describe("metricLabel", () => {
  it("traduit les métriques connues", () => {
    expect(metricLabel("weight")).toBe("Poids");
    expect(metricLabel("hrv")).toBe("Variabilité cardiaque");
  });

  it("se rabat sur l'identifiant brut pour une métrique non traduite", () => {
    expect(metricLabel("blood_glucose")).toBe("blood_glucose");
  });
});

describe("metricOptions", () => {
  it("propose toujours le poids, même sans aucune donnée", () => {
    expect(metricOptions([])).toEqual([{ value: "weight", label: "Poids" }]);
    expect(metricOptions(null)).toEqual([{ value: "weight", label: "Poids" }]);
  });

  it("n'affiche que les métriques ayant des données, poids mis à part", () => {
    const opts = metricOptions([{ metric_type: "hrv" }, { metric_type: "steps" }]);
    expect(opts.map((o) => o.value)).toEqual(["weight", "hrv", "steps"]);
  });

  it("respecte l'ordre de METRIC_LABELS, pas celui du serveur", () => {
    const opts = metricOptions([{ metric_type: "vo2max" }, { metric_type: "resting_hr" }]);
    expect(opts.map((o) => o.value)).toEqual(["weight", "resting_hr", "vo2max"]);
    expect(Object.keys(METRIC_LABELS)[0]).toBe("weight");
  });

  it("ne dédouble pas le poids quand il a déjà des données", () => {
    const opts = metricOptions([{ metric_type: "weight" }]);
    expect(opts).toEqual([{ value: "weight", label: "Poids" }]);
  });

  it("conserve une métrique inconnue du front plutôt que de la masquer", () => {
    const opts = metricOptions([{ metric_type: "blood_glucose" }]);
    expect(opts.map((o) => o.value)).toEqual(["weight", "blood_glucose"]);
    expect(opts[1].label).toBe("blood_glucose");
  });
});

describe("todayLocal", () => {
  it("renvoie le jour LOCAL, jamais la date UTC", () => {
    // 00:30 en heure locale : toISOString() donnerait la veille sous un fuseau positif.
    const minuitPasse = new Date(2026, 6, 26, 0, 30, 0);
    expect(todayLocal(minuitPasse)).toBe("2026-07-26");
    // 23:30 en heure locale : toISOString() donnerait le lendemain sous un fuseau négatif.
    expect(todayLocal(new Date(2026, 6, 26, 23, 30, 0))).toBe("2026-07-26");
  });

  it("complète mois et jour sur deux chiffres", () => {
    expect(todayLocal(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});
