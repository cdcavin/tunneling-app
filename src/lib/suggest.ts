import { perturb, type Coeffs, type ShapeDelta } from "./physics";
import { nextPitchCells, provisionalBest, tightest, type Cell } from "./grid";

export interface Suggestion {
  delta: ShapeDelta;
  label: string;
  decisionSep: number;  // best achievable, in, at 23.8 ft
  plateSep: number;     // at that location
  cell: Cell;
}

const fmt = (v: number, unit: string, kill: string, add: string) =>
  `${v < 0 ? kill : add} ${Math.abs(v)} ${unit}`;

export function describe(d: ShapeDelta): string {
  const parts: string[] = [];
  if (d.ivb) parts.push(fmt(d.ivb, "in of vert", "Kill", "Add"));
  if (d.hb) parts.push(fmt(d.hb, "in of horz", "Cut", "Add"));
  if (d.velo) parts.push(fmt(d.velo, "mph", "Take off", "Add"));
  return parts.join(", ") || "As is";
}

/**
 * Try small shape changes to the next pitch and report the ones that tunnel best.
 * `objective` picks the location rule: tightest at 23.8 ft, or tight-then-far.
 */
export function suggestShapes(
  last: Coeffs, next: Coeffs, objective: "tightest" | "tightThenFar", maxDecisionIn: number,
): { current: Suggestion; best: Suggestion[] } {
  const evaluate = (delta: ShapeDelta): Suggestion | null => {
    const cells = nextPitchCells(last, perturb(next, delta));
    const cell = objective === "tightest" ? tightest(cells) : provisionalBest(cells, maxDecisionIn);
    if (!cell) return null;
    return { delta, label: describe(delta), decisionSep: cell.geo.decisionSep, plateSep: cell.geo.plateSep, cell };
  };
  const score = (s: Suggestion) => (objective === "tightest" ? -s.decisionSep : s.plateSep - 2 * s.decisionSep);

  const current = evaluate({ ivb: 0, hb: 0, velo: 0 })!;
  const singles: ShapeDelta[] = [];
  for (const v of [-6, -4, -2, 2, 4, 6]) { singles.push({ ivb: v, hb: 0, velo: 0 }); singles.push({ ivb: 0, hb: v, velo: 0 }); }
  for (const v of [-3, -2, -1, 1, 2, 3]) singles.push({ ivb: 0, hb: 0, velo: v });
  const combos: ShapeDelta[] = [];
  for (const ivb of [-4, 0, 4]) for (const hb of [-4, 0, 4]) for (const velo of [-2, 0, 2]) {
    if ([ivb, hb, velo].filter(Boolean).length >= 2) combos.push({ ivb, hb, velo });
  }
  const all = [...singles, ...combos].map(evaluate).filter((s): s is Suggestion => !!s && score(s) > score(current) + 0.05);
  all.sort((a, b) => score(b) - score(a));
  // Keep the best single-axis change per axis, then the best combo.
  const picked: Suggestion[] = [];
  for (const axis of ["ivb", "hb", "velo"] as const) {
    const s = all.find((x) => x.delta[axis] !== 0 && Object.entries(x.delta).filter(([k, v]) => k !== axis && v !== 0).length === 0);
    if (s) picked.push(s);
  }
  const combo = all.find((x) => Object.values(x.delta).filter(Boolean).length >= 2);
  if (combo) picked.push(combo);
  picked.sort((a, b) => score(b) - score(a));
  return { current, best: picked };
}
