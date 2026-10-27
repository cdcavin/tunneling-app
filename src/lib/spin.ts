import { PLATE_X, timeAtDist, type Coeffs } from "./physics";

/**
 * Spin direction and an efficiency estimate from the trajectory fit.
 *
 * Tilt: the direction the spin pushes the ball (the Magnus acceleration, i.e. acceleration minus gravity minus the
 * drag part along the flight), seen from the pitcher: 12:00 = straight up (backspin), 3:00 = the pitcher's right
 * (third-base side). Same convention as Trackman's SpinAxis (180° = 12:00), which Trackman also infers from movement.
 *
 * Efficiency (Nathan, "Determining the 3D spin axis from Statcast data", fit revised May 2020):
 *   C_L = a_M / (K v²), with K = ½ρA/m from the air density at that game;
 *   C_L = A (1 − e^(−B·S)), A = 0.336, B = 6.041, S = r·ω_T / v  →  ω_T = v / (r·B) · ln(A / (A − C_L));
 *   efficiency = ω_T / total spin, gyro = acos(efficiency).
 * Nathan puts a single pitch at about ±20% on ω_T (trajectory noise), and movement not caused by spin (seam-shifted
 * wake) is counted as spin, so sinkers and changeups read high. Averages over many pitches are much steadier.
 */
const G = 32.174;                 // ft/s²
const R_BALL = 0.1210;            // ft (9.125 in circumference)
const AREA = Math.PI * R_BALL * R_BALL, MASS = 0.3203;   // ft², lb (5.125 oz)
const CL_A = 0.336, CL_B = 6.041;
/** Standard air when a game's weather isn't known: 70°F, sea level, 50% humidity (Nathan's reference). */
export const STANDARD_AIR = 0.0745;   // lb/ft³
export const kFromDensity = (rhoLbFt3: number) => (0.5 * rhoLbFt3 * AREA) / MASS;

export interface SpinProfile {
  axisDeg: number;     // Trackman SpinAxis convention, 0..360 (180 = 12:00)
  clock: string;       // "1:15"
  tiltRad: number;     // clock hand angle from 12:00, clockwise from the pitcher's view
  eff: number | null;  // 0..1
  gyroDeg: number | null;
}

export function spinProfile(c: Coeffs, spinRpm: number | null, airDensity = STANDARD_AIR): SpinProfile | null {
  const K = kFromDensity(airDensity);
  const tp = timeAtDist(c, PLATE_X);
  if (tp == null) return null;
  const tm = tp / 2;
  // velocity at mid-flight; Trackman frame: X toward the plate is negative, Y up, Z = −side
  const v = [c.Xc1 + 2 * c.Xc2 * tm, c.Yc1 + 2 * c.Yc2 * tm, c.Zc1 + 2 * c.Zc2 * tm];
  const a = [2 * c.Xc2, 2 * c.Yc2 + G, 2 * c.Zc2];          // acceleration without gravity
  const vv = Math.hypot(v[0], v[1], v[2]);
  const along = (a[0] * v[0] + a[1] * v[1] + a[2] * v[2]) / (vv * vv);
  const m = [a[0] - along * v[0], a[1] - along * v[1], a[2] - along * v[2]];   // Magnus: drag removed
  const up = m[1], right = -m[2];                            // pitcher's right = third-base side = −Z
  const tiltRad = Math.atan2(right, up);
  const axisDeg = (((180 + (tiltRad * 180) / Math.PI) % 360) + 360) % 360;
  const mins = Math.round((((tiltRad / (2 * Math.PI)) * 720) % 720 + 720) % 720 / 15) * 15;
  const h = Math.floor(mins / 60), mm = mins % 60;
  const clock = `${h === 0 ? 12 : h}:${String(mm).padStart(2, "0")}`;
  let eff: number | null = null, gyroDeg: number | null = null;
  if (spinRpm && spinRpm > 0) {
    const cl = Math.hypot(m[0], m[1], m[2]) / (K * vv * vv);
    const wT = cl >= CL_A ? Infinity : (vv / (R_BALL * CL_B)) * Math.log(CL_A / (CL_A - cl));   // rad/s
    const rpmT = (wT * 60) / (2 * Math.PI);
    eff = Math.max(0, Math.min(1, rpmT / spinRpm));
    gyroDeg = (Math.acos(eff) * 180) / Math.PI;
  }
  return { axisDeg, clock, tiltRad, eff, gyroDeg };
}

/** Unit spin axis seen from the pitcher (x = right, y = up, z = toward the plate) from tilt and gyro. */
export function axisVector(tiltRad: number, gyroDeg: number): [number, number, number] {
  const mx = Math.sin(tiltRad), my = Math.cos(tiltRad);       // push direction
  const g = (gyroDeg * Math.PI) / 180;
  return [-my * Math.cos(g), mx * Math.cos(g), Math.sin(g)];  // transverse part ⟂ push, plus the gyro part along flight
}

/** 100 = identical spin axis, 0 = 45° or more apart. */
export function spinSimilarity(a: SpinProfile, b: SpinProfile) {
  if (a.gyroDeg == null || b.gyroDeg == null) return null;
  const A = axisVector(a.tiltRad, a.gyroDeg), B = axisVector(b.tiltRad, b.gyroDeg);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const apart = (Math.acos(dot) * 180) / Math.PI;
  let tiltMin = Math.abs(((a.tiltRad - b.tiltRad) / (2 * Math.PI)) * 720) % 720;
  if (tiltMin > 360) tiltMin = 720 - tiltMin;
  return { score: Math.max(0, Math.round(100 * (1 - apart / 45))), apart, tiltMin, gyroGap: Math.abs(a.gyroDeg - b.gyroDeg) };
}
