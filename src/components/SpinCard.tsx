import { useEffect, useMemo, useRef, useState } from "react";
import type { Coeffs } from "../lib/physics";
import { axisVector, spinProfile, spinSimilarity, STANDARD_AIR, type SpinProfile } from "../lib/spin";
import type { PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Side {
  label: "A" | "B"; type: string; coeffs: Coeffs | null; spin: number | null;
  row: PitchRow | null;        // the real pitch when a real pair is loaded (else the type's average is shown)
  typeRows: PitchRow[];        // every selected pitch of this type, for his typical efficiency
}

export interface Weather { hour: string; tempF: number; rh: number; pressureHpa: number; windMph: number; windFromDeg: number; desc: string; airDensity: number }

/** Nearest UTC hour of a Trackman time ("2026-10-23 18:41:07.123" or ISO). */
const hourOf = (utc?: string) => {
  if (!utc) return null;
  const iso = utc.trim().replace(" ", "T"); const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return Number.isNaN(ms) ? null : new Date(Math.round(ms / 3600000) * 3600000).toISOString().slice(0, 13);
};
const wxCache = new Map<string, Promise<Weather | null>>();
const fetchWx = (hour: string) => {
  if (!wxCache.has(hour)) wxCache.set(hour, fetch(`/api/weather?t=${hour}:00:00Z`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return wxCache.get(hour)!;
};
/** Weather for the given hours (home games only), keyed by hour. */
function useWeather(hours: string[]) {
  const [wx, setWx] = useState<Record<string, Weather | null>>({});
  const key = [...new Set(hours)].sort().join(",");
  useEffect(() => {
    let alive = true;
    const hs = key ? key.split(",") : [];
    Promise.all(hs.map((h) => fetchWx(h).then((w) => [h, w] as const))).then((pairs) => { if (alive) setWx(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [key]);
  return wx;
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

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

function BallSide({ s, p, typical }: { s: Side; p: SpinProfile | null; typical: number | null }) {
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
      {s.row && typical != null && <div className="spin-typical">his {s.type.toLowerCase()} usually {Math.round(typical * 100)}% eff</div>}
    </div>
  );
}

/** Simple weather icons: sun, sun behind cloud, cloud, rain, snow, fog, storm. */
function WxIcon({ desc }: { desc: string }) {
  const sun = <g stroke="#f2c14e" strokeWidth="1.6" strokeLinecap="round"><circle cx="9" cy="9" r="3.6" fill="#f2c14e" stroke="none" />{[0, 45, 90, 135, 180, 225, 270, 315].map((d) => <line key={d} x1={9 + 5.4 * Math.cos((d * Math.PI) / 180)} y1={9 + 5.4 * Math.sin((d * Math.PI) / 180)} x2={9 + 7 * Math.cos((d * Math.PI) / 180)} y2={9 + 7 * Math.sin((d * Math.PI) / 180)} />)}</g>;
  const cloud = (dy = 0) => <path d={`M7 ${18 + dy}h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.2A3.6 3.6 0 0 0 7 ${18 + dy}z`} fill="#b4c1d6" />;
  const drops = (c: string) => <g stroke={c} strokeWidth="1.6" strokeLinecap="round"><line x1="9" y1="20.5" x2="8" y2="23" /><line x1="13" y1="20.5" x2="12" y2="23" /><line x1="17" y1="20.5" x2="16" y2="23" /></g>;
  const d = desc.toLowerCase();
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {d === "clear" && <g transform="translate(3 3)">{sun}</g>}
      {d === "partly cloudy" && <>{sun}{cloud(2)}</>}
      {d === "overcast" && cloud(-1)}
      {(d === "rain" || d === "drizzle" || d === "showers") && <>{cloud(-3)}{drops("#5b8def")}</>}
      {(d === "snow" || d === "snow showers") && <>{cloud(-3)}{drops("#eef2f8")}</>}
      {d === "fog" && <g stroke="#b4c1d6" strokeWidth="1.8" strokeLinecap="round"><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="13" x2="20" y2="13" /><line x1="4" y1="17" x2="20" y2="17" /></g>}
      {d === "thunderstorm" && <>{cloud(-3)}<path d="M13 17l-3 4h3l-2 3" fill="none" stroke="#f2c14e" strokeWidth="1.6" strokeLinejoin="round" /></>}
    </svg>
  );
}

/** Small box for one picked pitch: date, time, sky, temperature, humidity, wind, air density. */
function WxBox({ label, row, home, w }: { label: string; row: PitchRow; home: boolean; w: Weather | null }) {
  const iso = row.utc ? row.utc.trim().replace(" ", "T") : ""; const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  const time = Number.isNaN(ms) ? "" : new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  const date = new Date(`${row.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <div className="wx-card">
      <div className="wx-top"><b>{label}</b><span>{date}{time && ` · ${time}`}</span></div>
      {!home ? <div className="wx-note">Away game: standard air used</div>
        : !w ? <div className="wx-note">Loading weather…</div>
        : (
          <>
            <div className="wx-sky"><WxIcon desc={w.desc} /><span className="wx-temp">{Math.round(w.tempF)}°F</span><span className="wx-desc">{w.desc}</span></div>
            <div className="wx-grid">
              <span>Humidity</span><b>{Math.round(w.rh)}%</b>
              <span>Wind</span><b>{Math.round(w.windMph)} mph {compass(w.windFromDeg)}</b>
              <span>Air density</span><b>{w.airDensity.toFixed(4)} lb/ft³</b>
            </div>
          </>
        )}
    </div>
  );
}

/** Spin profile of the two pitches in the 3D view and video, with how alike their spin axes are. */
export default function SpinCard({ a, b, isHome }: { a: Side; b: Side; isHome: (r: PitchRow) => boolean }) {
  // Weather only for the two real pitches picked (home games); averaged pitches and away games use standard air.
  const hours = useMemo(() => [a.row, b.row].filter((r): r is PitchRow => !!r && isHome(r)).map((r) => hourOf(r.utc)).filter((h): h is string => !!h),
    [a.row, b.row, isHome]);
  const wx = useWeather(hours);
  const wxOf = (s: Side) => (s.row && isHome(s.row) ? wx[hourOf(s.row.utc) ?? ""] ?? null : null);
  const air = (s: Side) => wxOf(s)?.airDensity ?? STANDARD_AIR;
  const pa = a.coeffs ? spinProfile(a.coeffs, a.spin, air(a)) : null, pb = b.coeffs ? spinProfile(b.coeffs, b.spin, air(b)) : null;
  const typical = (s: Side) => median(s.typeRows.map((r) => (r.coeffs ? spinProfile(r.coeffs, r.spin)?.eff : null)).filter((e): e is number => e != null));
  const ta = useMemo(() => typical(a), [a.typeRows]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tb = useMemo(() => typical(b), [b.typeRows]);   // eslint-disable-line react-hooks/exhaustive-deps
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
        <BallSide s={a} p={pa} typical={ta} />
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
        <BallSide s={b} p={pb} typical={tb} />
        {(a.row || b.row) && (
          <div className="wx-col" aria-label="Game conditions used for the spin estimate">
            {[a, b].map((s) => s.row && <WxBox key={s.label} label={s.label} row={s.row} home={isHome(s.row)} w={wxOf(s)} />)}
          </div>
        )}
      </div>
    </section>
  );
}
