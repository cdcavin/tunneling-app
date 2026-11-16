import { useState } from "react";
import { useSize } from "../../lib/useSize";
import { shortDate, type Axis, type WorkEvent } from "../../lib/trends";

const KIND: Record<WorkEvent["kind"], [string, string]> = { start: ["Start", "#eaaa00"], relief: ["Relief", "#4fc3f7"], scrimmage: ["Scrimmage", "#8a9bb5"], pen: ["Bullpen", "#b388ff"] };
const DAY = 86400000;

/**
 * Workload on the same calendar as the other Trends charts: a bar per outing (start / relief / scrimmage) and per bullpen,
 * labeled with pitches (and intent for pens), with a bracket between consecutive outings showing the days in between.
 */
export default function WorkloadChart({ events, axis }: { events: WorkEvent[]; axis: Axis }) {
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!events.length) return <p className="hint">No outings or bullpens in these filters.</p>;
  const W = Math.max(320, size.w), L = 44, R = 10, IN = 16, T = 26, BASE = 170, H = 222;
  const X = (d: string) => L + IN + axis.pos(d) * (W - L - R - 2 * IN);
  const maxN = Math.max(...events.map((e) => e.n), 10);
  const y = (n: number) => BASE - (n / maxN) * (BASE - T);
  const slot = new Map<string, number>(), count = new Map<string, number>();
  events.forEach((e) => count.set(e.date, (count.get(e.date) ?? 0) + 1));
  const pos = events.map((e) => { const i = slot.get(e.date) ?? 0; slot.set(e.date, i + 1); return i; });
  const bw = (e: WorkEvent) => (e.kind === "pen" ? 7 : 11);
  const bx = (e: WorkEvent, i: number) => X(e.date) - bw(e) / 2 + (pos[i] - ((count.get(e.date) ?? 1) - 1) / 2) * 13;
  const games = events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== "pen");
  return (
    <div className="wl">
      <div className="wl-legend">{(Object.keys(KIND) as WorkEvent["kind"][]).map((k) => <span key={k}><i style={{ background: KIND[k][1] }} />{KIND[k][0]}</span>)}<span className="hint">Number on top = pitches; bullpens also show intent. Brackets = days between outings.</span></div>
      <div ref={box} className="tc-box">
        <svg width={W} height={H} role="img" aria-label="Pitches per outing and bullpen on a calendar">
          {axis.ticks.map((t) => <g key={t.d}><line className="tc-vgrid" x1={X(t.d)} x2={X(t.d)} y1={T - 8} y2={BASE} /><text className="tc-tick" x={X(t.d)} y={H - 4} textAnchor="middle">{t.label}</text></g>)}
          {axis.breaks.map((b) => { const x0 = L + IN + b * (W - L - R - 2 * IN); return <g key={b} className="tc-break"><line x1={x0} x2={x0} y1={T - 8} y2={BASE} /><text x={x0} y={T} textAnchor="middle">≈</text></g>; })}
          <line className="wl-base" x1={L} x2={W - R} y1={BASE} y2={BASE} />
          {games.slice(1).map(({ e, i }, k) => {
            const p = games[k], a = bx(p.e, p.i) + bw(p.e) + 2, b = bx(e, i) - 2, dd = Math.round((Date.parse(e.date) - Date.parse(p.e.date)) / DAY);
            if (b - a < 26) return null;
            const yy = BASE + 18;
            return <g key={`br${i}`} className="wl-br"><line x1={a} x2={b} y1={yy} y2={yy} /><line x1={a} x2={a} y1={yy - 4} y2={yy + 4} /><line x1={b} x2={b} y1={yy - 4} y2={yy + 4} />
              <text x={(a + b) / 2} y={yy - 4} textAnchor="middle">{dd} d</text></g>;
          })}
          {events.map((e, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={bx(e, i)} y={y(e.n)} width={bw(e)} height={BASE - y(e.n)} fill={KIND[e.kind][1]} opacity={hover == null || hover === i ? 0.95 : 0.5} rx={2} />
              <text className={`wl-n${e.kind === "pen" ? " pen" : ""}`} x={bx(e, i) + bw(e) / 2} y={y(e.n) - 5} textAnchor="middle">{e.kind === "pen" && e.intent ? `${e.n}·${Math.round(e.intent * 100)}%` : e.n}</text>
            </g>
          ))}
        </svg>
      </div>
      <p className="hint wl-hover">{hover != null
        ? `${shortDate(events[hover].date)} · ${KIND[events[hover].kind][0]}${events[hover].opp && events[hover].kind !== "pen" ? ` vs ${events[hover].opp}` : ""} · ${events[hover].n} pitches${events[hover].intent ? ` · intent ${Math.round(events[hover].intent! * 100)}% (pen fastball velo ÷ his game fastball velo)` : ""}`
        : "Hover a bar for details."}</p>
    </div>
  );
}
