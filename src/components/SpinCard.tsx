import { useEffect, useRef } from "react";
import type { Coeffs } from "../lib/physics";
import { axisVector, spinProfile, spinSimilarity, type SpinProfile } from "../lib/spin";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Side { label: "A" | "B"; type: string; coeffs: Coeffs | null; spin: number | null }

// Baseball seam on the unit sphere (a + b = 1 keeps it on the sphere).
const SEAM: [number, number, number][] = (() => {
  const a = 0.7, b = 0.3, c = 2 * Math.sqrt(a * b), out: [number, number, number][] = [];
  for (let i = 0; i <= 240; i++) { const t = (i / 240) * 2 * Math.PI; out.push([a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)]); }
  return out;
})();

type V3 = [number, number, number];
const rot = (v: V3, k: V3, ang: number): V3 => {
  const c = Math.cos(ang), s = Math.sin(ang), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A spinning ball seen from the pitcher: seams turn about the spin axis, an arrow rides the spin, a dot marks the gyro. */
function Ball({ p, color, rpm }: { p: SpinProfile; color: string; rpm: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext("2d")!; const W = cv.width, C = W / 2, R = W * 0.34;
    const k = axisVector(p.tiltRad, p.gyroDeg ?? 0) as V3;
    const ref0: V3 = Math.abs(k[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = cross(k, ref0); const L = Math.hypot(...u); u = u.map((x) => x / L) as V3; const w = cross(k, u);
    const spd = (((rpm ?? 2000) / 60) * 2 * Math.PI) / 45;   // slowed way down so it can be seen
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const frame = (ts: number) => {
      const ang = reduce ? 0.6 : (ts / 1000) * spd;
      g.clearRect(0, 0, W, W);
      g.strokeStyle = "rgba(135,152,180,.35)"; g.lineWidth = 2;
      for (let h = 0; h < 12; h++) { const t = (h / 12) * 2 * Math.PI, r1 = R * 1.3, r2 = R * (h % 3 ? 1.34 : 1.4); g.beginPath(); g.moveTo(C + Math.sin(t) * r1, C - Math.cos(t) * r1); g.lineTo(C + Math.sin(t) * r2, C - Math.cos(t) * r2); g.stroke(); }
      g.beginPath(); g.arc(C, C, R, 0, 2 * Math.PI); g.fillStyle = "#f4f1ea"; g.fill();
      const shade = g.createRadialGradient(C - R * 0.35, C - R * 0.4, R * 0.1, C, C, R); shade.addColorStop(0, "rgba(255,255,255,0)"); shade.addColorStop(1, "rgba(0,0,0,.28)"); g.fillStyle = shade; g.fill();
      const pts = SEAM.map((s) => { const q = rot(s, k, ang); return [C + q[0] * R, C - q[1] * R, q[2]]; });
      g.lineWidth = 3; g.lineCap = "round";
      for (let i = 1; i < pts.length; i++) {
        const z = (pts[i][2] + pts[i - 1][2]) / 2; if (z > 0) continue;   // +z points away from the pitcher: hidden side
        g.strokeStyle = `rgba(200,40,40,${0.35 + 0.65 * Math.min(1, -z * 1.6)})`;
        g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
      }
      // arrow riding the spin around the ball
      const rr = R * 1.16, ring = (t: number): V3 => [u[0] * Math.cos(t) + w[0] * Math.sin(t), u[1] * Math.cos(t) + w[1] * Math.sin(t), u[2] * Math.cos(t) + w[2] * Math.sin(t)];
      g.lineWidth = 5; g.strokeStyle = color; let last: number[] | null = null;
      for (let i = 0; i <= 40; i++) {
        const t = ang - 2.1 + (2.1 * i) / 40, v = ring(t), q = [C + v[0] * rr, C - v[1] * rr, v[2]];
        if (last) { g.globalAlpha = (q[2] < 0 ? 1 : 0.28) * (0.15 + (0.85 * i) / 40); g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(q[0], q[1]); g.stroke(); }
        last = q;
      }
      const v1 = ring(ang), v0 = ring(ang - 0.08), dx = (v1[0] - v0[0]) * rr, dy = -(v1[1] - v0[1]) * rr, ln = Math.hypot(dx, dy) || 1, ux = dx / ln, uy = dy / ln, hx = C + v1[0] * rr, hy = C - v1[1] * rr;
      g.globalAlpha = last![2] < 0 ? 1 : 0.3; g.fillStyle = color;
      g.beginPath(); g.moveTo(hx + ux * 14, hy + uy * 14); g.lineTo(hx - ux * 6 - uy * 11, hy - uy * 6 + ux * 11); g.lineTo(hx - ux * 6 + uy * 11, hy - uy * 6 - ux * 11); g.closePath(); g.fill();
      g.globalAlpha = 1;
      // tilt tick on the clock ring
      g.strokeStyle = color; g.lineWidth = 4; g.beginPath();
      g.moveTo(C + Math.sin(p.tiltRad) * R * 1.3, C - Math.cos(p.tiltRad) * R * 1.3); g.lineTo(C + Math.sin(p.tiltRad) * R * 1.46, C - Math.cos(p.tiltRad) * R * 1.46); g.stroke();
      // gyro dot where the axis comes through the near side
      const near = k[2] <= 0 ? k : ([-k[0], -k[1], -k[2]] as V3), dot = 6 + 16 * Math.abs(k[2]);
      g.fillStyle = color; g.globalAlpha = 0.9; g.beginPath(); g.arc(C + near[0] * R, C - near[1] * R, dot / 2, 0, 2 * Math.PI); g.fill(); g.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [p.tiltRad, p.gyroDeg, color, rpm]);
  return <canvas ref={ref} width={360} height={360} className="spin-canvas" role="img" aria-label={`Tilt ${p.clock}${p.gyroDeg != null ? `, ${Math.round(p.gyroDeg)}° gyro` : ""}`} />;
}

function BallSide({ s, p }: { s: Side; p: SpinProfile | null }) {
  const color = pitchColorOnDark(s.type);
  return (
    <div className="spin-ball">
      <div className="spin-name"><i style={{ background: color }} /><b>{s.label}</b> · {s.type}</div>
      {p ? <Ball p={p} color={color} rpm={s.spin} /> : <div className="spin-canvas spin-empty">No trajectory</div>}
      <div className="spin-clock">{p?.clock ?? "—"}</div>
      <div className="spin-stats">
        <div><b>{s.spin != null ? Math.round(s.spin).toLocaleString() : "—"}</b><span>rpm</span></div>
        <div><b>{p?.eff != null ? `${Math.round(p.eff * 100)}%` : "—"}</b><span>spin eff</span></div>
        <div><b>{p?.gyroDeg != null ? `${Math.round(p.gyroDeg)}°` : "—"}</b><span>gyro</span></div>
      </div>
    </div>
  );
}

/** Spin profile of the two pitches in the 3D view and video, with how alike their spin axes are. */
export default function SpinCard({ a, b }: { a: Side; b: Side }) {
  const pa = a.coeffs ? spinProfile(a.coeffs, a.spin) : null, pb = b.coeffs ? spinProfile(b.coeffs, b.spin) : null;
  const sim = pa && pb ? spinSimilarity(pa, pb) : null;
  const C = 2 * Math.PI * 50;
  const tone = sim == null ? "var(--muted)" : sim.score >= 70 ? "var(--good)" : sim.score >= 40 ? "var(--wvu-gold)" : "#e05c5c";
  return (
    <section className="spincard" aria-label="Spin profile of the two pitches">
      <div className="sepref-head">
        <div>
          <div className="sec-title">Spin profile</div>
          <div className="sepref-sub">Pitcher's view · tilt from movement (Trackman's method) · efficiency and gyro estimated</div>
        </div>
      </div>
      <div className="spin-row">
        <BallSide s={a} p={pa} />
        <div className="spin-mid">
          <svg viewBox="0 0 120 120" width="116" height="116" aria-hidden="true">
            <circle cx="60" cy="60" r="50" fill="none" stroke="var(--line)" strokeWidth="8" />
            {sim && <circle cx="60" cy="60" r="50" fill="none" stroke={tone} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(C * sim.score) / 100} ${C}`} transform="rotate(-90 60 60)" />}
            <text x="60" y="64" textAnchor="middle" className="spin-score">{sim ? sim.score : "—"}</text>
            <text x="60" y="82" textAnchor="middle" className="spin-of">of 100</text>
          </svg>
          <div className="spin-mid-label">Spin similarity</div>
          {sim && (
            <dl className="spin-gaps">
              <dt>Axes apart</dt><dd>{sim.apart.toFixed(1)}°</dd>
              <dt>Tilt gap</dt><dd>{Math.round(sim.tiltMin)} min</dd>
              <dt>Gyro gap</dt><dd>{Math.round(sim.gyroGap)}°</dd>
            </dl>
          )}
        </div>
        <BallSide s={b} p={pb} />
      </div>
    </section>
  );
}
