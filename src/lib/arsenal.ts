import { PLATE_X, posAtDist, type Coeffs } from "./physics";
import type { Loc } from "./grid";

/** Where a pitch's average trajectory actually crosses the front of the plate. */
export function realLoc(c: Coeffs): Loc {
  const p = posAtDist(c, PLATE_X);
  if (!p) return { side: 0, height: 2.5 };
  // Keep inside the slider ranges: a few-pitch average can cross below ground or far off the plate.
  return { side: Math.max(-2, Math.min(2, p.side)), height: Math.max(0.5, Math.min(5, p.height)) };
}

export interface Grade { cls: "elite" | "good" | "avg" | "poor"; label: string }

/** Same grade bands as the Queens app: separation at the decision point, in inches. */
export function tunnelGrade(inches: number | null | undefined): Grade | null {
  if (inches == null) return null;
  if (inches <= 3) return { cls: "elite", label: "Elite" };
  if (inches <= 6) return { cls: "good", label: "Good" };
  if (inches <= 10) return { cls: "avg", label: "Avg" };
  return { cls: "poor", label: "Poor" };
}
