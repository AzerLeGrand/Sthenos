// Tests des helpers de présentation Progression : mapping vers uPlot et formatage FR.
// Pas de réseau ni de Svelte : logique pure.
import { describe, it, expect } from "vitest";
import { PERIODS, toUplotData, frNum, trendLabel } from "./progression-format.js";

describe("toUplotData", () => {
  it("convertit [{date,value}] en [[secondes unix],[valeurs]]", () => {
    const points = [
      { date: "2026-01-01T00:00:00Z", value: 40 },
      { date: "2026-01-02T00:00:00Z", value: 45 },
    ];
    const [xs, ys] = toUplotData(points);
    expect(ys).toEqual([40, 45]);
    expect(xs[0]).toBe(Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000));
    expect(xs[1] - xs[0]).toBe(86400); // un jour d'écart, en secondes
  });

  it("tolère une série vide ou absente sans crash", () => {
    expect(toUplotData([])).toEqual([[], []]);
    expect(toUplotData(undefined)).toEqual([[], []]);
  });
});

describe("frNum", () => {
  it("utilise la virgule décimale et retire les zéros superflus", () => {
    expect(frNum(560)).toBe("560");
    expect(frNum(47.5)).toBe("47,5");
    expect(frNum(0.42, 2)).toBe("0,42");
  });
  it("rend un tiret pour une valeur absente", () => {
    expect(frNum(null)).toBe("—");
    expect(frNum(undefined)).toBe("—");
  });
});

describe("trendLabel", () => {
  it("traduit les classifications", () => {
    expect(trendLabel("hausse")).toBe("En hausse");
    expect(trendLabel("baisse")).toBe("En baisse");
    expect(trendLabel("stable")).toBe("Stable");
    expect(trendLabel("indetermine")).toBe("Indéterminé");
  });
});

describe("PERIODS", () => {
  it("offre exactement les périodes acceptées par la route", () => {
    expect(PERIODS.map((p) => p.value)).toEqual(["30", "90", "all"]);
  });
});
