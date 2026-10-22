import { describe, expect, it } from "vitest";
import { countOutcomes } from "./outcomes";
import type { PitchRow } from "./types";

const p = (call: string, side = 0, height = 2.5, result: string | null = null, ev: number | null = null): PitchRow => ({
  id: Math.random().toString(), date: "2026-03-01", game: "g", opponent: "X", season: "2026", type: "Slider", velo: 82, ivb: 2, hb: -6,
  spin: 2400, side, height, call, result, ev, coeffs: { Xc0: 0, Xc1: 0, Xc2: 0, Yc0: 0, Yc1: 0, Yc2: 0, Zc0: 0, Zc1: 0, Zc2: 0 },
});

describe("countOutcomes", () => {
  it("counts swings, whiffs, chases and results", () => {
    const o = countOutcomes([
      p("StrikeSwinging", 1.5, 1.0, "K"),          // chase + whiff, strikeout
      p("BallCalled", 1.5, 1.0),                   // out of zone, take
      p("StrikeCalled"),                           // in zone, called strike
      p("FoulBallNotFieldable"),                   // contact
      p("InPlay", 0, 2.5, "Double", 101),          // contact, hard hit, double
      p("InPlay", 0, 2.5, "Out", 80),              // contact, out
      p("BallCalled", 2, 3, "BB"),                 // walk
    ]);
    expect(o.swings).toBe(4); expect(o.whiffs).toBe(1); expect(o.whiffPct).toBeCloseTo(0.25);
    expect(o.outOfZone).toBe(3); expect(o.chases).toBe(1); expect(o.chasePct).toBeCloseTo(1 / 3);
    expect(o.contactPct).toBeCloseTo(0.75);
    expect(o.calledStrikePct).toBeCloseTo(1 / 3);
    expect(o.ev).toBeCloseTo(90.5); expect(o.hardHitPct).toBeCloseTo(0.5);
    expect(o.pa).toBe(4); expect(o.ab).toBe(3); expect(o.avg).toBeCloseTo(1 / 3); expect(o.slg).toBeCloseTo(2 / 3);
    expect(o.obp).toBeCloseTo(2 / 4); expect(o.kPct).toBeCloseTo(0.25); expect(o.bbPct).toBeCloseTo(0.25);
  });
});
