import { useMemo } from "react";
import { anglesOf, type Coeffs } from "../lib/physics";
import type { PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  rows: PitchRow[];             // the pitcher's selected pitches
  types: [string, string];      // anchor type, tunnel type
  shown: [Coeffs | null, Coeffs | null];   // the two pitches drawn in the 3D view right now
}

type Pt = { x: number; y: number };

/** One panel: every pitch of the two types as small dots, the two pitches in the 3D view as large rings. */
function Panel({ title, xLabel, yLabel, dots, rings }: {
  title: string; xLabel: string; yLabel: string;
  dots: { p: Pt; color: string }[]; rings: { p: Pt; color: string; name: string }[];
}) {
  const W = 170, H = 150, pad = { l: 28, r: 6, t: 8, b: 24 };
  const all = [...dots.map((d) => d.p), ...rings.map((r) => r.p)];
  if (!all.length) return null;
  const lo = (k: "x" | "y") => Math.min(...all.map((p) => p[k])), hi = (k: "x" | "y") => Math.max(...all.map((p) => p[k]));
  const range = (k: "x" | "y") => { const a = lo(k), b = hi(k), m = (a + b) / 2, h = Math.max(1, (b - a) / 2) * 1.15; return [m - h, m + h] as const; };
  const [x0, x1] = range("x"), [y0, y1] = range("y");
  // Catcher's view like the zone grid: third-base side (+) on the left.
  const X = (v: number) => pad.l + ((x1 - v) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + ((y1 - v) / (y1 - y0)) * (H - pad.t - pad.b);
  const ticks = (a: number, b: number) => { const s = (b - a) > 6 ? 2 : 1; const out: number[] = []; for (let v = Math.ceil(a / s) * s; v <= b; v += s) out.push(v); return out; };
  return (
    <figure className="angle-panel">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${yLabel} against ${xLabel}`}>
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`} className="axis"><line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} /><text x={pad.l - 4} y={Y(v) + 3} textAnchor="end">{v}°</text></g>
        ))}
        {ticks(x0, x1).map((v) => (
          <g key={`x${v}`} className="axis"><line y1={pad.t} y2={H - pad.b} x1={X(v)} x2={X(v)} /><text x={X(v)} y={H - pad.b + 11} textAnchor="middle">{v}°</text></g>
        ))}
        <text className="axis" x={pad.l} y={H - 2}>3B</text>
        <text className="axis" x={W - pad.r} y={H - 2} textAnchor="end">1B</text>
        <text className="axis" x={(pad.l + W - pad.r) / 2} y={H - 2} textAnchor="middle">{xLabel}</text>
        {dots.map((d, i) => <circle key={i} cx={X(d.p.x)} cy={Y(d.p.y)} r={2} fill={d.color} opacity={0.45} />)}
        {rings.map((r) => (
          <g key={r.name}>
            <circle cx={X(r.p.x)} cy={Y(r.p.y)} r={5.5} fill={r.color} stroke="#0b1526" strokeWidth={1.5} />
            <title>{`${r.name}: ${yLabel} ${r.p.y.toFixed(1)}°, ${xLabel} ${r.p.x.toFixed(1)}°`}</title>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/**
 * Release angles (VRA/HRA) and approach angles (VAA/HAA) of the two pitches: the idea is to blend out of the
 * hand (close together on the left) and split at the plate (far apart on the right).
 */
export default function AngleCharts({ rows, types, shown }: Props) {
  const [ta, tb] = types;
  const dots = useMemo(() => rows.filter((r) => r.type === ta || r.type === tb).map((r) => ({ a: anglesOf(r.coeffs), color: pitchColorOnDark(r.type) })).filter((d) => d.a), [rows, ta, tb]);
  const A = shown[0] ? anglesOf(shown[0]) : null, B = shown[1] ? anglesOf(shown[1]) : null;
  const ring = (g: (a: NonNullable<typeof A>) => Pt) => [
    ...(A ? [{ p: g(A), color: pitchColorOnDark(ta), name: ta }] : []),
    ...(B ? [{ p: g(B), color: pitchColorOnDark(tb), name: tb }] : []),
  ];
  const gap = (g: (a: NonNullable<typeof A>) => Pt) => (A && B ? Math.hypot(g(A).x - g(B).x, g(A).y - g(B).y) : null);
  const rel = (a: NonNullable<typeof A>) => ({ x: a.hra, y: a.vra }), app = (a: NonNullable<typeof A>) => ({ x: a.haa, y: a.vaa });
  const gr = gap(rel), ga = gap(app);
  const f = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}°`;
  return (
    <div className="angles">
      <div className="sec-title">Release and approach angles</div>
      <div className="angle-row">
        <Panel title="Out of the hand" xLabel="HRA" yLabel="VRA" dots={dots.map((d) => ({ p: rel(d.a!), color: d.color }))} rings={ring(rel)} />
        <Panel title="At the plate" xLabel="HAA" yLabel="VAA" dots={dots.map((d) => ({ p: app(d.a!), color: d.color }))} rings={ring(app)} />
      </div>
      {A && B && (
        <table className="angle-table">
          <thead><tr><th /><th>VRA</th><th>HRA</th><th>VAA</th><th>HAA</th></tr></thead>
          <tbody>
            {[[ta, A], [tb, B]].map(([t, a]) => (
              <tr key={t as string}><td><i style={{ background: pitchColorOnDark(t as string) }} />{t as string}</td>
                {(["vra", "hra", "vaa", "haa"] as const).map((k) => <td key={k}>{f((a as NonNullable<typeof A>)[k])}</td>)}</tr>
            ))}
            <tr className="gap-row"><td>Apart</td><td colSpan={2}>{gr!.toFixed(1)}° out of the hand</td><td colSpan={2}>{ga!.toFixed(1)}° at the plate</td></tr>
          </tbody>
        </table>
      )}
      <p className="hint">VRA/HRA: the direction the ball leaves the hand. VAA/HAA: the direction it's moving as it crosses the plate (− = coming down; + side = toward 3B). Good tunnels sit close together on the left and far apart on the right. Small dots are every pitch of the two types; big dots are the two in the 3D view.</p>
    </div>
  );
}
