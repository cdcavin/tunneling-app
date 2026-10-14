// Builds public/data/pitchers.json with made-up pitchers so the app can be previewed
// without any real team data. Run: npm run sample-data
//
// Each pitcher gets a few hundred pitches over several outings. Every pitch is built
// from a per-type shape plus pitch-to-pitch noise, then aimed at a scattered target.
import { writeFileSync } from "node:fs";
import { aimAt, PLATE_X, type Coeffs } from "../src/lib/physics.ts";
import type { DataFile, Pitcher, PitchRow } from "../src/lib/types.ts";

const G = 32.174;

// Deterministic random numbers so the file is the same every run.
let seed = 20261014;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => { const u = rand() || 1e-9, v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

interface Spec { type: string; velo: number; ivb: number; hb: number; spin: number; share: number }

function buildCoeffs(velo: number, ivb: number, hb: number, relHeight: number, relSide: number, extension: number): Coeffs {
  const v = velo / 0.681818;
  const x0 = 60.5 - extension;
  const tFlight = (x0 - PLATE_X) / (0.93 * v);
  const raw: Coeffs = {
    Xc0: x0, Xc1: -v, Xc2: 0.5 * 0.0016 * v * v,
    Yc0: relHeight, Yc1: 0, Yc2: 0.5 * (-G + (2 * ivb / 12) / tFlight ** 2),
    Zc0: -relSide, Zc1: 0, Zc2: -0.5 * ((2 * hb / 12) / tFlight ** 2),
  };
  return raw;
}

const OPPONENTS = ["Intrasquad", "Pitt", "Penn State", "Kansas", "TCU", "Baylor"];
const CALLS = ["BallCalled", "StrikeCalled", "StrikeSwinging", "FoulBall", "InPlay"];

function pitcher(id: string, name: string, throws: "Right" | "Left", rel: [number, number, number], specs: Spec[]): Pitcher {
  const [h, side, ext] = rel;
  const pitches: PitchRow[] = [];
  const outings = 6;
  let n = 0;
  for (let o = 0; o < outings; o++) {
    const date = `2026-${String(2 + Math.floor(o / 2)).padStart(2, "0")}-${String(6 + (o % 2) * 14).padStart(2, "0")}`;
    const opponent = OPPONENTS[o % OPPONENTS.length];
    const count = 45 + Math.floor(rand() * 30);
    for (let i = 0; i < count; i++) {
      let r = rand();
      const s = specs.find((x) => (r -= x.share) <= 0) ?? specs[specs.length - 1];
      const velo = s.velo + gauss() * 1.1, ivb = s.ivb + gauss() * 1.8, hb = s.hb + gauss() * 1.8;
      const relH = h + gauss() * 0.08, relS = side + gauss() * 0.08;
      const target = { side: gauss() * 0.7, height: 2.4 + gauss() * 0.8 };
      const coeffs = aimAt(buildCoeffs(velo, ivb, hb, relH, relS, ext), target.side, target.height);
      pitches.push({
        id: `${id}-${++n}`, date, game: `${date}-${opponent.replace(/\s/g, "")}`, opponent, season: o < 2 ? "Fall 2025" : "Spring 2026",
        home: o % 2 === 0, inning: 1 + Math.floor(i / 15), half: "Top", pa: 1 + Math.floor((i % 15) / 5), pitchNo: 1 + (i % 5), type: s.type,
        season: o < 3 ? "Fall 2025" : "Spring 2026", home: opponent === "Intrasquad" || o % 2 === 0,
        inning: 1 + Math.floor(i / 18), half: "Top", pa: 1 + Math.floor((i % 18) / 4.5), pitchNo: 1 + (i % 5),
        velo: Math.round(velo * 10) / 10, ivb: Math.round(ivb * 10) / 10, hb: Math.round(hb * 10) / 10,
        spin: Math.round(s.spin + gauss() * 80), side: Math.round(target.side * 100) / 100, height: Math.round(target.height * 100) / 100,
        call: CALLS[Math.floor(rand() * CALLS.length)], coeffs,
      });
    }
  }
  return { id, name, throws, season: "Spring 2026", pitches };
}

const data: DataFile = {
  generated: new Date().toISOString().slice(0, 10),
  dataThrough: "sample",
  sample: true,
  pitchers: [
    pitcher("sample-1", "Sample RHP, low slot", "Right", [4.9, 2.1, 6.0], [
      { type: "Sinker", velo: 89, ivb: 5, hb: 17, spin: 2150, share: 0.48 },
      { type: "Changeup", velo: 81, ivb: -1, hb: 15, spin: 1600, share: 0.25 },
      { type: "Slider", velo: 79, ivb: 2, hb: -11, spin: 2250, share: 0.23 },
      { type: "Cutter", velo: 84, ivb: 6, hb: 3, spin: 2200, share: 0.04 },
    ]),
    pitcher("sample-2", "Sample RHP, over the top", "Right", [6.3, 1.2, 6.3], [
      { type: "Four-Seam", velo: 93, ivb: 18, hb: 8, spin: 2400, share: 0.5 },
      { type: "Curveball", velo: 77, ivb: -14, hb: -9, spin: 2650, share: 0.21 },
      { type: "Changeup", velo: 84, ivb: 7, hb: 14, spin: 1700, share: 0.12 },
      { type: "Slider", velo: 84, ivb: 2, hb: -5, spin: 2450, share: 0.17 },
    ]),
    pitcher("sample-3", "Sample LHP", "Left", [5.8, -2.0, 6.1], [
      { type: "Four-Seam", velo: 90, ivb: 17, hb: -11, spin: 2250, share: 0.49 },
      { type: "Slider", velo: 79, ivb: -1, hb: 7, spin: 2350, share: 0.23 },
      { type: "Changeup", velo: 82, ivb: 4, hb: -15, spin: 1650, share: 0.2 },
      { type: "Curveball", velo: 75, ivb: -12, hb: 12, spin: 2500, share: 0.08 },
    ]),
  ],
};

writeFileSync("public/data/pitchers.json", JSON.stringify(data) + "\n");
console.log(`wrote ${data.pitchers.length} sample pitchers, ${data.pitchers.reduce((s, p) => s + p.pitches.length, 0)} pitches`);
