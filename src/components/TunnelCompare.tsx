import { useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import { bestPairs, type ScoredPair } from "../lib/bestPairs";
import { pitchColorOnDark } from "../lib/pitchColors";

/**
 * Tunneling across time, from his real back-to-back pairs (same at-bat, one pitch after the other, different types).
 *   Before → after: two date ranges, one row per pair type with a dot for each period and an arrow, biggest change first.
 *   Trend: each pair type's score over his outings, every point pooling his last 5 outings so one game can't swing it.
 * Score = inches apart at the plate ÷ inches apart at 23.8 ft (same as Best tunnels). Medians throughout.
 */
interface Props { all: PitchRow[]; hiddenTypes: string[] }

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const key = (p: ScoredPair) => `${p.anchor.type} → ${p.next.type}`;
const MIN_PAIRS = 3;        // per period, before → after
const WINDOW = 5;           // outings pooled per trend point
const MIN_WINDOW = 4;       // pairs needed in a window for a trend point
const PALETTE = ["#5aa9e6", "#f4a259", "#8cd17d", "#e15759", "#b07aa1", "#edc948", "#76b7b2", "#ff9da7"];
const mdy = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

interface Stat { n: number; score: number; dec: number; plate: number }
const stat = (ps: ScoredPair[]): Stat => ({ n: ps.length, score: median(ps.map((p) => p.ratio)), dec: median(ps.map((p) => p.decisionSep)), plate: median(ps.map((p) => p.plateSep)) });

export default function TunnelCompare({ all, hiddenTypes }: Props) {
  const rows = useMemo(() => all.filter((r) => !hiddenTypes.includes(r.type)), [all, hiddenTypes]);
  const pairs = useMemo(() => bestPairs(rows, { mode: "consecutive", limit: Number.MAX_SAFE_INTEGER }), [rows]);
  const dates = useMemo(() => [...new Set(rows.map((r) => r.date))].sort(), [rows]);
  const first = dates[0] ?? "", last = dates[dates.length - 1] ?? "", mid = dates[Math.floor(dates.length / 2)] ?? "";
  const dayBefore = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

  const [view, setView] = useState<"ab" | "trend">("ab");
  const [showNums, setShowNums] = useState(false);
  const [a, setA] = useState<{ from: string; to: string } | null>(null);
  const [b, setB] = useState<{ from: string; to: string } | null>(null);
  const A = a ?? { from: first, to: mid ? dayBefore(mid) : last }, B = b ?? { from: mid, to: last };

  // ---- Before → after
  const inR = (p: ScoredPair, r: { from: string; to: string }) => p.next.date >= r.from && p.next.date <= r.to;
  const ab = useMemo(() => {
    const g = new Map<string, { a: ScoredPair[]; b: ScoredPair[]; t: [string, string] }>();
    for (const p of pairs) {
      const k = key(p); const e = g.get(k) ?? { a: [], b: [], t: [p.anchor.type, p.next.type] as [string, string] };
      if (inR(p, A)) e.a.push(p);
      if (inR(p, B)) e.b.push(p);
      g.set(k, e);
    }
    const list = [...g.entries()].map(([k, e]) => ({ k, t: e.t, a: stat(e.a), b: stat(e.b) }));
    const both = list.filter((r) => r.a.n >= MIN_PAIRS && r.b.n >= MIN_PAIRS).sort((x, y) => Math.abs(y.b.score - y.a.score) - Math.abs(x.b.score - x.a.score));
    const one = list.filter((r) => (r.a.n >= MIN_PAIRS) !== (r.b.n >= MIN_PAIRS));
    return { both, one };
  }, [pairs, A.from, A.to, B.from, B.to]);   // eslint-disable-line react-hooks/exhaustive-deps

  const say = (r: (typeof ab.both)[number]) => {
    const d = r.b.score - r.a.score, better = d >= 0;
    const why = Math.abs(r.b.dec - r.a.dec) >= Math.abs(r.b.plate - r.a.plate) / 3
      ? `${r.a.dec.toFixed(1)} → ${r.b.dec.toFixed(1)} in apart at 23.8 ft`
      : `${r.a.plate.toFixed(0)} → ${r.b.plate.toFixed(0)} in apart at the plate`;
    return { better, text: `${r.t[0]} → ${r.t[1]} tunnels ${better ? "better" : "worse"} in B (${r.a.score.toFixed(1)}× → ${r.b.score.toFixed(1)}×): ${why}.` };
  };
  const up = ab.both.filter((r) => r.b.score - r.a.score >= 0.2).sort((x, y) => (y.b.score - y.a.score) - (x.b.score - x.a.score))[0];
  const down = ab.both.filter((r) => r.b.score - r.a.score <= -0.2).sort((x, y) => (x.b.score - x.a.score) - (y.b.score - y.a.score))[0];

  // ---- Trend (rolling 5 outings)
  const trendTypes = useMemo(() => {
    const n = new Map<string, number>(); pairs.forEach((p) => n.set(key(p), (n.get(key(p)) ?? 0) + 1));
    return [...n].filter(([, c]) => c >= 8).sort((x, y) => y[1] - x[1]).map(([k]) => k);
  }, [pairs]);
  const [shown, setShown] = useState<string[] | null>(null);
  const on = shown ?? trendTypes.slice(0, 3);
  const outings = useMemo(() => {
    const g = new Map<string, { date: string; season: string; byType: Map<string, number[]> }>();
    for (const r of rows) if (!g.has(r.game)) g.set(r.game, { date: r.date, season: r.season ?? "", byType: new Map() });
    for (const p of pairs) {
      const e = g.get(p.next.game); if (!e) continue;
      const l = e.byType.get(key(p)) ?? []; l.push(p.ratio); e.byType.set(key(p), l);
    }
    return [...g.values()].sort((x, y) => x.date.localeCompare(y.date));
  }, [rows, pairs]);

  if (!pairs.length) return <section className="card tc"><div className="sec-title">Tunneling over time</div><p className="hint">No back-to-back pairs in his pitches.</p></section>;

  const dateIn = (v: string, set: (x: string) => void, lo: string, hi: string, label: string) => (
    <input type="date" aria-label={label} value={v} min={lo} max={hi} onChange={(e) => e.target.value && set(e.target.value)} />
  );
  const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const colorOf = (k: string) => (on.includes(k) ? PALETTE[on.indexOf(k) % PALETTE.length] : "var(--line)");

  // dumbbell scale
  const allScores = ab.both.flatMap((r) => [r.a.score, r.b.score]);
  const smin = Math.max(0, Math.floor(Math.min(1, ...allScores) * 2) / 2), smax = Math.ceil(Math.max(3, ...allScores) * 2) / 2;
  const pct = (v: number) => `${((v - smin) / (smax - smin)) * 100}%`;
  const scaleTicks = Array.from({ length: Math.floor(smax - smin) + 1 }, (_, i) => smin + i).filter((v) => Number.isInteger(v));

  // trend geometry
  const W = 640, H = 230, L = 36, R = 12, T = 18, Bm = 30;
  const series = on.map((k) => ({
    k, p: outings.map((_, i) => {
      if (i < WINDOW - 1) return null;
      const win = outings.slice(i - WINDOW + 1, i + 1).flatMap((o) => o.byType.get(k) ?? []);
      return win.length >= MIN_WINDOW ? { i, v: median(win), n: win.length } : null;
    }).filter((x): x is { i: number; v: number; n: number } => !!x),
  }));
  const vals = series.flatMap((s) => s.p.map((x) => x.v));
  const vmax = Math.max(3, ...vals) * 1.1;
  const X = (i: number) => L + (outings.length > 1 ? (i / (outings.length - 1)) * (W - L - R) : (W - L - R) / 2);
  const Y = (v: number) => T + (1 - v / vmax) * (H - T - Bm);
  const yTicks = [...new Set([0, 1, 2, 3, 4, 5, 6, 8, 10].filter((v) => v <= vmax))];
  const seasonStarts = outings.map((o, i) => ({ i, s: o.season })).filter((x, i) => i === 0 || x.s !== outings[i - 1].season);

  return (
    <section className="card tc">
      <div className="tc-head">
        <div className="sec-title" style={{ margin: 0 }}>Tunneling over time</div>
        <div className="segmented" role="radiogroup" aria-label="View" style={{ margin: 0 }}>
          <button type="button" role="radio" aria-checked={view === "ab"} className={view === "ab" ? "is-on" : ""} onClick={() => setView("ab")}>Before → after</button>
          <button type="button" role="radio" aria-checked={view === "trend"} className={view === "trend" ? "is-on" : ""} onClick={() => setView("trend")}>Trend</button>
        </div>
      </div>

      {view === "ab" ? (
        <>
          <div className="tc-ranges">
            <div className="tc-range"><b className="tc-a">A</b>{dateIn(A.from, (x) => setA({ ...A, from: x }), first, A.to, "Period A start")}<span>to</span>{dateIn(A.to, (x) => setA({ ...A, to: x }), A.from, last, "Period A end")}</div>
            <div className="tc-range"><b className="tc-b">B</b>{dateIn(B.from, (x) => setB({ ...B, from: x }), first, B.to, "Period B start")}<span>to</span>{dateIn(B.to, (x) => setB({ ...B, to: x }), B.from, last, "Period B end")}</div>
          </div>

          {(up || down) && (
            <div className="tc-say">
              {up && <p className="pos">▲ {say(up).text}</p>}
              {down && <p className="neg">▼ {say(down).text}</p>}
            </div>
          )}

          {ab.both.length === 0 ? <p className="hint">No pair type has {MIN_PAIRS}+ back-to-back pairs in both periods.</p> : (
            <div className="tc-db">
              <div className="tc-db-scale">
                <span />
                <div className="tc-db-axis">{scaleTicks.map((v) => <i key={v} style={{ left: pct(v) }}>{v}×</i>)}</div>
                <span />
              </div>
              {ab.both.map((r) => {
                const d = r.b.score - r.a.score, lo = Math.min(r.a.score, r.b.score), hi = Math.max(r.a.score, r.b.score);
                const tone = Math.abs(d) < 0.2 ? "flat" : d > 0 ? "up" : "down";
                return (
                  <div key={r.k} className="tc-db-row" title={`A: ${r.a.n} pairs · ${f(r.a.dec)} in at 23.8 ft · ${f(r.a.plate, 0)} in at plate\nB: ${r.b.n} pairs · ${f(r.b.dec)} in at 23.8 ft · ${f(r.b.plate, 0)} in at plate`}>
                    <span className="tc-pair"><i style={{ background: pitchColorOnDark(r.t[0]) }} />{r.t[0]}<em>→</em><i style={{ background: pitchColorOnDark(r.t[1]) }} />{r.t[1]}</span>
                    <div className="tc-db-track">
                      {scaleTicks.map((v) => <i key={v} className="tc-db-grid" style={{ left: pct(v) }} />)}
                      <span className={`tc-db-bar ${tone}`} style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
                      <span className="tc-db-dot a" style={{ left: pct(r.a.score) }} />
                      <span className={`tc-db-dot b ${tone}`} style={{ left: pct(r.b.score) }} />
                    </div>
                    <span className={`tc-db-d ${tone}`}>{Math.abs(d) < 0.05 ? "same" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}×`}</span>
                  </div>
                );
              })}
              <div className="tc-legend"><span><i className="tc-db-dot a" />A {mdy(A.from)}–{mdy(A.to)}</span><span><i className="tc-db-dot b up" />B {mdy(B.from)}–{mdy(B.to)}</span><span className="dim">Biggest change on top · hover a row for the inches</span></div>
            </div>
          )}
          {ab.one.length > 0 && <p className="hint">Only in one period (not compared): {ab.one.map((r) => `${r.t[0]} → ${r.t[1]}`).join(", ")}.</p>}

          <button type="button" className="ghost tc-nums" onClick={() => setShowNums((v) => !v)}>{showNums ? "Hide numbers" : "Show numbers"}</button>
          {showNums && (
            <div className="wxi-scroll">
              <table className="wxi-table tc-table">
                <thead>
                  <tr><th rowSpan={2}>Pair</th><th colSpan={4} className="grp">A</th><th colSpan={4} className="grp">B</th></tr>
                  <tr><th>Pairs</th><th>Score</th><th title="Inches apart at 23.8 ft">23.8 ft</th><th title="Inches apart at the plate">Plate</th><th>Pairs</th><th>Score</th><th>23.8 ft</th><th>Plate</th></tr>
                </thead>
                <tbody>
                  {[...ab.both, ...ab.one].map(({ k, t, a: sa, b: sb }) => {
                    const cell = (s: Stat) => s.n >= MIN_PAIRS
                      ? <><td className="num">{s.n}</td><td className="num"><b>{f(s.score)}×</b></td><td className="num">{f(s.dec)}</td><td className="num">{f(s.plate, 0)}</td></>
                      : <><td className="num dim">{s.n}</td><td colSpan={3} className="dim">too few</td></>;
                    return <tr key={k}><td><span className="tc-pair"><i style={{ background: pitchColorOnDark(t[0]) }} />{t[0]}<em>→</em><i style={{ background: pitchColorOnDark(t[1]) }} />{t[1]}</span></td>{cell(sa)}{cell(sb)}</tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">Score = inches apart at the plate ÷ inches apart at 23.8 ft, median of his back-to-back pairs. Higher = looks the same longer, then splits more. A pair needs {MIN_PAIRS}+ in each period.</p>
        </>
      ) : (
        <>
          <div className="wxi-types" role="group" aria-label="Pair types shown">
            {trendTypes.map((k) => {
              const isOn = on.includes(k);
              return (
                <button key={k} type="button" className={`type-chip${isOn ? " is-on" : ""}`} aria-pressed={isOn}
                  onClick={() => setShown(isOn ? on.filter((x) => x !== k) : on.length >= PALETTE.length ? on : [...on, k])}>
                  <i style={{ background: colorOf(k) }} />{k}
                </button>
              );
            })}
          </div>
          {trendTypes.length === 0 || outings.length < WINDOW ? <p className="hint">Needs {WINDOW}+ outings and a pair type with 8+ back-to-back pairs.</p> : (
            <svg className="tc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tunnel score over his outings, last 5 outings pooled">
              {seasonStarts.map(({ i, s }) => (
                <g key={i}>
                  {i > 0 && <line x1={X(i - 0.5)} x2={X(i - 0.5)} y1={T - 6} y2={H - Bm} className="tc-season" />}
                  <text x={X(i) + 4} y={T - 6} className="tc-ax tc-season-l">{s}</text>
                </g>
              ))}
              {yTicks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="tc-grid" /><text x={L - 6} y={Y(v) + 4} textAnchor="end" className="tc-ax">{v}×</text></g>)}
              {[0, Math.floor((outings.length - 1) / 2), outings.length - 1].map((i) => <text key={i} x={X(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === outings.length - 1 ? "end" : "middle"} className="tc-ax">{mdy(outings[i].date)}</text>)}
              {series.map(({ k, p }) => (
                <g key={k}>
                  <polyline points={p.map((x) => `${X(x.i)},${Y(x.v)}`).join(" ")} fill="none" stroke={colorOf(k)} strokeWidth={2.2} strokeLinejoin="round" />
                  {p.map((x) => <circle key={x.i} cx={X(x.i)} cy={Y(x.v)} r={2.6} fill={colorOf(k)}><title>{`${k} · ${WINDOW} outings ending ${md(outings[x.i].date)} · ${x.v.toFixed(1)}× from ${x.n} pairs`}</title></circle>)}
                  {p.length > 0 && <text x={X(p[p.length - 1].i) - 4} y={Y(p[p.length - 1].v) - 7} textAnchor="end" className="tc-end" fill={colorOf(k)}>{p[p.length - 1].v.toFixed(1)}×</text>}
                </g>
              ))}
            </svg>
          )}
          <p className="hint">Each point = his last {WINDOW} outings combined (median of those back-to-back pairs, {MIN_WINDOW}+ needed), so one game can't swing the line. Higher = better tunnel. Dashed lines mark a new season.</p>
        </>
      )}
    </section>
  );
}
