import { PLATE_X, timeAtDist, type Coeffs } from "./physics";

/**
 * Spin direction and an efficiency estimate from the trajectory fit.
 *
 * Tilt: the direction the spin pushes the ball (the Magnus acceleration, i.e. acceleration minus gravity minus the
 * drag part along the flight), seen from the pitcher: 12:00 = straight up (backspin), 3:00 = the pitcher's right
 * (third-base side). Same convention as Trackman's SpinAxis (180° = 12:00), which Trackman also infers from movement.
 *
 * Efficiency: how much spin it takes to make that push (Nathan's lift model, C_L = S / (0.4 + 2.32 S), S = r·ω / v),
 * divided by the measured spin rate. Gyro = acos(efficiency). An estimate: seam effects and air density move it.
 */
const G = 32.174;                 // ft/s²
const K = 0.005314;               // ½ρA/m per ft (ρ 0.074 lb/ft³, r 0.121 ft, m 0.3203 lb)
const R_BALL = 0.121;             // ft

export interface SpinProfile {
  axisDeg: number;     // Trackman SpinAxis convention, 0..360 (180 = 12:00)
  clock: string;       // "1:15"
  tiltRad: number;     // clock hand angle from 12:00, clockwise from the pitcher's view
  eff: number | null;  // 0..1
  gyroDeg: number | null;
}

export function spinProfile(c: Coeffs, spinRpm: number | null): SpinProfile | null {
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
    const S = cl < 0.42 ? (0.4 * cl) / (1 - 2.32 * cl) : 1;
    const rpmT = ((S * vv) / R_BALL) * (60 / (2 * Math.PI));
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
