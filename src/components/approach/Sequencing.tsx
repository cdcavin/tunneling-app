import { useMemo, useState } from "react";
import type { PitchRow } from "../../lib/types";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { ballsStrikes, COUNTS, d1Tally, EDGES, goodBad, METRICS, tally, useCountNorms, type Hand } from "../../lib/sequencing";

const HANDS: [Hand, string][] = [["all", "All"], ["Left", "vs LHH"], ["Right", "vs RHH"]];
const MIN_N = 10;   // fewer pitches than this in a cell: shown grey, no color

/** Pie slices as SVG paths (a full circle when there's one slice). */
function Pie({ cx, cy, r, parts }: { cx: number; cy: number; r: number; parts: { type: string; n: number }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <circle cx={cx} cy={cy} r={r} className="pk-empty" />;
  if (parts.filter((p) => p.n).length === 1) return <circle cx={cx} cy={cy} r={r} fill={pitchColor(parts.find((p) => p.n)!.type)} />;
  let a0 = -Math.PI / 2;
  return (
    <g>
      {parts.filter((p) => p.n).map((p) => {
        const a1 = a0 + (p.n / total) * 2 * Math.PI;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`;
        a0 = a1;
        return <path key={p.type} d={d} fill={pitchColor(p.type)} stroke="#0f1d33" strokeWidth={1} />;
      })}
    </g>
  );
}

export default function Sequencing({ rows }: { rows: PitchRow[] }) {
  const [hand, setHand] = useState<Hand>("all");
  const [sel, setSel] = useState<string>("0-0");
  const norms = useCountNorms();
  const pool = useMemo(() => (hand === "all" ? rows : rows.filter((r) => r.batterSide === hand)), [rows, hand]);
  const types = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) n.set(r.type, (n.get(r.type) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [rows]);
  const byCount = useMemo(() => {
    const m = new Map<string, PitchRow[]>();
    for (const r of pool) { if (!r.count) continue; const g = m.get(r.count); if (g) g.push(r); else m.set(r.count, [r]); }
    return m;
  }, [pool]);
  const maxN = Math.max(1, ...COUNTS.map((k) => byCount.get(k)?.length ?? 0));

  // Board geometry: row = pitch number in the at-bat, column = strikes − balls.
  const W = 760, H = 500, top = 52, rowH = 80;
  const colX = (k: string) => { const [b, s] = ballsStrikes(k); return W / 2 + (s - b) * 108 + 54; };
  const rowY = (k: string) => { const [b, s] = ballsStrikes(k); return top + (b + s) * rowH; };
  const radius = (n: number) => (n ? 14 + 20 * Math.sqrt(n / maxN) : 12);

  const selRows = sel === "all" ? pool : byCount.get(sel) ?? [];
  const lineTypes = types.filter((t) => selRows.some((r) => r.type === t));

  return (
    <section className="ap-sec" id="sequencing">
      <header className="ap-head">
        <h2>Sequencing</h2>
        <span className="hint">What he throws in each count. Pie = pitch mix, size = how often he's in that count. Click a count for its numbers.</span>
        <div className="segmented" role="radiogroup" aria-label="Hitter side">
          {HANDS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={hand === k} className={hand === k ? "is-on" : ""} onClick={() => setHand(k)}>{l}</button>)}
        </div>
      </header>
      <div className="ap-row pk-row">
        <div className="card pk-board">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Count tree with pitch mix in each count">
            <text className="pk-side" x={18} y={22}>◀ Balls</text>
            <text className="pk-side" x={W - 18} y={22} textAnchor="end">Strikes ▶</text>
            {EDGES.map(([a, b]) => <line key={`${a}${b}`} className="pk-edge" x1={colX(a)} y1={rowY(a)} x2={colX(b)} y2={rowY(b)} />)}
            {COUNTS.map((k) => {
              const g = byCount.get(k) ?? [];
              const r = radius(g.length);
              const parts = types.map((t) => ({ type: t, n: g.filter((x) => x.type === t).length }));
              return (
                <g key={k} className={`pk-node${sel === k ? " is-on" : ""}`} onClick={() => setSel(k)} role="button" aria-label={`${k}: ${g.length} pitches`}>
                  <circle cx={colX(k)} cy={rowY(k)} r={r + 5} className="pk-halo" />
                  <Pie cx={colX(k)} cy={rowY(k)} r={r} parts={parts} />
                  <text className="pk-count" x={colX(k) + r + 8} y={rowY(k) - 2}>{k}</text>
                  <text className="pk-n" x={colX(k) + r + 8} y={rowY(k) + 13}>{g.length}</text>
                </g>
              );
            })}
          </svg>
          <div className="pk-legend">{types.map((t) => <span key={t}><i style={{ background: pitchColor(t) }} />{t}</span>)}</div>
        </div>
        <div className="card pk-table-card">
          <div className="pk-table-head">
            <div className="sec-title">{sel === "all" ? "All counts" : `In ${sel} counts`}<span className="ars-sub">{selRows.length} pitches{hand !== "all" && ` · ${hand === "Left" ? "vs LHH" : "vs RHH"}`}</span></div>
            <button type="button" className={`ghost pk-all${sel === "all" ? " is-on" : ""}`} onClick={() => setSel("all")}>All counts</button>
          </div>
          <div className="ars-table-wrap">
            <table className="ars-table pk-table">
              <thead><tr><th>Pitch</th><th title="Share of his pitches in this count">Usage</th>{METRICS.map((m) => <th key={m.key} title={m.title}>{m.label}</th>)}</tr></thead>
              <tbody>
                {lineTypes.map((t) => {
                  const mine = tally(selRows.filter((r) => r.type === t));
                  const d1 = d1Tally(norms, hand, sel, t);
                  const thin = mine.n < MIN_N;
                  return (
                    <tr key={t} className={thin ? "is-thin" : ""}>
                      <th scope="row"><i style={{ background: pitchColor(t) }} />{pitchAbbr(t)}<small> {mine.n}</small></th>
                      <td>{((mine.n / selRows.length) * 100).toFixed(0)}%</td>
                      {METRICS.map((m) => {
                        const v = m.of(mine), base = d1 ? m.of(d1) : null;
                        const bg = thin || v == null || base == null ? undefined : goodBad(v - base, m.good, m.span);
                        return <td key={m.key} style={bg ? { background: bg } : undefined} title={base != null ? `D1 ${t} in ${sel === "all" ? "all counts" : sel}: ${(base * 100).toFixed(1)}%` : undefined}>{v == null ? "—" : (v * 100).toFixed(1)}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint pk-key">
            <span className="pk-swatch good" /> better than D1 for that pitch in that count <span className="pk-swatch bad" /> worse.
            {" "}Grey rows: under {MIN_N} pitches, too few to judge.
            {!norms && " D1 averages aren't loaded yet, so nothing is colored."}
          </p>
        </div>
      </div>
    </section>
  );
}
