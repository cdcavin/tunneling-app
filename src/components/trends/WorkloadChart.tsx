import { useState } from "react";
import type { WorkEvent } from "../../lib/trends";

const KIND: Record<WorkEvent["kind"], [string, string]> = { start: ["Start", "#eaaa00"], relief: ["Relief", "#4fc3f7"], scrimmage: ["Scrimmage", "#8a9bb5"], pen: ["Bullpen", "#b388ff"] };
const DAY = 86400000;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * Workload on a real calendar: a bar per game outing (start / relief / scrimmage) and per bullpen, labeled with pitches
 * (and intent for pens), with a bracket between consecutive games showing the days in between. Scrolls sideways.
 */
export default function WorkloadChart({ events }: { events: WorkEvent[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!events.length) return <p className="hint">No outings or bullpens in these filters.</p>;
  const t0 = Date.parse(events[0].date), t1 = Date.parse(events[events.length - 1].date);
  const days = Math.round((t1 - t0) / DAY);
  const PX = Math.max(14, Math.min(40, 900 / Math.max(1, days)));
  const L = 36, R = 40, T = 26, H = 210, BASE = 168;
  const W = L + R + days * PX;
  const x = (d: string) => L + 20 + Math.round((Date.parse(d) - t0) / DAY) * PX;
  const maxN = Math.max(...events.map((e) => e.n), 10);
  const y = (n: number) => BASE - (n / maxN) * (BASE - T);
  // Stack same-day events side by side.
  const slot = new Map<string, number>(); const pos = events.map((e) => { const k = e.date; const i = slot.get(k) ?? 0; slot.set(k, i + 1); return i; });
  const bw = (e: WorkEvent) => (e.kind === "pen" ? Math.min(10, PX * 0.5) : Math.min(16, PX * 0.75));
  const bx = (e: WorkEvent, i: number) => x(e.date) + pos[i] * (bw(e) + 2) - bw(e) / 2;
  const games = events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== "pen");
  const ticks = Array.from({ length: Math.floor(days / 7) + 1 }, (_, k) => new Date(t0 + k * 7 * DAY).toISOString().slice(0, 10));
  return (
    <div className="wl">
      <div className="wl-legend">{(Object.keys(KIND) as WorkEvent["kind"][]).map((k) => <span key={k}><i style={{ background: KIND[k][1] }} />{KIND[k][0]}</span>)}<span className="hint">Bullpen label = pitches · intent (pen fastball velo as % of his game fastball velo)</span></div>
      <div className="wl-scroll">
        <svg width={W + 20} height={H} role="img" aria-label="Pitches per outing and bullpen on a calendar">
          {ticks.map((d) => <line key={d} className="tc-grid" x1={x(d)} x2={x(d)} y1={T - 6} y2={BASE} />)}
          <line className="wl-base" x1={L} x2={W + 10} y1={BASE} y2={BASE} />
          {games.slice(1).map(({ e, i }, k) => {
            const p = games[k], a = bx(p.e, p.i) + bw(p.e), b = bx(e, i), dd = Math.round((Date.parse(e.date) - Date.parse(p.e.date)) / DAY);
            if (b - a < 18) return null;
            const yy = BASE + 22;
            return <g key={`br${i}`} className="wl-br"><line x1={a + 2} x2={b - 2} y1={yy} y2={yy} /><line x1={a + 2} x2={a + 2} y1={yy - 4} y2={yy + 4} /><line x1={b - 2} x2={b - 2} y1={yy - 4} y2={yy + 4} />
              <text x={(a + b) / 2} y={yy - 5} textAnchor="middle">{dd} {dd === 1 ? "day" : "days"}</text></g>;
          })}
          {events.map((e, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={bx(e, i)} y={y(e.n)} width={bw(e)} height={BASE - y(e.n)} fill={KIND[e.kind][1]} opacity={hover == null || hover === i ? 0.95 : 0.55} rx={2} />
              <text className={`wl-n${e.kind === "pen" ? " pen" : ""}`} x={bx(e, i) + bw(e) / 2} y={y(e.n) - 5} textAnchor="middle">{e.label}</text>
              <text className="wl-d" x={bx(e, i) + bw(e) / 2} y={BASE + 11} textAnchor="middle">{md(e.date)}</text>
            </g>
          ))}
        </svg>
      </div>
      {hover != null && <p className="hint wl-hover">{events[hover].date} · {KIND[events[hover].kind][0]}{events[hover].opp && events[hover].kind !== "pen" ? ` vs ${events[hover].opp}` : ""} · {events[hover].n} pitches{events[hover].intent ? ` · intent ${Math.round(events[hover].intent! * 100)}%` : ""}</p>}
    </div>
  );
}
