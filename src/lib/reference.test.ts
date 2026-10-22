import { describe, expect, it } from "vitest";
import { bandOf, bandTotals, comboKey, tighterThan, type ComboRef } from "./reference";

const pct = Array.from({ length: 19 }, (_, i) => (i + 1) * 1.0); // 5th pct = 1 in, ..., 95th = 19 in
const c: ComboRef = { n: 100, pct, bins: { "0": { n: 2, chases: 1, outOfZone: 2 }, "1": { n: 3, chases: 3, outOfZone: 3 }, "3": { n: 5, chases: 1, outOfZone: 4 }, "20": { n: 1, chases: 0, outOfZone: 1 } } };

describe("reference", () => {
  it("percentile reads as share of pairs less tight", () => {
    expect(tighterThan(c, 10)).toBeCloseTo(50);
    expect(tighterThan(c, 4)).toBeCloseTo(80);
    expect(tighterThan(c, 0.5)).toBeGreaterThan(95);
    expect(tighterThan(c, 25)).toBeLessThan(5);
  });
  it("bands and sums", () => {
    expect(bandOf(1.9)).toBe(0); expect(bandOf(2)).toBe(1); expect(bandOf(40)).toBe(6);
    const t = bandTotals(c);
    expect(t[0]).toEqual({ n: 5, chases: 4, outOfZone: 5 });
    expect(t[1]).toEqual({ n: 5, chases: 1, outOfZone: 4 });
    expect(t[6]).toEqual({ n: 1, chases: 0, outOfZone: 1 });
  });
  it("maps WVU tag names to classifier names", () => {
    expect(comboKey("Fastball", "Sweeper")).toBe("Four-Seam>Slider");
  });
});
