import { useState } from "react";
import { useSize } from "../../lib/useSize";
import { pinColor, pinLabel, type Outing, type Pin } from "../../lib/trends";

export interface Series { name: string; color: string; values: (number | null)[]; band?: [number, number] | null; bars?: boolean }

/** One outing-by-outing chart: x = outings in order (gaps over 60 days get a break line), pins as dashed lines. */
export default function TrendChart({ title, unit, outs, series, pins, selPin, onPin, fmt = (v) => v.toFixed(1), zero = false, legend = false }: {
  title: string; unit?: string; outs: Outing[]; series: Series[]; pins: Pin[]; selPin: string | null; onPin: (id: string) => void;
  fmt?: (v: number) => string; zero?: boolean; legend?: boolean;
}) {
  const [box, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(280, size.w), H = 190, L = 44, R = 10, T = 10, B = 24;
  const n = outs.length;
  const all = series.flatMap((s) => [...s.values.filter((v): v is number => v != null && Number.isFinite(v)), ...(s.band ?? [])]);
  if (!n || !all.length) return <figure className="tc"><figcaption>{title}</figcaption><p className="hint">No data.</p></figure>;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (zero) lo = Math.min(0, lo);
  const pad = (hi - lo) * 0.08 || 1; lo -= zero && lo === 0 ? 0 : pad; hi += pad;
  const IN = 16;   // keep the first and last outing clear of the axis labels and the edge
  const x = (i: number) => L + IN + (n === 1 ? (W - L - R - 2 * IN) / 2 : (i / (n - 1)) * (W - L - R - 2 * IN));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = Array.from({ length: 4 }, (_, k) => lo + ((k + 0.5) * (hi - lo)) / 4);
  const breaks = outs.map((o, i) => (i > 0 && (Date.parse(o.date) - Date.parse(outs[i - 1].date)) / 86400000 > 60 ? i : -1)).filter((i) => i > 0);
  const dateTicks = outs.map((o, i) => [i, o.date] as const).filter(([i]) => i === 0 || i === n - 1 || breaks.includes(i) || (n > 8 && i % Math.ceil(n / 6) === 0));
  const pinX = (p: Pin) => { const i = outs.findIndex((o) => o.date >= p.date); return i < 0 ? x(n - 1) + 6 : i === 0 ? x(0) - 6 : (x(i - 1) + x(i)) / 2; };
  const bw = Math.max(3, Math.min(18, ((W - L - R) / Math.max(1, n)) * 0.6));
  return (
    <figure className="tc">
      <figcaption>{title}{unit && <span> {unit}</span>}{legend && series.map((s) => <span key={s.name} className="tc-leg"><i style={{ background: s.color }} />{s.name}</span>)}</figcaption>
      <div ref={box} className="tc-box">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = e.clientX - r.left; let best = 0; for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; setHover(best); }}>
          {ticks.map((t) => <g key={t}><line className="tc-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="tc-tick" x={L - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text></g>)}
          {breaks.map((i) => <line key={`b${i}`} className="tc-break" x1={(x(i - 1) + x(i)) / 2} x2={(x(i - 1) + x(i)) / 2} y1={T} y2={H - B} />)}
          {series.map((s) => s.band && <rect key={`band-${s.name}`} x={L} width={W - L - R} y={y(s.band[1])} height={Math.max(1, y(s.band[0]) - y(s.band[1]))} fill={s.color} opacity={0.09} />)}
          {series.map((s) => s.bars
            ? s.values.map((v, i) => v != null && <rect key={`${s.name}${i}`} x={x(i) - bw / 2} width={bw} y={y(v)} height={Math.max(0, y(lo) - y(v))} fill={s.color} opacity={hover === i ? 1 : 0.75} rx={2} />)
            : (() => {
                const segs: string[] = []; let cur = "";
                s.values.forEach((v, i) => { if (v == null || !Number.isFinite(v)) { if (cur) segs.push(cur); cur = ""; return; } cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; });
                if (cur) segs.push(cur);
                return <g key={s.name}>{segs.map((d, k) => <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={2} />)}
                  {s.values.map((v, i) => v != null && Number.isFinite(v) && <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 2.8} fill={s.color} />)}</g>;
              })())}
          {pins.map((p) => (
            <g key={p.id} className={`tc-pin${selPin === p.id ? " is-on" : ""}`} onClick={() => onPin(p.id)}>
              <line x1={pinX(p)} x2={pinX(p)} y1={T} y2={H - B} stroke={pinColor(p.kind)} strokeWidth={selPin === p.id ? 2.5 : 1.5} strokeDasharray="4 3" />
              <rect x={pinX(p) - 6} y={T - 2} width={12} height={H - B - T + 4} fill="transparent"><title>{`${pinLabel(p.kind)} · ${p.date}${p.pitch ? ` · ${p.pitch}` : ""}${p.note ? ` · ${p.note}` : ""}`}</title></rect>
              <circle cx={pinX(p)} cy={T + 2} r={4} fill={pinColor(p.kind)} />
            </g>
          ))}
          {dateTicks.map(([i, d]) => <text key={`d${i}`} className="tc-tick" x={x(i)} y={H - 6} textAnchor={i === n - 1 && n > 1 ? "end" : i === 0 ? "start" : "middle"}>{d.slice(5).replace("-", "/")}{breaks.includes(i) || i === 0 ? `/${d.slice(2, 4)}` : ""}</text>)}
          {hover != null && <line className="tc-hover" x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} />}
        </svg>
        {hover != null && (
          <div className="tc-tip" style={{ left: Math.min(W - 170, Math.max(0, x(hover) + 10)) }}>
            <b>{outs[hover].date} vs {outs[hover].opp}</b>
            {series.map((s) => s.values[hover] != null && <span key={s.name}><i style={{ background: s.color }} />{s.name}: {fmt(s.values[hover]!)}</span>)}
          </div>
        )}
      </div>
    </figure>
  );
}
