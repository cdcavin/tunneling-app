import { describe, expect, it } from "vitest";
import { bestPairs } from "./bestPairs";
import { aimAt, type Coeffs } from "./physics";
import type { PitchRow } from "./types";

// A plausible fastball fit (ft, ft/s, ft/s²) and a breaking ball with more drop and run.
const FB: Coeffs = { Xc0: 54.5, Xc1: -135, Xc2: 12, Yc0: 5.9, Yc1: -1.5, Yc2: -16, Zc0: -2.1, Zc1: 4.5, Zc2: 6 };
const SL: Coeffs = { Xc0: 54.5, Xc1: -120, Xc2: 10, Yc0: 5.9, Yc1: -0.5, Yc2: -34, Zc0: -2.1, Zc1: 3.5, Zc2: -10 };
const row = (id: string, type: string, c: Coeffs, pa: number, pitchNo: number, side = 0, height = 2.5): PitchRow => ({
  id, date: "2026-03-01", game: "g1", opponent: "X", season: "Spring 2026", utc: `2026-03-01T00:00:${String(pitchNo + pa * 10).padStart(2, "0")}Z`,
  inning: 1, half: "Top", pa, pitchNo, type, velo: 90, ivb: 15, hb: 8, spin: 2200, side, height, call: "StrikeCalled", coeffs: aimAt(c, side, height),
});

describe("bestPairs", () => {
  const rows = [
    row("a", "Fastball", FB, 1, 1, 0, 2.6), row("b", "Slider", SL, 1, 2, 0.5, 1.4),   // 8.4 in at 23.8, 15.6 at the plate
    row("c", "Fastball", FB, 2, 1, -1, 3.5), row("d", "Slider", SL, 2, 2, 1, 1.0),    // 4.6 in at 23.8, 38 at the plate: the better tunnel
    row("e", "Fastball", FB, 3, 1, 0, 2.6), row("f", "Fastball", FB, 3, 2, 0, 2.6),   // same type, excluded by default
  ];
  it("ranks the tight-then-far pair first and skips same-type pairs", () => {
    const out = bestPairs(rows, { mode: "consecutive" });
    expect(out.map((p) => p.anchor.id + p.next.id)).toEqual(["cd", "ab"]);
    expect(out[0].ratio).toBeCloseTo(out[0].plateSep / out[0].decisionSep, 6);
    expect(out[0].ratio).toBeGreaterThan(out[1].ratio);
    expect(out[0].gap).toBe(0);
  });
  it("includes same-type pairs on request", () => {
    expect(bestPairs(rows, { mode: "consecutive", sameType: true }).some((p) => p.anchor.id === "e")).toBe(true);
  });
  it("any-two mode pairs across at-bats with the earlier pitch as anchor", () => {
    const out = bestPairs(rows, { mode: "any", anchorType: "Fastball", nextType: "Slider" });
    expect(out.length).toBe(3); // a→b, a→d, c→d: the only fastballs thrown before a slider
    for (const p of out) expect(p.anchor.type).toBe("Fastball");
    expect(out.some((p) => p.gap === null)).toBe(true);
  });
  it("handles a big selection quickly", () => {
    const big: PitchRow[] = [];
    for (let i = 0; i < 1500; i++) big.push(row(`p${i}`, i % 2 ? "Slider" : "Fastball", i % 2 ? SL : FB, Math.floor(i / 5), i % 5 + 1, (i % 7) / 4 - 0.75, 1.5 + (i % 9) / 4));
    const t = performance.now();
    const out = bestPairs(big, { mode: "any" });
    expect(out.length).toBe(30);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
