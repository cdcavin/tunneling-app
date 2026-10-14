// Builds public/data/pitchers.json with made-up pitchers so the app can be previewed
// without any real team data. Run: npm run sample-data
//
// Each pitch is built from plain inputs (velo, IVB, HB, release point) by turning the
// movement into constant accelerations, then aimed at the middle of the zone.
import { writeFileSync } from "node:fs";
import { aimAt, PLATE_X, type Coeffs } from "../src/lib/physics.ts";
import type { DataFile, Pitcher } from "../src/lib/types.ts";

const G = 32.174;

interface Spec { type: string; velo: number; ivb: number; hb: number; spin: number; n: number }

function buildCoeffs(s: Spec, relHeight: number, relSide: number, extension: number): Coeffs {
  const v = s.velo / 0.681818;                 // mph -> ft/s
  const x0 = 60.5 - extension;
  const tFlight = (x0 - PLATE_X) / (0.93 * v);  // rough flight time, drag included
  const aInducedV = (2 * s.ivb / 12) / tFlight ** 2;
  const aSide = (2 * s.hb / 12) / tFlight ** 2;
  const raw: Coeffs = {
    Xc0: x0, Xc1: -v, Xc2: 0.5 * 0.0016 * v * v,           // drag slows the ball down the X axis
    Yc0: relHeight, Yc1: 0, Yc2: 0.5 * (-G + aInducedV),
    Zc0: -relSide, Zc1: 0, Zc2: -0.5 * aSide,               // Z carries the opposite sign of side
  };
  return aimAt(raw, 0, 2.5);
}

function pitcher(id: string, name: string, throws: "Right" | "Left", rel: [number, number, number], specs: Spec[]): Pitcher {
  const [h, side, ext] = rel;
  return {
    id, name, throws, season: "Sample",
    pitches: specs.map((s) => ({ type: s.type, n: s.n, velo: s.velo, ivb: s.ivb, hb: s.hb, spin: s.spin, coeffs: buildCoeffs(s, h, side, ext) })),
  };
}

// RHP: + HB = arm side. LHP: arm side is negative HB.
const data: DataFile = {
  generated: new Date().toISOString().slice(0, 10),
  dataThrough: "sample",
  sample: true,
  pitchers: [
    pitcher("sample-1", "Sample RHP, low slot", "Right", [4.9, 2.1, 6.0], [
      { type: "Sinker", velo: 89, ivb: 5, hb: 17, spin: 2150, n: 560 },
      { type: "Changeup", velo: 81, ivb: -1, hb: 15, spin: 1600, n: 300 },
      { type: "Slider", velo: 79, ivb: 2, hb: -11, spin: 2250, n: 290 },
      { type: "Cutter", velo: 84, ivb: 6, hb: 3, spin: 2200, n: 40 },
    ]),
    pitcher("sample-2", "Sample RHP, over the top", "Right", [6.3, 1.2, 6.3], [
      { type: "Four-Seam", velo: 93, ivb: 18, hb: 8, spin: 2400, n: 620 },
      { type: "Curveball", velo: 77, ivb: -14, hb: -9, spin: 2650, n: 260 },
      { type: "Changeup", velo: 84, ivb: 7, hb: 14, spin: 1700, n: 150 },
      { type: "Slider", velo: 84, ivb: 2, hb: -5, spin: 2450, n: 210 },
    ]),
    pitcher("sample-3", "Sample LHP", "Left", [5.8, -2.0, 6.1], [
      { type: "Four-Seam", velo: 90, ivb: 17, hb: -11, spin: 2250, n: 580 },
      { type: "Slider", velo: 79, ivb: -1, hb: 7, spin: 2350, n: 280 },
      { type: "Changeup", velo: 82, ivb: 4, hb: -15, spin: 1650, n: 240 },
      { type: "Curveball", velo: 75, ivb: -12, hb: 12, spin: 2500, n: 90 },
    ]),
  ],
};

writeFileSync("public/data/pitchers.json", JSON.stringify(data, null, 1) + "\n");
console.log(`wrote ${data.pitchers.length} sample pitchers`);
