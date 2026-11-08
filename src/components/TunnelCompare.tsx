import { useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import { bestPairs, type ScoredPair } from "../lib/bestPairs";
import { pitchColorOnDark } from "../lib/pitchColors";

/**
 * Tunneling across time, from his real back-to-back pairs (same at-bat, one pitch after the other, different types).
 *   A vs B: two date ranges side by side, per pair type (e.g. Fastball → Slider).
 *   Trend: each pair type's score outing by outing.
 * Score = inches apart at the plate ÷ inches apart at 23.8 ft (the same score as Best tunnels); medians, so one odd pair
 * can't swing it.
 */
interface Props { all: PitchRow[]; hiddenTypes: string[] }

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const key = (p: ScoredPair) => `${p.anchor.type} → ${p.next.type}`;
const MIN_PAIRS = 3;
const PALETTE = ["#5aa9e6", "#f4a259", "#8cd17d", "#e15759", "#b07aa1", "#edc948", "#76b7b2", "#ff9da7"];
const mdy = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;

interface Stat { n: number; score: number; dec: number; plate: number }
const stat = (ps: ScoredPair[]): Stat => ({ n: ps.length, score: median(ps.map((p) => p.ratio)), dec: median(ps.map((p) => p.decisionSep)), plate: median(ps.map((p) => p.plateSep)) });

export default function TunnelCompare({ all, hiddenTypes }: Props) {
  const rows = useMemo(() => all.filter((r) => !hiddenTypes.includes(r.type)), [all, hiddenTypes]);
  const pairs = useMemo(() => bestPairs(rows, { mode: "consecutive", limit: Number.MAX_SAFE_INTEGER }), [rows]);
  const dates = useMemo(() => [...new Set(rows.map((r) => r.date))].sort(), [rows]);
  const first = dates[0] ?? "", last = dates[dates.length - 1] ?? "", mid = dates[Math.floor(dates.length / 2)] ?? "";
  const dayBefore = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

  const [view, setView] = useState<"ab" | "trend">("ab");
  const [a, setA] = useState<{ from: string; to: string } | null>(null);
  const [b, setB] = useState<{ from: string; to: string } | null>(null);
  const A = a ?? { from: first, to: mid ? dayBefore(mid) : last }, B = b ?? { from: mid, to: last };

  const inR = (p: ScoredPair, r: { from: string; to: string }) => p.next.date >= r.from && p.next.date <= r.to;
  const table = useMemo(() => {
    const g = new Map<string, { a: ScoredPair[]; b: ScoredPair[]; t: [string, string] }>();
    for (const p of pairs) {
      const k = key(p); const e = g.get(k) ?? { a: [], b: [], t: [p.anchor.type, p.next.type] as [string, string] };
      if (inR(p, A)) e.a.push(p);
      if (inR(p, B)) e.b.push(p);
      g.set(k, e);
    }
    return [...g.entries()].map(([k, e]) => ({ k, t: e.t, a: stat(e.a), b: stat(e.b) }))
      .filter((r) => r.a.n >= MIN_PAIRS || r.b.n >= MIN_PAIRS)
      .sort((x, y) => y.a.n + y.b.n - (x.a.n + x.b.n));
  }, [pairs, A.from, A.to, B.from, B.to]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Trend: pair types with enough pairs overall, scored per outing (an outing needs 2+ of that pair to get a point).
  const trendTypes = useMemo(() => {
    const n = new Map<string, number>(); pairs.forEach((p) => n.set(key(p), (n.get(key(p)) ?? 0) + 1));
    return [...n].filter(([, c]) => c >= 6).sort((x, y) => y[1] - x[1]).map(([k]) => k);
  }, [pairs]);
  const [shown, setShown] = useState<string[] | null>(null);
  const on = shown ?? trendTypes.slice(0, 3);
  const outings = useMemo(() => {
    const g = new Map<string, { date: string; byType: Map<string, number[]> }>();
    for (const p of pairs) {
      const e = g.get(p.next.game) ?? { date: p.next.date, byType: new Map() };
      const l = e.byType.get(key(p)) ?? []; l.push(p.ratio); e.byType.set(key(p), l); g.set(p.next.game, e);
    }
    return [...g.entries()].map(([game, e]) => ({ game, ...e })).sort((x, y) => x.date.localeCompare(y.date));
  }, [pairs]);

  if (!pairs.length) return <section className="card tc"><div className="sec-title">Tunneling over time</div><p className="hint">No back-to-back pairs in his pitches.</p></section>;

  const dateIn = (v: string, set: (x: string) => void, lo: string, hi: string, label: string) => (
    <input type="date" aria-label={label} value={v} min={lo} max={hi} onChange={(e) => e.target.value && set(e.target.value)} />
  );
  const sg = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}` : "—");
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

  // Trend chart geometry
  const W = 640, H = 220, L = 40, R = 12, T = 12, Bm = 28;
  const pts = on.map((k) => ({ k, p: outings.map((o, i) => { const l = o.byType.get(k); return l && l.length >= 2 ? { i, v: median(l), n: l.length, date: o.date } : null; }).filter((x): x is { i: number; v: number; n: number; date: string } => !!x) }));
  const vmax = Math.max(4, ...pts.flatMap((s) => s.p.map((x) => x.v))) * 1.08;
  const X = (i: number) => L + (outings.length > 1 ? (i / (outings.length - 1)) * (W - L - R) : (W - L - R) / 2);
  const Y = (v: number) => T + (1 - v / vmax) * (H - T - Bm);
  const ticks = [0, vmax / 4, vmax / 2, (3 * vmax) / 4].map((v) => Math.round(v));
  const xlab = outings.length <= 8 ? outings.map((_, i) => i) : [0, Math.floor(outings.length / 3), Math.floor((2 * outings.length) / 3), outings.length - 1];
  const colorOf = (k: string) => PALETTE[Math.max(0, trendTypes.indexOf(k)) % PALETTE.length];

  return (
    <section className="card tc">
      <div className="tc-head">
        <div className="sec-title" style={{ margin: 0 }}>Tunneling over time</div>
        <div className="segmented" role="radiogroup" aria-label="View" style={{ margin: 0 }}>
          <button type="button" role="radio" aria-checked={view === "ab"} className={view === "ab" ? "is-on" : ""} onClick={() => setView("ab")}>A vs B</button>
          <button type="button" role="radio" aria-checked={view === "trend"} className={view === "trend" ? "is-on" : ""} onClick={() => setView("trend")}>Trend by outing</button>
        </div>
      </div>

      {view === "ab" ? (
        <>
          <div className="tc-ranges">
            <div className="tc-range"><b>A</b>{dateIn(A.from, (x) => setA({ ...A, from: x }), first, A.to, "Period A start")}<span>to</span>{dateIn(A.to, (x) => setA({ ...A, to: x }), A.from, last, "Period A end")}</div>
            <div className="tc-range"><b>B</b>{dateIn(B.from, (x) => setB({ ...B, from: x }), first, B.to, "Period B start")}<span>to</span>{dateIn(B.to, (x) => setB({ ...B, to: x }), B.from, last, "Period B end")}</div>
          </div>
          <div className="wxi-scroll">
            <table className="wxi-table tc-table">
              <thead>
                <tr><th rowSpan={2}>Pair</th><th colSpan={4} className="grp">A · {mdy(A.from)}–{mdy(A.to)}</th><th colSpan={4} className="grp">B · {mdy(B.from)}–{mdy(B.to)}</th><th rowSpan={2} title="B score minus A score">Change</th></tr>
                <tr><th>Pairs</th><th>Score</th><th title="Inches apart at 23.8 ft">23.8 ft</th><th title="Inches apart at the plate">Plate</th><th>Pairs</th><th>Score</th><th>23.8 ft</th><th>Plate</th></tr>
              </thead>
              <tbody>
                {table.map(({ k, t, a: sa, b: sb }) => {
                  const ok = sa.n >= MIN_PAIRS && sb.n >= MIN_PAIRS, d = sb.score - sa.score;
                  const cell = (s: Stat) => s.n >= MIN_PAIRS
                    ? <><td className="num">{s.n}</td><td className="num"><b>{f(s.score)}×</b></td><td className="num">{f(s.dec)}</td><td className="num">{f(s.plate, 0)}</td></>
                    : <><td className="num dim">{s.n}</td><td colSpan={3} className="dim">too few</td></>;
                  return (
                    <tr key={k}>
                      <td><span className="tc-pair"><i style={{ background: pitchColorOnDark(t[0]) }} />{t[0]}<em>→</em><i style={{ background: pitchColorOnDark(t[1]) }} />{t[1]}</span></td>
                      {cell(sa)}{cell(sb)}
                      <td className={`num ${ok ? (d >= 0 ? "pos" : "neg") : "dim"}`}>{ok ? `${sg(d)}×` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">Back-to-back pairs from his at-bats, pitch types left out in the filter excluded. Medians; a pair type needs {MIN_PAIRS}+ pairs in a period to be scored. Inches are medians too.</p>
        </>
      ) : (
        <>
          <div className="wxi-types" role="group" aria-label="Pair types shown">
            {trendTypes.map((k) => {
              const isOn = on.includes(k);
              return (
                <button key={k} type="button" className={`type-chip${isOn ? " is-on" : ""}`} aria-pressed={isOn}
                  onClick={() => setShown(isOn ? on.filter((x) => x !== k) : [...on, k])}>
                  <i style={{ background: colorOf(k) }} />{k}
                </button>
              );
            })}
          </div>
          {trendTypes.length === 0 ? <p className="hint">No pair type has 6+ back-to-back pairs yet.</p> : (
            <svg className="tc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tunnel score by outing">
              {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="tc-grid" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" className="tc-ax">{v}×</text></g>)}
              {xlab.map((i) => <text key={i} x={X(i)} y={H - 8} textAnchor="middle" className="tc-ax">{mdy(outings[i].date)}</text>)}
              {pts.map(({ k, p }) => (
                <g key={k}>
                  <polyline points={p.map((x) => `${X(x.i)},${Y(x.v)}`).join(" ")} fill="none" stroke={colorOf(k)} strokeWidth={2} />
                  {p.map((x) => <circle key={x.i} cx={X(x.i)} cy={Y(x.v)} r={3.5} fill={colorOf(k)}><title>{`${k} · ${mdy(x.date)} · ${x.v.toFixed(1)}× (${x.n} pairs)`}</title></circle>)}
                </g>
              ))}
            </svg>
          )}
          <p className="hint">Median score per outing; an outing needs 2+ of that pair to get a point. Hover a point for the outing.</p>
        </>
      )}
    </section>
  );
}
