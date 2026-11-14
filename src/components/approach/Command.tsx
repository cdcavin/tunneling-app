import { useEffect, useMemo, useState } from "react";
import { ZONE } from "../../lib/grid";
import type { PitchRow } from "../../lib/types";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { callLabel, missInches, targetBox, useCalls, type Call } from "../../lib/calls";
import OutingReplay from "./OutingReplay";

/** Called-spot codes (paper charts), relative to the hitter. Placed on the plate with targetBox once the hitter side is known. */
const SPOTS: { code: string[]; label: string }[] = [
  { code: ["4"], label: "Up away" }, { code: ["M", "MK"], label: "Up middle" }, { code: ["1"], label: "Up in" },
  { code: ["3"], label: "Down away" }, { code: ["G", "GL"], label: "Down middle" }, { code: ["2"], label: "Down in" },
  { code: ["7"], label: "Above the zone" }, { code: ["6"], label: "Below the zone" }, { code: ["5"], label: "Off the away edge" },
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

/**
 * One strike zone per pitch (catcher's view) for one hitter side: each called spot shaded by how close he gets to it
 * (red = more accurate than his own average for that pitch, blue = less), its average miss in inches, and an arrow from
 * the spot's center to where those pitches actually ended up on average.
 */
function Tendencies({ misses, types, hand }: { misses: Miss[]; types: string[]; hand: "Left" | "Right" }) {
  const SIDE = 1.7, TOP = 4.3, BOT = 0.7;            // tight around the zone and the off-zone spots (6 in outside it)
  const W = 240, PX = W / (2 * SIDE), H = (TOP - BOT) * PX;
  const x = (side: number) => (SIDE - side) * PX, y = (h: number) => (TOP - h) * PX;
  const clx = (v: number) => Math.max(4, Math.min(W - 4, v)), cly = (v: number) => Math.max(4, Math.min(H - 4, v));
  const zx = x(ZONE.halfWidth), zw = x(-ZONE.halfWidth) - zx, zy = y(ZONE.top), zh = y(ZONE.bottom) - zy;
  return (
    <div className="tend-grid">
      {types.map((t) => {
        const g = misses.filter((m) => m.r.type === t && m.r.batterSide === hand);
        if (!g.length) return (
          <div key={t} className="tend"><div className="tend-head"><i style={{ background: pitchColor(t) }} /><b>{t}</b><span>none charted vs {hand === "Left" ? "LHH" : "RHH"}</span></div></div>
        );
        const all = avg(g.map((m) => m.miss)) ?? 0;
        const a = avg(g.map((m) => m.arm)), u = avg(g.map((m) => m.up));
        const cells = SPOTS.map((sp) => {
          const h = g.filter((m) => spotOf(m.c.loc) === sp);
          const box = targetBox(sp.code[0], hand);
          return { sp, box, n: h.length, miss: avg(h.map((m) => m.miss)), side: avg(h.map((m) => m.r.side)), height: avg(h.map((m) => m.r.height)), pts: h };
        });
        const ranked = cells.filter((c) => c.n >= MIN_SPOT && c.miss != null).sort((p, q) => p.miss! - q.miss!);
        const best = ranked[0], worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
        const mk = `tend-head-${t.replace(/\W/g, "")}`;
        return (
          <div key={t} className="tend">
            <div className="tend-head"><i style={{ background: pitchColor(t) }} /><b>{t}</b><span>{g.length} charted · avg miss {all.toFixed(1)}″</span></div>
            <div className="tend-body">
              <svg className="tend-map" viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`${t} vs ${hand === "Left" ? "LHH" : "RHH"}: accuracy by called spot, catcher's view`}>
                <defs><marker id={mk} viewBox="0 0 6 6" refX="4" refY="3" markerWidth="4.5" markerHeight="4.5" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#ffffff" /></marker></defs>
                <rect className="ars-zone-bg" width={W} height={H} rx={4} />
                {cells.map(({ sp, box, n, miss }) => {
                  if (!box) return null;
                  const thin = n < MIN_SPOT || miss == null;
                  const z = thin ? 0 : Math.max(-1, Math.min(1, (all - miss!) / Math.max(3, all)));
                  const fill = thin ? "rgba(120,140,170,0.08)" : z >= 0 ? `rgba(217,68,63,${(0.18 + 0.55 * z).toFixed(2)})` : `rgba(58,120,220,${(0.18 + 0.55 * -z).toFixed(2)})`;
                  return <rect key={sp.label} x={x(box.x1)} y={y(box.y1)} width={x(box.x0) - x(box.x1)} height={y(box.y0) - y(box.y1)} fill={fill} className="tend-cell"><title>{`${sp.label}: ${n} charted${miss != null ? `, avg miss ${miss.toFixed(1)}″` : ""}`}</title></rect>;
                })}
                <rect className="ars-zone-box" x={zx} y={zy} width={zw} height={zh} pointerEvents="none" />
                {g.map((m) => <circle key={m.r.id} cx={clx(x(m.r.side))} cy={cly(y(m.r.height))} r={1.8} className="tend-pt" />)}
                {cells.map(({ sp, box, n, miss, side, height }) => {
                  if (!box || n < MIN_SPOT || miss == null || side == null || height == null) return null;
                  const bx = x((box.x0 + box.x1) / 2), by = y((box.y0 + box.y1) / 2);
                  const ex = clx(x(side)), ey = cly(y(height));
                  const far = Math.hypot(ex - bx, ey - by) > 6;
                  return (
                    <g key={sp.label} pointerEvents="none">
                      {far && <line x1={bx} y1={by} x2={ex} y2={ey} className="tend-arrow-l" markerEnd={`url(#${mk})`} />}
                      <text className="tend-v" x={bx} y={by + 4} textAnchor="middle">{miss.toFixed(1)}</text>
                    </g>
                  );
                })}
                <path className="ars-plate" d={`M${zx},${H + 3} L${zx + zw},${H + 3} L${zx + zw},${H + 7} L${zx + zw / 2},${H + 13} L${zx},${H + 7} Z`} />
              </svg>
              <div className="tend-side">
                <p>{lean(a, u)}.</p>
                {best && <p><span className="tend-good">Most accurate:</span> {best.sp.label.toLowerCase()} ({best.miss!.toFixed(1)}″, {best.n} pitches)</p>}
                {worst && worst !== best && <p><span className="tend-bad">Least accurate:</span> {worst.sp.label.toLowerCase()} ({worst.miss!.toFixed(1)}″, {worst.n} pitches)</p>}
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

const avg = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (p: number, q: number) => (q ? `${((p / q) * 100).toFixed(0)}%` : "—");
const signed = (v: number | null, unit = "") => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}${unit}`);

export default function Command({ rows, throws }: { rows: PitchRow[]; throws: "Right" | "Left" }) {
  const calls = useCalls();
  const [pick, setPick] = useState<Miss | null>(null);
  const [hand, setHand] = useState<"Left" | "Right">("Right");
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

  useEffect(() => {
    const l = misses.filter((m) => m.r.batterSide === "Left").length, r = misses.filter((m) => m.r.batterSide === "Right").length;
    setHand(l > r ? "Left" : "Right");
  }, [misses.length > 0 && misses[0].r.id]);   // eslint-disable-line react-hooks/exhaustive-deps
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
        <div className="tend-top">
          <div className="sec-title">Where each pitch misses, and where he's most accurate <span className="ars-sub">catcher's view · each box = a called spot · number = avg miss (in) · arrow = where those pitches actually went on average</span></div>
          <div className="segmented" role="radiogroup" aria-label="Hitter side">
            {(["Left", "Right"] as const).map((h) => <button key={h} type="button" role="radio" aria-checked={hand === h} className={hand === h ? "is-on" : ""} onClick={() => setHand(h)}>{h === "Left" ? "vs LHH" : "vs RHH"}</button>)}
          </div>
        </div>
        <Tendencies misses={misses} types={types} hand={hand} />
        <p className="hint pk-key"><span className="pk-swatch good" /> more accurate than his average for that pitch <span className="pk-swatch bad" /> less accurate. Small dots = every charted pitch of that type. Spots with under {MIN_SPOT} pitches aren't shaded and get no arrow.</p>
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
