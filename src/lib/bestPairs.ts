import { DECISION_X, PLATE_X, posAtDist, type Point } from "./physics";
import type { PitchRow } from "./types";

export type PairMode = "consecutive" | "any";

export interface ScoredPair {
  anchor: PitchRow;
  next: PitchRow;
  decisionSep: number;   // in, at 23.8 ft
  plateSep: number;      // in, at the plate's front edge
  ratio: number;         // plateSep / max(decisionSep, floor): the tunnel score
  gap: number | null;    // pitches between them in the at-bat (0 = back-to-back), null when from different at-bats
}

export interface BestPairOptions {
  mode: PairMode;
  sameType?: boolean;      // include pairs of the same pitch type (default false)
  anchorType?: string;     // restrict the first pitch's type
  nextType?: string;       // restrict the second pitch's type
  limit?: number;          // rows to return (default 30)
  floorIn?: number;        // decision-point floor so a near-zero gap can't blow the ratio up (default 1 in)
  minPlateIn?: number;     // ignore pairs that end up closer than this at the plate (default 0)
}

const sep = (a: Point, b: Point) => 12 * Math.hypot(a.side - b.side, a.height - b.height);

/**
 * Score pairs of real pitches by how well they tunnel: tight at 23.8 ft, far apart at the plate.
 * "consecutive" = back-to-back in the same at-bat (as thrown, in order). "any" = every two pitches
 * in the selection, either order resolved so the earlier-thrown one is the anchor.
 */
export function bestPairs(rows: PitchRow[], o: BestPairOptions): ScoredPair[] {
  const floor = o.floorIn ?? 1, minPlate = o.minPlateIn ?? 0, limit = o.limit ?? 30;
  // Precompute both positions once per pitch so the any-two search is plain arithmetic.
  const pts = rows.map((r) => ({ r, d: posAtDist(r.coeffs, DECISION_X), p: posAtDist(r.coeffs, PLATE_X) }))
    .filter((x): x is { r: PitchRow; d: Point; p: Point } => !!x.d && !!x.p);
  const okTypes = (a: PitchRow, b: PitchRow) =>
    (o.sameType || a.type !== b.type) && (!o.anchorType || a.type === o.anchorType) && (!o.nextType || b.type === o.nextType);
  const out: ScoredPair[] = [];
  const push = (a: typeof pts[number], b: typeof pts[number], gap: number | null) => {
    const dS = sep(a.d, b.d), pS = sep(a.p, b.p);
    if (pS < minPlate) return;
    out.push({ anchor: a.r, next: b.r, decisionSep: dS, plateSep: pS, ratio: pS / Math.max(dS, floor), gap });
  };

  if (o.mode === "consecutive") {
    const byAb = new Map<string, typeof pts>();
    for (const x of pts) {
      if (x.r.pa == null || x.r.pitchNo == null) continue;
      const k = `${x.r.game}|${x.r.inning}|${x.r.half}|${x.r.pa}`;
      (byAb.get(k) ?? byAb.set(k, []).get(k)!).push(x);
    }
    for (const ab of byAb.values()) {
      ab.sort((a, b) => (a.r.pitchNo ?? 0) - (b.r.pitchNo ?? 0));
      for (let i = 1; i < ab.length; i++) {
        const a = ab[i - 1], b = ab[i];
        if ((b.r.pitchNo ?? 0) - (a.r.pitchNo ?? 0) !== 1 || !okTypes(a.r, b.r)) continue;
        push(a, b, 0);
      }
    }
  } else {
    // Earlier-thrown pitch is the anchor; sort by time so i < j means a before b.
    const sorted = [...pts].sort((a, b) => (a.r.utc ?? a.r.date).localeCompare(b.r.utc ?? b.r.date));
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i], b = sorted[j];
      if (!okTypes(a.r, b.r)) continue;
      const sameAb = a.r.game === b.r.game && a.r.inning === b.r.inning && a.r.half === b.r.half && a.r.pa === b.r.pa && a.r.pa != null;
      push(a, b, sameAb && a.r.pitchNo != null && b.r.pitchNo != null ? (b.r.pitchNo - a.r.pitchNo - 1) : null);
    }
  }
  out.sort((x, y) => y.ratio - x.ratio);
  return out.slice(0, limit);
}
