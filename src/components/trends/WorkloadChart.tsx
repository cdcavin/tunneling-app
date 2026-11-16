import { useState } from "react";
import { useSize } from "../../lib/useSize";
import { shortDate, type Axis, type WorkEvent } from "../../lib/trends";

const KIND: Record<WorkEvent["kind"], [string, string]> = { start: ["Start", "#eaaa00"], relief: ["Relief", "#4fc3f7"], scrimmage: ["Scrimmage", "#8a9bb5"], pen: ["Bullpen", "#b388ff"] };
const DAY = 86400000;
const CH = 6.2;

export default function WorkloadChart({ events, axis }: { events: WorkEvent[]; axis: Axis }) {
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!events.length) return <p className="hint">No outings or bullpens in these filters.</p>;
  const W = Math.max(320, size.w), L = 44, R = 10, IN = 16, T = 22, BASE = 160;
  const pens = events.filter((e) => e.kind === "pen" && e.intent != null);
  const IT = BASE + 34, IB = IT + 58;
  const H = (pens.length ? IB : BASE + 22) + 24;
  const PW = W - L - R - 2 * IN;
  const X = (d: string) => L + IN + axis.pos(d) * PW;
  const xt = axis.ticksFor(PW);
  const maxN = Math.max(...events.map((e) => e.n), 10);
  const y = (n: number) => BASE - (n / maxN) * (BASE - T);

  const count = new Map<string, number>(), slot = new Map<string, number>();
  events.forEach((e) => count.set(e.date, (count.get(e.date) ?? 0) + 1));
  const perDay = Math.max(...count.values());
  const xs = [...new Set(events.map((e) => X(e.date)))].sort((a, b) => a - b);
  const gaps = xs.slice(1).map((v, i) => v - xs[i]).sort((a, b) => a - b);
  const tight = gaps.length ? gaps[Math.floor(gaps.length * 0.15)] : 40;
  const bw = Math.max(3, Math.min(11, (tight * 0.8) / perDay));
  const pos = events.map((e) => { const i = slot.get(e.date) ?? 0; slot.set(e.date, i + 1); return i; });
  const bx = (i: number) => X(events[i].date) - bw / 2 + (pos[i] - ((count.get(events[i].date) ?? 1) - 1) / 2) * (bw + 1);

  const placed: [number, number, number, number][] = [];
  const show = new Set<number>();
  const order = events.map((_, i) => i).sort((a, b) => (events[a].kind === "pen" ? 1 : 0) - (events[b].kind === "pen" ? 1 : 0) || events[b].n - events[a].n);
  for (const i of order) {
    const w = String(events[i].n).length * CH + 2, cx = bx(i) + bw / 2, ty = y(events[i].n) - 4;
    const r: [number, number, number, number] = [cx - w / 2, cx + w / 2, ty - 10, ty];
    if (placed.some((p) => r[0] < p[1] && r[1] > p[0] && r[2] < p[3] && r[3] > p[2])) continue;
    if (events.some((e, j) => j !== i && bx(j) < r[1] && bx(j) + bw > r[0] && y(e.n) < r[3])) continue;
    placed.push(r); show.add(i);
  }

  const games = events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind !== "pen");
  const ints = pens.map((e) => e.intent!);
  const ilo = Math.min(0.88, ...ints) - 0.01, ihi = Math.max(1.0, ...ints) + 0.01;
  const iy = (v: number) => IB - ((v - ilo) / (ihi - ilo)) * (IB - IT);
  const penIdx = events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "pen" && e.intent != null);
  const h = hover != null ? events[hover] : null;

  return (
    <div className="wl">
      <div className="wl-legend">{(Object.keys(KIND) as WorkEvent["kind"][]).map((k) => <span key={k}><i style={{ background: KIND[k][1] }} />{KIND[k][0]}</span>)}<span className="hint">Number on top = pitches (hidden when bars are too close; hover for it). Brackets = days between outings.</span></div>
      <div ref={box} className="tc-box">
        <svg width={W} height={H} role="img" aria-label="Pitches per outing and bullpen on a calendar">
          {xt.map((t) => <g key={t.d}><line className="tc-vgrid" x1={L + IN + t.at * PW} x2={L + IN + t.at * PW} y1={T - 6} y2={pens.length ? IB : BASE} /><text className="tc-tick" x={L + IN + t.at * PW} y={H - 6} textAnchor="middle">{t.label}</text></g>)}
          {axis.breaks.map((b) => { const x0 = L + IN + b * PW; return <g key={b} className="tc-break"><line x1={x0} x2={x0} y1={T - 6} y2={pens.length ? IB : BASE} /><text x={x0} y={T - 8} textAnchor="middle">≈</text></g>; })}
          <line className="wl-base" x1={L} x2={W - R} y1={BASE} y2={BASE} />
          {games.slice(1).map(({ i }, k) => {
            const p = games[k], a = bx(p.i) + bw + 2, b = bx(i) - 2, dd = Math.round((Date.parse(events[i].date) - Date.parse(events[p.i].date)) / DAY);
            if (b - a < 30) return null;
            const yy = BASE + 16;
            return <g key={`br${i}`} className="wl-br"><line x1={a} x2={b} y1={yy} y2={yy} /><line x1={a} x2={a} y1={yy - 4} y2={yy + 4} /><line x1={b} x2={b} y1={yy - 4} y2={yy + 4} />
              <text x={(a + b) / 2} y={yy - 4} textAnchor="middle">{dd} d</text></g>;
          })}
          {events.map((e, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={bx(i) - 1} y={T} width={bw + 2} height={BASE - T} fill="transparent" />
              <rect x={bx(i)} y={y(e.n)} width={bw} height={BASE - y(e.n)} fill={KIND[e.kind][1]} opacity={hover == null || hover === i ? 0.95 : 0.45} rx={Math.min(2, bw / 3)} />
              {show.has(i) && <text className={`wl-n${e.kind === "pen" ? " pen" : ""}`} x={bx(i) + bw / 2} y={y(e.n) - 4} textAnchor="middle">{e.n}</text>}
            </g>
          ))}
          {pens.length > 0 && (
            <g className="wl-int">
              <text className="wl-int-title" x={L} y={IT - 6}>Bullpen intent (pen fastball velo ÷ his game fastball velo)</text>
              {[0.9, 0.95, 1].filter((v) => v > ilo && v < ihi).map((v) => <g key={v}><line className="tc-grid" x1={L} x2={W - R} y1={iy(v)} y2={iy(v)} /><text className="tc-tick" x={L - 6} y={iy(v) + 4} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
              <path d={penIdx.map(({ i, e }, k) => `${k && !axis.breaks.some((b) => b > axis.pos(events[penIdx[k - 1].i].date) && b < axis.pos(e.date)) ? "L" : "M"}${(bx(i) + bw / 2).toFixed(1)},${iy(e.intent!).toFixed(1)}`).join("")} fill="none" stroke={KIND.pen[1]} strokeWidth={1.2} opacity={0.5} />
              {penIdx.map(({ i, e }) => <circle key={i} cx={bx(i) + bw / 2} cy={iy(e.intent!)} r={hover === i ? 4.5 : 3} fill={KIND.pen[1]} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />)}
            </g>
          )}
        </svg>
      </div>
      <p className="hint wl-hover">{h
        ? `${shortDate(h.date)} · ${KIND[h.kind][0]}${h.opp && h.kind !== "pen" ? ` vs ${h.opp}` : ""} · ${h.n} pitches${h.intent ? ` · intent ${Math.round(h.intent * 100)}%` : ""}`
        : "Hover a bar or dot for details."}</p>
    </div>
  );
}
