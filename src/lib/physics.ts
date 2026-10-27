// Pitch flight geometry from Trackman's quadratic trajectory fit.
//
// Trackman gives each pitch nine numbers: position(t) = c0 + c1*t + c2*t^2 on three axes,
// with t = seconds after release.
//   X = distance from the back tip of home plate (ft), decreasing toward the plate
//   Y = height above the ground (ft)
//   Z = side (ft), with the OPPOSITE sign of PlateLocSide / RelSide
//
// Everything in this app reports side in PlateLocSide's convention:
// positive = third-base side = the pitcher's right = the catcher's left.
//
// These conventions were checked against 193k D1 pitches: rebuilding release point,
// plate location and flight time from the fit matches Trackman's own columns to
// under 0.2 in / 0.2 ms at the 99th percentile.

export interface Coeffs {
  Xc0: number; Xc1: number; Xc2: number;
  Yc0: number; Yc1: number; Yc2: number;
  Zc0: number; Zc1: number; Zc2: number;
}

export interface Point {
  dist: number;   // ft from the back tip of the plate
  height: number; // ft
  side: number;   // ft, PlateLocSide convention
}

/** Where Trackman measures plate location: the front edge, 17 in from the back tip. */
export const PLATE_X = 17 / 12;
/** Decision point: 23.8 ft in front of the plate's front edge. */
export const DECISION_FT = 23.8;
export const DECISION_X = DECISION_FT + PLATE_X;

/** Seconds after release when the ball is `d` ft from the back of the plate. */
export function timeAtDist(c: Coeffs, d: number): number | null {
  const a = c.Xc2, b = c.Xc1, k = c.Xc0 - d;
  if (Math.abs(a) < 1e-12) {
    const t = -k / b;
    return t > 0 ? t : null;
  }
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const r = Math.sqrt(disc);
  const t1 = (-b - r) / (2 * a), t2 = (-b + r) / (2 * a);
  const lo = Math.min(t1, t2), hi = Math.max(t1, t2);
  // The ball is moving toward the plate, so the earlier non-negative root is the real one.
  // A tiny negative root is rounding at release (t = 0).
  if (lo >= -1e-9) return Math.max(lo, 0);
  return hi >= -1e-9 ? Math.max(hi, 0) : null;
}

export function posAtTime(c: Coeffs, t: number): Point {
  return {
    dist: c.Xc0 + c.Xc1 * t + c.Xc2 * t * t,
    height: c.Yc0 + c.Yc1 * t + c.Yc2 * t * t,
    side: -(c.Zc0 + c.Zc1 * t + c.Zc2 * t * t),
  };
}

export function posAtDist(c: Coeffs, d: number): Point | null {
  const t = timeAtDist(c, d);
  return t == null ? null : posAtTime(c, t);
}

export const releaseSpeedFtS = (c: Coeffs) => Math.hypot(c.Xc1, c.Yc1, c.Zc1);

/**
 * Re-aim a pitch at a plate location. Release point, release speed and movement
 * (the c2 terms) stay the pitcher's own; only the release direction changes.
 * Matches the R `aim()` used in the Colab grid test (0 in of aiming error).
 */
export function aimAt(c: Coeffs, side: number, height: number): Coeffs {
  const speed = releaseSpeedFtS(c);
  let vx = c.Xc1, vy = c.Yc1, vz = c.Zc1;
  for (let i = 0; i < 12; i++) {
    const t = timeAtDist({ ...c, Xc1: vx }, PLATE_X);
    if (t == null) break;
    vy = (height - c.Yc0 - c.Yc2 * t * t) / t;
    vz = (-side - c.Zc0 - c.Zc2 * t * t) / t;
    const rem = speed * speed - vy * vy - vz * vz;
    if (rem <= 0) break;
    vx = -Math.sqrt(rem);
  }
  return { ...c, Xc1: vx, Yc1: vy, Zc1: vz };
}

const sepInches = (a: Point, b: Point) => 12 * Math.hypot(a.side - b.side, a.height - b.height);

export interface PairGeometry {
  decisionSep: number;  // in, at 23.8 ft
  plateSep: number;     // in, at the plate
  lateSep: number;      // in, plate minus decision
  releaseSep: number;   // in
  flightTimeDiffMs: number; // next minus last, release to plate
  aDecision: Point; bDecision: Point;
  aPlate: Point; bPlate: Point;
}

export function pairGeometry(a: Coeffs, b: Coeffs): PairGeometry | null {
  const aD = posAtDist(a, DECISION_X), bD = posAtDist(b, DECISION_X);
  const tA = timeAtDist(a, PLATE_X), tB = timeAtDist(b, PLATE_X);
  if (!aD || !bD || tA == null || tB == null) return null;
  const aP = posAtTime(a, tA), bP = posAtTime(b, tB);
  const decisionSep = sepInches(aD, bD);
  const plateSep = sepInches(aP, bP);
  return {
    decisionSep,
    plateSep,
    lateSep: plateSep - decisionSep,
    releaseSep: sepInches(posAtTime(a, 0), posAtTime(b, 0)),
    flightTimeDiffMs: 1000 * (tB - tA),
    aDecision: aD, bDecision: bD, aPlate: aP, bPlate: bP,
  };
}

/** Separation (in) at evenly spaced distances from release to the plate. */
export interface SepSample { distFromPlate: number; sep: number; dv: number; dh: number }

/**
 * Separation over the flight, release to the plate's front edge. `sep` is the straight-line gap;
 * `dv` and `dh` are the vertical and horizontal parts, signed as second pitch minus first
 * (dv > 0: second pitch higher; dh > 0: second pitch toward the third-base side). Inches.
 */
export function separationCurve(a: Coeffs, b: Coeffs, n = 60): SepSample[] {
  const start = Math.min(a.Xc0, b.Xc0);
  const out: SepSample[] = [];
  for (let i = 0; i <= n; i++) {
    const d = start + (PLATE_X - start) * (i / n);
    const pa = posAtDist(a, d), pb = posAtDist(b, d);
    if (pa && pb) out.push({ distFromPlate: d - PLATE_X, sep: sepInches(pa, pb), dv: (pb.height - pa.height) * 12, dh: (pb.side - pa.side) * 12 });
  }
  return out;
}

/** Points along the flight, release to the plate's front edge, for drawing. */
export function trajectoryPoints(c: Coeffs, n = 120): Point[] {
  const tEnd = timeAtDist(c, PLATE_X);
  if (tEnd == null) return [];
  return Array.from({ length: n + 1 }, (_, i) => posAtTime(c, (i / n) * tEnd));
}

/**
 * Aim point: where the pitcher would have to aim if the pitch moved like his fastball.
 * A curveball that lands at the knees is "aimed" higher; the fastball's aim point is its location.
 */
export function aimPoint(c: Coeffs, fastball: Coeffs): Point | null {
  const t = timeAtDist(c, PLATE_X);
  if (t == null) return null;
  return posAtTime({ ...c, Yc2: fastball.Yc2, Zc2: fastball.Zc2 }, t);
}

export interface ShapeDelta { ivb: number; hb: number; velo: number } // in, in, mph

/**
 * Change a pitch's shape: add induced vertical break, horizontal break (Trackman sign,
 * + toward third) and velocity. Movement is turned into acceleration over the pitch's own
 * flight time; velocity scales the release velocity. Release point stays put.
 */
export function perturb(c: Coeffs, d: ShapeDelta): Coeffs {
  const t = timeAtDist(c, PLATE_X);
  if (t == null) return c;
  const v0 = releaseSpeedFtS(c);
  const k = (v0 + d.velo / 0.681818) / v0;
  return {
    ...c,
    Xc1: c.Xc1 * k, Yc1: c.Yc1 * k, Zc1: c.Zc1 * k,
    Xc2: c.Xc2 * k * k,                         // drag scales with speed squared
    Yc2: c.Yc2 + (d.ivb / 12) / (t * t),        // a = 2*s/t^2, c2 = a/2
    Zc2: c.Zc2 - (d.hb / 12) / (t * t),         // Z carries the opposite sign of side
  };
}

export interface Angles { vra: number; hra: number; vaa: number; haa: number }

/**
 * Release and approach angles (degrees) from the trajectory fit.
 *   VRA / VAA: up (+) or down (−) relative to level, out of the hand and crossing the front of the plate.
 *   HRA / HAA: toward the third-base side (+) or first-base side (−), the app's PlateLocSide convention.
 */
export function anglesOf(c: Coeffs): Angles | null {
  const tp = timeAtDist(c, PLATE_X);
  if (tp == null) return null;
  const at = (t: number) => {
    const vx = -(c.Xc1 + 2 * c.Xc2 * t);           // speed toward the plate, ft/s (positive)
    const vy = c.Yc1 + 2 * c.Yc2 * t;
    const vs = -(c.Zc1 + 2 * c.Zc2 * t);           // + = toward third base
    const deg = (r: number) => (r * 180) / Math.PI;
    return { v: deg(Math.atan2(vy, vx)), h: deg(Math.atan2(vs, vx)) };
  };
  const r = at(0), p = at(tp);
  return { vra: r.v, hra: r.h, vaa: p.v, haa: p.h };
}
