import { anglesOf } from "./physics";
import { countOutcomes, inZone } from "./outcomes";
import type { PitchRow } from "./types";

/** Front of the rubber, ft from the back point of the plate (Trackman's x origin). Extension = this − release x. */
const RUBBER_X = 60.5;

/** Release point from the trajectory fit (t = 0 is release): height, side (PlateLocSide convention), extension. */
export const releaseOf = (r: PitchRow) => ({ height: r.coeffs.Yc0, side: -r.coeffs.Zc0, extension: RUBBER_X - r.coeffs.Xc0 });

export interface ArsenalLine {
  type: string;
  n: number; share: number;
  velo: number; ivb: number; hb: number; spin: number | null;
  vaa: number | null; haa: number | null;
  relHeight: number; relSide: number; extension: number;
  shapePlus: number | null;            // not hooked up yet
  zonePct: number | null; chasePct: number | null; whiffPct: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** One line per pitch type, most used first. */
export function arsenalLines(rows: PitchRow[]): ArsenalLine[] {
  const by = new Map<string, PitchRow[]>();
  for (const r of rows) { const g = by.get(r.type); if (g) g.push(r); else by.set(r.type, [r]); }
  const out: ArsenalLine[] = [];
  for (const [type, g] of by) {
    const ang = g.map((r) => anglesOf(r.coeffs)).filter((a): a is NonNullable<typeof a> => !!a);
    const rel = g.map(releaseOf);
    const o = countOutcomes(g);
    out.push({
      type, n: g.length, share: g.length / rows.length,
      velo: mean(g.map((r) => r.velo))!, ivb: mean(g.map((r) => r.ivb))!, hb: mean(g.map((r) => r.hb))!,
      spin: mean(g.filter((r) => r.spin != null).map((r) => r.spin!)),
      vaa: mean(ang.map((a) => a.vaa)), haa: mean(ang.map((a) => a.haa)),
      relHeight: mean(rel.map((x) => x.height))!, relSide: mean(rel.map((x) => x.side))!, extension: mean(rel.map((x) => x.extension))!,
      shapePlus: null,
      zonePct: g.length ? g.filter(inZone).length / g.length : null,
      chasePct: o.chasePct, whiffPct: o.whiffPct,
    });
  }
  return out.sort((a, b) => b.n - a.n);
}

/** Heatmap layers. Hard = exit velo ≥ 95 mph (the Statcast hard-hit line); soft = under 80 mph. */
export type HeatLayer = "location" | "whiffs" | "hard" | "soft";
export const HARD_EV = 95, SOFT_EV = 80;
const isInPlay = (r: PitchRow) => (r.call ?? "").toLowerCase().replace(/\s+/g, "") === "inplay";
export const LAYERS: Record<HeatLayer, { label: string; help: string; keep: (r: PitchRow) => boolean }> = {
  location: { label: "Location", help: "Where his pitches of this type end up.", keep: () => true },
  whiffs: { label: "Whiffs", help: "Where the swinging strikes on this pitch were.", keep: (r) => (r.call ?? "").toLowerCase() === "strikeswinging" },
  hard: { label: "Hard contact", help: `Balls in play hit ${HARD_EV}+ mph.`, keep: (r) => isInPlay(r) && r.ev != null && r.ev >= HARD_EV },
  soft: { label: "Soft contact", help: `Balls in play hit under ${SOFT_EV} mph.`, keep: (r) => isInPlay(r) && r.ev != null && r.ev < SOFT_EV },
};

/** Gaussian kernel density over a 1-D grid. Bandwidth by Silverman's rule (min 0.4) unless given. */
export function kde1d(xs: number[], grid: number[], bw?: number): number[] {
  if (!xs.length) return grid.map(() => 0);
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  const h = bw ?? Math.max(0.4, 1.06 * (sd || 1) * xs.length ** -0.2);
  const k = 1 / (xs.length * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => xs.reduce((s, x) => s + Math.exp(-0.5 * ((g - x) / h) ** 2), 0) * k);
}

/** A circle drawn on the strike zone, in feet (PlateLocSide / PlateLocHeight). */
export interface Circle { side: number; height: number; r: number }
export const inCircle = (p: PitchRow, c: Circle) => (p.side - c.side) ** 2 + (p.height - c.height) ** 2 <= c.r ** 2;

export type HandF = "all" | "Left" | "Right";
export type CountF = "all" | "first" | "ahead" | "even" | "behind" | "two";
export type ResultF = "all" | "whiffs" | "called" | "inplay";
export interface Situation { hand: HandF; count: CountF; result: ResultF }
export const ANY_SITUATION: Situation = { hand: "all", count: "all", result: "all" };

export const HAND_CHOICES: [HandF, string][] = [["all", "All"], ["Left", "vs LHH"], ["Right", "vs RHH"]];
export const COUNT_CHOICES: [CountF, string, string][] = [
  ["all", "All", "Every count"], ["first", "1st pitch", "0-0"], ["ahead", "Ahead", "More strikes than balls (pitcher ahead)"],
  ["even", "Even", "Same balls and strikes, 0-0 included"], ["behind", "Behind", "More balls than strikes (pitcher behind)"], ["two", "2 strikes", "Any count with 2 strikes"],
];
export const RESULT_CHOICES: [ResultF, string][] = [["all", "All"], ["whiffs", "Whiffs"], ["called", "Called strikes"], ["inplay", "In play"]];

const callOf = (p: PitchRow) => (p.call ?? "").toLowerCase().replace(/\s+/g, "");
function countOk(p: PitchRow, f: CountF): boolean {
  if (f === "all") return true;
  const m = (p.count ?? "").match(/^(\d)-(\d)$/);
  if (!m) return false;
  const b = +m[1], s = +m[2];
  return f === "first" ? b === 0 && s === 0 : f === "ahead" ? s > b : f === "even" ? s === b : f === "behind" ? b > s : s === 2;
}
export function applySituation(rows: PitchRow[], s: Situation): PitchRow[] {
  return rows.filter((p) =>
    (s.hand === "all" || p.batterSide === s.hand) && countOk(p, s.count) &&
    (s.result === "all" || (s.result === "whiffs" ? callOf(p) === "strikeswinging" : s.result === "called" ? callOf(p) === "strikecalled" : callOf(p) === "inplay")));
}
