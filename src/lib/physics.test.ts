import { describe, expect, it } from "vitest";
import data from "../../public/data/pitchers.json";
import {
  aimAt, DECISION_X, pairGeometry, PLATE_X, posAtDist, posAtTime, releaseSpeedFtS, timeAtDist, type Coeffs,
} from "./physics";

const pitches = (data as { pitchers: { pitches: { type: string; coeffs: Coeffs }[] }[] }).pitchers.flatMap((p) => p.pitches);
const sides = [-1.25, -0.5, 0, 0.5, 1.25];
const heights = [1.0, 2.0, 3.0, 4.0];

describe("trajectory geometry", () => {
  it("finds the time the ball reaches a distance, and the position there matches", () => {
    for (const p of pitches) {
      for (const d of [PLATE_X, DECISION_X, 40]) {
        const t = timeAtDist(p.coeffs, d)!;
        expect(t).toBeGreaterThan(0);
        expect(posAtTime(p.coeffs, t).dist).toBeCloseTo(d, 9);
      }
    }
  });

  it("aims every pitch at every target to within 0.001 in, keeping release speed", () => {
    for (const p of pitches) {
      for (const s of sides) for (const h of heights) {
        const c = aimAt(p.coeffs, s, h);
        const plate = posAtDist(c, PLATE_X)!;
        expect(Math.abs(plate.side - s) * 12).toBeLessThan(1e-3);
        expect(Math.abs(plate.height - h) * 12).toBeLessThan(1e-3);
        expect(releaseSpeedFtS(c)).toBeCloseTo(releaseSpeedFtS(p.coeffs), 6);
        // release point and movement are untouched
        expect([c.Xc0, c.Yc0, c.Zc0, c.Xc2, c.Yc2, c.Zc2]).toEqual(
          [p.coeffs.Xc0, p.coeffs.Yc0, p.coeffs.Zc0, p.coeffs.Xc2, p.coeffs.Yc2, p.coeffs.Zc2]);
      }
    }
  });

  it("gives zero separation for the same pitch at the same target", () => {
    const c = aimAt(pitches[0].coeffs, 0.5, 2.0);
    const g = pairGeometry(c, c)!;
    expect(g.decisionSep).toBeCloseTo(0, 9);
    expect(g.plateSep).toBeCloseTo(0, 9);
  });

  it("plate separation equals the distance between the two targets", () => {
    const a = aimAt(pitches[0].coeffs, 0.5, 1.5);
    const b = aimAt(pitches[1].coeffs, -0.25, 2.5);
    const g = pairGeometry(a, b)!;
    expect(g.plateSep).toBeCloseTo(12 * Math.hypot(0.75, 1.0), 3);
  });

  it("puts the decision point 23.8 ft in front of the plate", () => {
    expect(DECISION_X - PLATE_X).toBeCloseTo(23.8, 12);
  });
});
