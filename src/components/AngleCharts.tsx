import { useMemo, useState } from "react";
import { anglesOf, type Angles, type Coeffs } from "../lib/physics";
import type { PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  rows: PitchRow[];             // the pitcher's selected pitches
  types: [string, string];      // anchor type, tunnel type
  shown: [Coeffs | null, Coeffs | null];   // the two pitches drawn in the 3D view right now
}

type Key = keyof Angles;
const PANELS: { k: Key; title: string; label: string }[] = [
  { k: "vra", title: "Vertical Release Angle", label: "VRA" },
  { k: "hra", title: "Horizontal Release Angle", label: "HRA" },
  { k: "vaa", title: "Vertical Approach Angle", label: "VAA" },
  { k: "haa", title: "Horizontal Approach Angle", label: "HAA" },
];
const REST = "#c9d3e3";

/**
 * Horizontal angles are shown the Statcast way (+ = toward first base, so a righty's HRA is positive), matching the
 * published tunneling work; the rest of the app keeps Trackman's PlateLocSide sign (+ = third base).
 */
const show = (a: Angles, k: Key) => (k === "hra" || k === "haa" ? -a[k] : a[k]);

/** Gaussian KDE with Scott's bandwidth (what scipy / seaborn use by default). */
function kde(xs: number[], grid: number[]): number[] {
  const n = xs.length;
  if (n < 2) return grid.map(() => 0);
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) || 0.1;
  const h = sd * n ** (-1 / 5);
  const c = 1 / (n * h * Math.sqrt(2 * Math.PI));
  return grid.map((g) => c * xs.reduce((s, v) => s + Math.exp(-0.5 * ((g - v) / h) ** 2), 0));
}

/** Share of the two curves that overlaps (0 = fully separate, 100% = identical). */
const overlap = (a: number[], b: number[], step: number) => a.reduce((s, v, i) => s + Math.min(v, b[i]), 0) * step;

function Panel({ title, label, series, marks }: {
  title: string; label: string;
  series: { name: string; color: string; xs: number[] }[];
  marks: { color: string; x: number; dash: string; label: string }[];
}) {
  const W = 260, H = 150, pad = { l: 30, r: 8, t: 6, b: 26 };
  const all = [...series.flatMap((s) => s.xs), ...marks.map((m) => m.x)];
  if (all.length < 4) return null;
  const sorted = [...all].sort((a, b) => a - b);
  const lo = sorted[0], hi = sorted[sorted.length - 1], span = Math.max(1, hi - lo);
  const x0 = lo - span * 0.15, x1 = hi + span * 0.15, N = 160, step = (x1 - x0) / (N - 1);
  const grid = Array.from({ length: N }, (_, i) => x0 + i * step);
  const curves = series.map((s) => ({ ...s, d: kde(s.xs, grid) }));
  const ymax = Math.max(...curves.flatMap((c) => c.d)) * 1.08 || 1;
  const X = (v: number) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - v / ymax) * (H - pad.t - pad.b);
  const tickStep = span > 8 ? 2 : span > 3 ? 1 : 0.5;
  const xt: number[] = []; for (let v = Math.ceil(x0 / tickStep) * tickStep; v <= x1; v += tickStep) xt.push(+v.toFixed(2));
  const yStep = ymax > 1 ? 0.5 : ymax > 0.4 ? 0.2 : 0.1;
  const yt: number[] = []; for (let v = 0; v <= ymax; v += yStep) yt.push(+v.toFixed(2));
  const ov = curves.length === 2 ? Math.round(100 * overlap(curves[0].d, curves[1].d, step)) : null;
  return (
    <figure className="kde-panel">
      <figcaption>{title}{ov != null && <span className="kde-ov" title="How much the two curves overlap">overlap {ov}%</span>}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} density for ${series.map((s) => s.name).join(" and ")}`}>
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} className="kde-frame" />
        {yt.map((v) => <g key={`y${v}`} className="axis"><line x1={pad.l - 3} x2={pad.l} y1={Y(v)} y2={Y(v)} /><text x={pad.l - 5} y={Y(v) + 3} textAnchor="end">{v}</text></g>)}
        {xt.map((v) => <g key={`x${v}`} className="axis"><line y1={H - pad.b} y2={H - pad.b + 3} x1={X(v)} x2={X(v)} /><text x={X(v)} y={H - pad.b + 12} textAnchor="middle">{v}</text></g>)}
        <text className="axis" x={(pad.l + W - pad.r) / 2} y={H - 2} textAnchor="middle">{label} (°)</text>
        {marks.map((m, i) => (
          <g key={i}>
            <line x1={X(m.x)} x2={X(m.x)} y1={pad.t + 9} y2={H - pad.b} stroke={m.color} strokeDasharray={m.dash} strokeWidth={1.4} />
            <text x={X(m.x)} y={pad.t + 7} textAnchor="middle" className="kde-mark" fill={m.color}>{m.label}</text>
          </g>
        ))}
        {curves.map((c) => (
          <path key={c.name} fill="none" stroke={c.color} strokeWidth={2}
            d={c.d.map((v, i) => `${i ? "L" : "M"}${X(grid[i]).toFixed(1)},${Y(v).toFixed(1)}`).join("")} />
        ))}
      </svg>
    </figure>
  );
}

/**
 * Release angles (VRA/HRA) and approach angles (VAA/HAA) as density curves, in the style of Resnick's
 * "Quantifying Pitch Tunneling": good tunnels overlap out of the hand (top row) and separate at the plate (bottom).
 */
export default function AngleCharts({ rows, types, shown }: Props) {
  const [ta, tb] = types;
  const [mode, setMode] = useState<"pair" | "rest">("pair");
  const withAngles = useMemo(() => rows.map((r) => ({ type: r.type, a: anglesOf(r.coeffs) })).filter((r): r is { type: string; a: Angles } => !!r.a), [rows]);
  const A = shown[0] ? anglesOf(shown[0]) : null, B = shown[1] ? anglesOf(shown[1]) : null;
  const same = ta === tb;
  const seriesFor = (k: Key) => mode === "pair"
    ? [
        { name: same ? `All ${ta}s` : ta, color: pitchColorOnDark(ta), xs: withAngles.filter((r) => r.type === ta).map((r) => show(r.a, k)) },
        ...(same ? [] : [{ name: tb, color: pitchColorOnDark(tb), xs: withAngles.filter((r) => r.type === tb).map((r) => show(r.a, k)) }]),
      ]
    : [
        { name: tb, color: pitchColorOnDark(tb), xs: withAngles.filter((r) => r.type === tb).map((r) => show(r.a, k)) },
        { name: "Rest of arsenal", color: REST, xs: withAngles.filter((r) => r.type !== tb).map((r) => show(r.a, k)) },
      ];
  const marks = (k: Key) => [
    ...(A ? [{ color: pitchColorOnDark(ta), x: show(A, k), dash: "6 3", label: "A" }] : []),
    ...(B ? [{ color: pitchColorOnDark(tb), x: show(B, k), dash: "2 3", label: "B" }] : []),
  ];
  const legend = seriesFor("vra");
  const f = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;
  const gap = (k1: Key, k2: Key) => (A && B ? Math.hypot(show(A, k1) - show(B, k1), show(A, k2) - show(B, k2)) : null);
  const gr = gap("vra", "hra"), ga = gap("vaa", "haa");

  return (
    <div className="angles">
      <div className="angles-head">
        <div className="sec-title">{mode === "pair" ? (same ? `Two ${ta}s` : `${ta} (A) vs ${tb} (B)`) : `${tb} vs rest of arsenal`}: release and approach angles</div>
        <div className="segmented" role="radiogroup" aria-label="Compare">
          <button type="button" role="radio" aria-checked={mode === "pair"} className={mode === "pair" ? "is-on" : ""} onClick={() => setMode("pair")}>A vs B</button>
          <button type="button" role="radio" aria-checked={mode === "rest"} className={mode === "rest" ? "is-on" : ""} onClick={() => setMode("rest")}>{tb} vs rest of arsenal</button>
        </div>
      </div>
      <div className="kde-legend">
        {legend.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} <small>({s.xs.length})</small></span>)}
        <span className="muted">lines: pitch <b>A</b> (long dash) and <b>B</b> (short dash), the two in the 3D view and video</span>
      </div>
      <div className="kde-grid">
        {PANELS.map((p) => <Panel key={p.k} title={p.title} label={p.label} series={seriesFor(p.k)} marks={marks(p.k)} />)}
      </div>
      {A && B && (
        <table className="angle-table">
          <thead><tr><th /><th>VRA</th><th>HRA</th><th>VAA</th><th>HAA</th></tr></thead>
          <tbody>
            {([["A", ta, A], ["B", tb, B]] as const).map(([lab, t, a]) => (
              <tr key={lab}><td><b>{lab}</b> <i style={{ background: pitchColorOnDark(t) }} />{t}</td>
                {(["vra", "hra", "vaa", "haa"] as const).map((k) => <td key={k}>{f(show(a, k))}</td>)}</tr>
            ))}
            <tr className="gap-row"><td>Apart</td><td colSpan={2}>{gr!.toFixed(1)}° out of the hand</td><td colSpan={2}>{ga!.toFixed(1)}° at the plate</td></tr>
          </tbody>
        </table>
      )}
      <p className="hint">Top row: the direction the ball leaves the hand. Bottom row: the direction it's moving as it crosses the plate (VAA − = coming down; HRA/HAA + = toward first base, the Statcast sign). A good tunnel overlaps on top and separates on the bottom. Curves are smoothed counts of every selected pitch (KDE); overlap is the share of the two curves that coincide.</p>
    </div>
  );
}
