import { useMemo, useState } from "react";
import type { PitchRow } from "../../lib/types";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { callLabel, missInches, targetBox, useCalls, type Call } from "../../lib/calls";
import OutingReplay from "./OutingReplay";

/** Called-spot codes laid out as the hitter sees the plate: away | middle | in, top and bottom halves, then the off-zone spots. */
const SPOTS: { code: string[]; label: string; col: number; row: number }[] = [
  { code: ["7"], label: "Above", col: 1, row: 0 },
  { code: ["4"], label: "Up away", col: 0, row: 1 }, { code: ["M", "MK"], label: "Up middle", col: 1, row: 1 }, { code: ["1"], label: "Up in", col: 2, row: 1 },
  { code: ["3"], label: "Down away", col: 0, row: 2 }, { code: ["G", "GL"], label: "Down middle", col: 1, row: 2 }, { code: ["2"], label: "Down in", col: 2, row: 2 },
  { code: ["6"], label: "Below", col: 1, row: 3 }, { code: ["5"], label: "Off away", col: 3, row: 1.5 },
];
const spotOf = (loc: string) => { const k = loc.toUpperCase().replace(/[CD?]+$/, "").trim(); return SPOTS.find((s) => s.code.includes(k)); };
const MIN_SPOT = 3;

/** Plain-words lean: which way he misses on average, from the center of the called spot. */
function lean(arm: number | null, up: number | null) {
  const parts: string[] = [];
  if (arm != null && Math.abs(arm) >= 1) parts.push(`${Math.abs(arm).toFixed(1)}″ ${arm > 0 ? "arm side" : "glove side"}`);
  if (up != null && Math.abs(up) >= 1) parts.push(`${Math.abs(up).toFixed(1)}″ ${up > 0 ? "up" : "down"}`);
  return parts.length ? `Misses ${parts.join(" and ")} on average` : "No clear lean: misses spread evenly";
}

/** One card per pitch: his lean, plus average miss to each called spot (red = accurate, blue = wild, vs his own average for that pitch). */
function Tendencies({ misses, types }: { misses: Miss[]; types: string[] }) {
  return (
    <div className="tend-grid">
      {types.map((t) => {
        const g = misses.filter((m) => m.r.type === t);
        const all = avg(g.map((m) => m.miss)) ?? 0;
        const a = avg(g.map((m) => m.arm)), u = avg(g.map((m) => m.up));
        const cells = SPOTS.map((s) => {
          const h = g.filter((m) => spotOf(m.c.loc) === s);
          return { s, n: h.length, miss: avg(h.map((m) => m.miss)) };
        });
        const ranked = cells.filter((c) => c.n >= MIN_SPOT && c.miss != null).sort((x, y) => x.miss! - y.miss!);
        const best = ranked[0], worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
        const L = 46, G = 4;
        const ax = 30, ay = 30, sc = 3.2;
        return (
          <div key={t} className="tend">
            <div className="tend-head"><i style={{ background: pitchColor(t) }} /><b>{t}</b><span>{g.length} charted · avg miss {all.toFixed(1)}″</span></div>
            <div className="tend-body">
              <svg className="tend-map" viewBox={`0 0 ${4 * (L + G)} ${4 * (L + G)}`} role="img" aria-label={`${t}: average miss by called spot, hitter's view`}>
                {cells.map(({ s, n, miss }) => {
                  const thin = n < MIN_SPOT || miss == null;
                  const z = thin ? 0 : Math.max(-1, Math.min(1, (all - miss!) / Math.max(3, all)));
                  const fill = thin ? "rgba(120,140,170,0.10)" : z >= 0 ? `rgba(217,68,63,${(0.15 + 0.6 * z).toFixed(2)})` : `rgba(58,120,220,${(0.15 + 0.6 * -z).toFixed(2)})`;
                  const x0 = s.col * (L + G), y0 = s.row * (L + G);
                  return (
                    <g key={s.label}>
                      <rect x={x0} y={y0} width={L} height={L} rx={4} fill={fill} className={s.row >= 1 && s.row <= 2 && s.col <= 2 ? "tend-in" : "tend-off"}><title>{`${s.label}: ${n} charted${miss != null ? `, avg miss ${miss.toFixed(1)}″` : ""}`}</title></rect>
                      <text className="tend-v" x={x0 + L / 2} y={y0 + L / 2 + 1} textAnchor="middle">{thin ? (n ? "·" : "") : miss!.toFixed(1)}</text>
                      <text className="tend-n" x={x0 + L / 2} y={y0 + L - 6} textAnchor="middle">{n || ""}</text>
                    </g>
                  );
                })}
              </svg>
              <div className="tend-side">
                <svg className="tend-arrow" viewBox="0 0 60 60" role="img" aria-label="Average miss direction, pitcher's view, arm side right">
                  <circle cx={ax} cy={ay} r={26} className="cmd-ring" />
                  <line x1={4} x2={56} y1={ay} y2={ay} className="cmd-axis" /><line y1={4} y2={56} x1={ax} x2={ax} className="cmd-axis" />
                  {a != null && u != null && <line x1={ax} y1={ay} x2={ax + Math.max(-24, Math.min(24, a * sc))} y2={ay - Math.max(-24, Math.min(24, u * sc))} stroke={pitchColor(t)} strokeWidth={3} markerEnd="url(#tend-head)" />}
                  <defs><marker id="tend-head" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#eef2f8" /></marker></defs>
                </svg>
                <p>{lean(a, u)}.</p>
                {best && <p><span className="tend-good">Most accurate:</span> {best.s.label.toLowerCase()} ({best.miss!.toFixed(1)}″, {best.n})</p>}
                {worst && worst !== best && <p><span className="tend-bad">Least accurate:</span> {worst.s.label.toLowerCase()} ({worst.miss!.toFixed(1)}″, {worst.n})</p>}
                {!best && <p className="hint">Not enough charted pitches at any one spot yet (needs {MIN_SPOT}+).</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One charted pitch: miss to the target box (the paper-chart definition) plus its offset from the box's center. */
interface Miss { r: PitchRow; c: Call; miss: number; arm: number; up: number }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "—");
const signed = (v: number | null, unit = "") => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}${unit}`);

export default function Command({ rows, throws }: { rows: PitchRow[]; throws: "Right" | "Left" }) {
  const calls = useCalls();
  const [pick, setPick] = useState<Miss | null>(null);
  const arm = throws === "Left" ? -1 : 1;   // PlateLocSide + = third-base side = a righty's arm side
  const misses = useMemo(() => {
    const out: Miss[] = [];
    for (const r of rows) {
      const c = calls[r.id];
      const m = missInches(r, c);
      const box = c && targetBox(c.loc, r.batterSide);
      if (m == null || !box) continue;
      out.push({ r, c: c!, miss: m, arm: (r.side - (box.x0 + box.x1) / 2) * 12 * arm, up: (r.height - (box.y0 + box.y1) / 2) * 12 });
    }
    return out;
  }, [rows, calls, arm]);

  const types = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of misses) n.set(m.r.type, (n.get(m.r.type) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [misses]);

  if (!misses.length) {
    return (
      <section className="ap-sec" id="command">
        <header className="ap-head"><h2>Command</h2></header>
        <div className="card cmd-none">
          <p><b>No paper charts for this pitcher.</b></p>
          <p className="hint">Command compares each pitch to the catcher's called spot, which only exists for WVU outings that were charted. Other pitchers, and uncharted outings, can't be measured here.</p>
        </div>
      </section>
    );
  }

  const R = 30;                      // plot reaches ±30 in from the target's center
  const S = 340, c0 = S / 2, k = (S / 2 - 16) / R;
  const line = (label: string, g: Miss[], color?: string) => {
    const ms = g.map((m) => m.miss);
    return (
      <tr key={label}>
        <th scope="row">{color && <i style={{ background: color }} />}{label}</th>
        <td>{g.length}</td>
        <td>{pct(ms.filter((m) => m === 0).length, ms.length)}</td>
        <td>{avg(ms)?.toFixed(1) ?? "—"}</td>
        <td>{median(ms)?.toFixed(1) ?? "—"}</td>
        <td>{pct(ms.filter((m) => m <= 6).length, ms.length)}</td>
        <td>{pct(ms.filter((m) => m > 12).length, ms.length)}</td>
        <td>{signed(avg(g.map((m) => m.arm)), "″")}</td>
        <td>{signed(avg(g.map((m) => m.up)), "″")}</td>
      </tr>
    );
  };

  return (
    <section className="ap-sec" id="command">
      <header className="ap-head">
        <h2>Command</h2>
        <span className="hint">Every charted pitch vs the catcher's called spot. {misses.length} of {rows.length} pitches in these filters have a call.</span>
      </header>
      <OutingReplay rows={rows} calls={calls} />
      <div className="card">
        <div className="sec-title">Where each pitch misses, and where he's most accurate <span className="ars-sub">grid = called spot from the hitter's view (away · middle · in); number = avg miss in inches; small number = pitches</span></div>
        <Tendencies misses={misses} types={types} />
        <p className="hint pk-key"><span className="pk-swatch good" /> more accurate than his average for that pitch <span className="pk-swatch bad" /> less accurate. Arrow = his average miss from the center of the called spot (pitcher's view, arm side right). Spots with under {MIN_SPOT} pitches aren't shaded.</p>
      </div>
      <div className="ap-row cmd-row">
        <div className="card cmd-plot">
          <div className="sec-title">Where misses go <span className="ars-sub">arm side always to the right · from the center of the called spot</span></div>
          <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Miss plot: each pitch's offset from its target">
            {[6, 12, 18, 24].map((r) => <circle key={r} cx={c0} cy={c0} r={r * k} className="cmd-ring" />)}
            {[6, 12, 18, 24].map((r) => <text key={r} className="cmd-ringlabel" x={c0 + 3} y={c0 - r * k - 2}>{r}″</text>)}
            <line className="cmd-axis" x1={8} x2={S - 8} y1={c0} y2={c0} />
            <line className="cmd-axis" x1={c0} x2={c0} y1={8} y2={S - 8} />
            <text className="cmd-side" x={10} y={S - 8}>◀ Glove side</text>
            <text className="cmd-side" x={S - 10} y={S - 8} textAnchor="end">Arm side ▶</text>
            <text className="cmd-side" x={c0 + 6} y={18}>High ▲</text>
            {misses.map((m) => {
              const x = c0 + Math.max(-R, Math.min(R, m.arm)) * k, y = c0 - Math.max(-R, Math.min(R, m.up)) * k;
              return <circle key={m.r.id} cx={x} cy={y} r={pick?.r.id === m.r.id ? 6 : 3.6} fill={pitchColor(m.r.type)} className={`cmd-dot${m.miss === 0 ? " hit" : ""}`} onClick={() => setPick(m)} />;
            })}
          </svg>
          {pick ? (
            <p className="hint cmd-pick">
              <b>{pick.r.date} · {pick.r.count ?? ""} · {pick.r.type}</b> · called <b>{callLabel(pick.c)}</b> · {pick.r.call} · miss {pick.miss.toFixed(1)}″
              ({signed(pick.arm)}″ arm side, {signed(pick.up)}″ up)
            </p>
          ) : <p className="hint">Click a dot for that pitch's call. Pitches past 30″ sit on the edge.</p>}
        </div>
        <div className="card cmd-table-card">
          <div className="sec-title">Misses by pitch</div>
          <div className="ars-table-wrap">
            <table className="ars-table">
              <thead>
                <tr>
                  <th>Pitch</th>
                  <th title="Charted pitches (had a called spot)">Charted</th>
                  <th title="Share that landed inside the called box">Hit spot</th>
                  <th title="Average distance from the called box, inches (0 = hit it)">Avg miss</th>
                  <th title="Median distance from the called box, inches">Med miss</th>
                  <th title="Share within 6 inches of the called box">≤ 6″</th>
                  <th title="Share more than 12 inches off the called box">&gt; 12″</th>
                  <th title="Average left-right miss from the center of the spot: + = arm side, − = glove side">Arm/glove</th>
                  <th title="Average up-down miss from the center of the spot: + = high, − = low">Up/down</th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => line(pitchAbbr(t), misses.filter((m) => m.r.type === t), pitchColor(t)))}
                {line("All", misses)}
              </tbody>
            </table>
          </div>
          <div className="sec-title cmd-log-title">By count</div>
          <div className="ars-table-wrap">
            <table className="ars-table">
              <thead><tr><th>Count</th><th>Charted</th><th>Hit spot</th><th>Avg miss</th><th>Med miss</th><th>≤ 6″</th><th>&gt; 12″</th><th>Arm/glove</th><th>Up/down</th></tr></thead>
              <tbody>
                {([["Ahead", (b: number, s: number) => s > b], ["Even", (b: number, s: number) => s === b], ["Behind", (b: number, s: number) => b > s], ["2 strikes", (_b: number, s: number) => s === 2]] as [string, (b: number, s: number) => boolean][])
                  .map(([label, f]) => line(label, misses.filter((m) => { const x = (m.r.count ?? "").match(/^(\d)-(\d)$/); return !!x && f(+x[1], +x[2]); })))}
              </tbody>
            </table>
          </div>
          <p className="hint">Miss = inches from where the ball crossed to the nearest edge of the called box (paper-chart codes). Arm/glove and up/down are measured from the box's center, so they show the direction he misses.</p>
        </div>
      </div>
    </section>
  );
}
