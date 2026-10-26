import { aimAt, pairGeometry, type Coeffs, type PairGeometry } from "./physics";

// Plate-location grid, 3 in apart, covering the zone and a ball's-width chase ring.
export const SIDES = Array.from({ length: 11 }, (_, i) => -1.25 + i * 0.25);
export const HEIGHTS = Array.from({ length: 13 }, (_, i) => 1.0 + i * 0.25);

// Approximate rulebook zone: plate width plus a ball on each edge, 1.5-3.5 ft tall.
export const ZONE = { halfWidth: 0.83, bottom: 1.5, top: 3.5 };

export interface Loc { side: number; height: number }

export type HeatMetric = "decision" | "late" | "plate";

/** The two ways the grid can be shaded ("plate" is still computed for the charts, but not offered as shading). */
export const HEAT_METRICS: Record<HeatMetric, { label: string; better: "low" | "high"; help: string }> = {
  decision: { label: "Tunnel", better: "low", help: "How far apart the two pitches are at 23.8 ft, where the hitter has to decide. Closer is better: green = they look like the same pitch." },
  late: { label: "Late break", better: "high", help: "How much the two pitches split after 23.8 ft (apart at the plate minus apart at 23.8 ft). More is better: green = they look the same, then end up far apart." },
  plate: { label: "Apart at the plate", better: "high", help: "How far apart the two pitches end up." },
};
export const HEAT_CHOICES: HeatMetric[] = ["decision", "late"];

export interface Cell extends Loc { geo: PairGeometry }

/** Every next-pitch location, measured against the last pitch as thrown. */
export function nextPitchCells(last: Coeffs, next: Coeffs): Cell[] {
  const cells: Cell[] = [];
  for (const height of HEIGHTS) for (const side of SIDES) {
    const geo = pairGeometry(last, aimAt(next, side, height));
    if (geo) cells.push({ side, height, geo });
  }
  return cells;
}

export const metricValue = (g: PairGeometry, m: HeatMetric) =>
  m === "decision" ? g.decisionSep : m === "plate" ? g.plateSep : g.lateSep;

/**
 * Provisional best spot until the outcome model exists: the location that ends
 * farthest from the last pitch at the plate while staying within `maxDecisionIn`
 * of it at 23.8 ft. If nothing qualifies, the tightest tunnel.
 */
export function provisionalBest(cells: Cell[], maxDecisionIn: number): Cell | null {
  const ok = cells.filter((c) => c.geo.decisionSep <= maxDecisionIn);
  if (ok.length) return ok.reduce((a, b) => (b.geo.plateSep > a.geo.plateSep ? b : a));
  return cells.reduce<Cell | null>((a, b) => (!a || b.geo.decisionSep < a.geo.decisionSep ? b : a), null);
}

export const sameLoc = (a: Loc, b: Loc) => Math.abs(a.side - b.side) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;

/** The location where the next pitch stays closest to the last pitch at 23.8 ft. */
export function tightest(cells: Cell[]): Cell | null {
  return cells.reduce<Cell | null>((a, b) => (!a || b.geo.decisionSep < a.geo.decisionSep ? b : a), null);
}
