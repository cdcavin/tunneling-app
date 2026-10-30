import { PLATE_X, type Coeffs } from "./physics";

/**
 * What the air does to a pitch and to a fly ball.
 *
 * Pitch: built from his own pitch, not a textbook ball. Trackman's fit gives the pitch's acceleration; minus gravity,
 * the part along the flight is drag and the rest is the spin (Magnus) force. Both are aerodynamic, so both scale with
 * air density (force ∝ ρ·v²). The pitch is re-flown from the same release, same speed and same spin in air of another
 * density, step by step, and we read off plate velo, flight time and break.
 *   Break = where it crosses the plate minus where gravity alone would have taken it in the same flight time (Trackman's
 *   induced vertical break and horizontal break), so it includes the small push drag gives a descending ball.
 * Spin rate and spin axis don't change with weather (decay over 0.4 s is under 1%), so only break and velo move.
 *
 * Fly ball: Nathan's batted-ball model (drag C_D = 0.3008 + 0.0292·S, lift C_L = 1.120·S / (0.583 + 2.333·S),
 * spin decays with a 25 s time constant), launched at 100 mph, 28°, 2,200 rpm backspin from 3 ft, no wind.
 */
const G = 32.174;
const R = 0.1210, AREA = Math.PI * R * R, MASS = 0.3203;
const kOf = (rho: number) => (0.5 * rho * AREA) / MASS;          // ft⁻¹

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V) => Math.hypot(a[0], a[1], a[2]);

export interface PitchAir { plateMph: number; flightS: number; ivbIn: number; hbIn: number }

/** Re-fly a pitch thrown in air of density rho0 (lb/ft³) in air of density rho. */
export function flyPitch(c: Coeffs, rho0: number, rho: number): PitchAir | null {
  // Trackman frame: X toward the plate decreasing, Y up, Z = −side.
  const tm = 0.2;
  const v1: V = [c.Xc1 + 2 * c.Xc2 * tm, c.Yc1 + 2 * c.Yc2 * tm, c.Zc1 + 2 * c.Zc2 * tm];
  const a: V = [2 * c.Xc2, 2 * c.Yc2 + G, 2 * c.Zc2];
  const vv = norm(v1); if (!(vv > 50)) return null;
  const along = dot(a, v1) / (vv * vv);
  const dragMag = -along * vv;                                      // ft/s² at speed vv (positive)
  const mag: V = [a[0] - along * v1[0], a[1] - along * v1[1], a[2] - along * v1[2]];
  const magMag = norm(mag); if (!(dragMag > 0)) return null;
  const mHat: V = magMag > 1e-6 ? [mag[0] / magMag, mag[1] / magMag, mag[2] / magMag] : [0, 1, 0];
  const s = rho / rho0;
  const cd = dragMag / (vv * vv), cm = magMag / (vv * vv);          // per v², at rho0

  const run = (withSpin: boolean) => {
    let p: V = [c.Xc0, c.Yc0, c.Zc0], v: V = [c.Xc1, c.Yc1, c.Zc1], t = 0;
    const dt = 0.0005;
    for (let i = 0; i < 4000; i++) {
      const sp = norm(v);
      const acc: V = [-s * cd * sp * v[0], -G - s * cd * sp * v[1], -s * cd * sp * v[2]];
      if (withSpin) {
        // spin force keeps its direction relative to the flight: stay perpendicular to v
        const vh: V = [v[0] / sp, v[1] / sp, v[2] / sp]; const k = dot(mHat, vh);
        const perp: V = [mHat[0] - k * vh[0], mHat[1] - k * vh[1], mHat[2] - k * vh[2]]; const pn = norm(perp) || 1;
        const f = s * cm * sp * sp;
        acc[0] += (f * perp[0]) / pn; acc[1] += (f * perp[1]) / pn; acc[2] += (f * perp[2]) / pn;
      }
      const np: V = [p[0] + v[0] * dt + 0.5 * acc[0] * dt * dt, p[1] + v[1] * dt + 0.5 * acc[1] * dt * dt, p[2] + v[2] * dt + 0.5 * acc[2] * dt * dt];
      const nv: V = [v[0] + acc[0] * dt, v[1] + acc[1] * dt, v[2] + acc[2] * dt];
      if (np[0] <= PLATE_X) {
        const f = (p[0] - PLATE_X) / (p[0] - np[0]);
        return { y: p[1] + (np[1] - p[1]) * f, z: p[2] + (np[2] - p[2]) * f, sp: norm(v) + (norm(nv) - norm(v)) * f, t: t + dt * f };
      }
      p = np; v = nv; t += dt;
    }
    return null;
  };
  const w = run(true);
  if (!w) return null;
  const gy = c.Yc0 + c.Yc1 * w.t - 0.5 * G * w.t * w.t, gz = c.Zc0 + c.Zc1 * w.t;   // gravity only, same flight time
  return { plateMph: w.sp / 1.46667, flightS: w.t, ivbIn: (w.y - gy) * 12, hbIn: -(w.z - gz) * 12 };
}

/** Fly-ball distance (ft) for a 100 mph, 28°, 2,200 rpm drive in air of density rho, with an optional tailwind (mph, + = out). */
export function flyBallFt(rho: number, tailwindMph = 0): number {
  const K = kOf(rho);
  const v0 = 100 * 1.46667, la = (28 * Math.PI) / 180;
  let x = 0, y = 3, vx = v0 * Math.cos(la), vy = v0 * Math.sin(la), w = (2200 * 2 * Math.PI) / 60, t = 0;
  const wind = tailwindMph * 1.46667, dt = 0.001;
  for (let i = 0; i < 20000; i++) {
    const rx = vx - wind, ry = vy, sp = Math.hypot(rx, ry);
    const S = (R * w) / sp;
    const cd = 0.3008 + 0.0292 * S, cl = (1.12 * S) / (0.583 + 2.333 * S);
    // drag opposes air-relative velocity; backspin lift is perpendicular to it, upward-tilted
    const ax = -K * cd * sp * rx - K * cl * sp * ry;
    const ay = -K * cd * sp * ry + K * cl * sp * rx - G;
    const nx = x + vx * dt, ny = y + vy * dt;
    if (ny <= 0 && vy < 0) return x + (nx - x) * (y / (y - ny));
    x = nx; y = ny; vx += ax * dt; vy += ay * dt; w *= Math.exp(-dt / 25); t += dt;
  }
  return x;
}
