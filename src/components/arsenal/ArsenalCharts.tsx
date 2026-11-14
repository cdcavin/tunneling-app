import { useEffect, useMemo, useRef, useState } from "react";
import { contourDensity } from "d3-contour";
import type { PitchRow } from "../../lib/types";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { ZONE } from "../../lib/grid";
import { HAND_CHOICES, kde1d, LAYERS, type ArsenalLine, type HandF, type HeatLayer } from "../../lib/arsenalStats";
import { FRAME } from "./ZoneDraw";

// ── Movement: every pitch as a dot, pitcher's view; click a dot for its video ──

export function ArsenalMovement({ rows, lines, throws = "Right", hasVideo, onPick, inside }: {
  rows: PitchRow[]; lines: ArsenalLine[]; throws?: "Right" | "Left";
  hasVideo: (r: PitchRow) => boolean; onPick: (r: PitchRow) => void;
  inside?: Set<string> | null;     // when a location is circled: pitches outside it are greyed
}) {
  const [hover, setHover] = useState<PitchRow | null>(null);
  const S = 400, cx = S / 2, cy = S / 2, R = 27, rad = 182;
  const sc = rad / R;
  const x = (hb: number) => cx + hb * sc;
  const y = (ivb: number) => cy - ivb * sc;
  const rings = [6, 12, 18, 24];
  const armRight = throws === "Right";
  return (
    <figure className="chart mvmt ars-mvmt">
      <div className="sec-title">Pitch movement</div>
      <svg viewBox={`0 -4 ${S} ${S + 22}`} role="img" aria-label="Movement plot, pitcher's view. Click a pitch to watch it.">
        <defs><clipPath id="ars-mvmt-clip"><circle cx={cx} cy={cy} r={rad} /></clipPath></defs>
        <circle className="mvmt-disc" cx={cx} cy={cy} r={rad} />
        {rings.map((r) => <circle key={r} className="mvmt-ring ars-ring" cx={cx} cy={cy} r={r * sc} />)}
        <line className="mvmt-axis" x1={cx - rad} x2={cx + rad} y1={cy} y2={cy} />
        <line className="mvmt-axis" x1={cx} x2={cx} y1={cy - rad} y2={cy + rad} />
        {rings.map((r) => <text key={r} className="mvmt-ringlabel" x={cx + 3} y={cy - r * sc - 2}>{r}″</text>)}
        <text className="mvmt-side" x={cx - rad + 4} y={cy + rad + 16}>{armRight ? "◀ Glove side" : "◀ Arm side"}</text>
        <text className="mvmt-side" x={cx + rad - 4} y={cy + rad + 16} textAnchor="end">{armRight ? "Arm side ▶" : "Glove side ▶"}</text>
        <text className="mvmt-side" x={cx} y={cy - rad - 6} textAnchor="middle">Rise ▲</text>
        <g clipPath="url(#ars-mvmt-clip)">
          {rows.map((r) => {
            const vid = hasVideo(r);
            const out = !!inside && !inside.has(r.id);
            const c = out ? "#4f6283" : pitchColor(r.type);
            return (
              <circle key={r.id} className={`ars-dot${vid ? " has-vid" : ""}${out ? " is-out" : ""}`} cx={x(r.hb)} cy={y(r.ivb)} r={3.4}
                fill={vid ? c : "transparent"} stroke={c} strokeWidth={vid ? 0 : 1.3}
                onMouseEnter={() => setHover(r)} onMouseLeave={() => setHover(null)}
                onClick={() => vid && onPick(r)} />
            );
          })}
        </g>
        <g pointerEvents="none">
          {lines.map((p) => (
            <g key={p.type}>
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={8} fill={pitchColor(p.type)} stroke="#ffffff" strokeWidth={2.5} />
              <text className="mvmt-label" x={x(p.hb) + 12} y={y(p.ivb) + 4}>{pitchAbbr(p.type)}</text>
            </g>
          ))}
        </g>
      </svg>
      {hover && (
        <div className="tip" role="status">
          <strong>{hover.type}, {hover.date}</strong>
          <span>{hover.velo.toFixed(1)} mph{hover.spin != null && `, ${hover.spin} rpm`}</span>
          <span>{hover.ivb.toFixed(1)} in IVB, {hover.hb.toFixed(1)} in HB</span>
          <span>vs {hover.opponent}: {hover.call}</span>
          <span>{hasVideo(hover) ? "Click to watch" : "No video (not at WVU's park)"}</span>
        </div>
      )}
    </figure>
  );
}

// ── Velo: one smooth curve per pitch type on a shared axis ──

/** Live pixel size of an element, so a chart can fill its panel at real text size. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function VeloRidges({ rows, lines }: { rows: PitchRow[]; lines: ArsenalLine[] }) {
  const order = [...lines].sort((a, b) => b.velo - a.velo);
  const vs = rows.map((r) => r.velo);
  const lo = Math.floor(Math.min(...vs) - 1.5), hi = Math.ceil(Math.max(...vs) + 1.5);    // tight to his range, not rounded out to 5s
  const step = hi - lo > 16 ? 5 : 2;
  const grid = useMemo(() => Array.from({ length: Math.round((hi - lo) / 0.25) + 1 }, (_, i) => lo + i * 0.25), [lo, hi]);
  const [box, size] = useSize<HTMLDivElement>();
  const n = order.length;
  const W = size.w || 300, L = 40, Rp = 10;
  const H = size.h >= 120 ? size.h : n * 52 + 40;     // fills the panel on a laptop; natural height when stacked on a phone
  const row = (H - 40) / (Math.max(1, n) + 0.45), peak = row * 1.45, top = 10 + peak - row;   // last baseline lands at H − 30
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - Rp);
  const ticks = Array.from({ length: Math.floor(hi / step) - Math.ceil(lo / step) + 1 }, (_, i) => (Math.ceil(lo / step) + i) * step);
  return (
    <figure className="chart ars-velo">
      <div className="sec-title">Velo by pitch</div>
      <div className="ars-fit" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Velocity distribution for each pitch type">
        {ticks.map((t) => <line key={t} className="ars-vgrid" x1={x(t)} x2={x(t)} y1={6} y2={H - 22} />)}
        {order.map((p, i) => {
          const d = kde1d(rows.filter((r) => r.type === p.type).map((r) => r.velo), grid, 0.6);
          const m = Math.max(...d) || 1;
          const base = top + (i + 1) * row;
          const pts = grid.map((g, j) => `${x(g).toFixed(1)},${(base - (d[j] / m) * peak).toFixed(1)}`);
          const c = pitchColor(p.type);
          return (
            <g key={p.type}>
              <path d={`M${x(lo)},${base} L${pts.join(" L")} L${x(hi)},${base} Z`} fill={c} fillOpacity={0.45} stroke={c} strokeWidth={1.5} />
              <line className="ars-base" x1={L} x2={W - Rp} y1={base} y2={base} />
              <text className="ars-ridge-label" x={2} y={base - 20}>{pitchAbbr(p.type)}</text>
              <text className="ars-ridge-num" x={2} y={base - 5}>{p.velo.toFixed(1)}</text>
            </g>
          );
        })}
        {ticks.map((t) => <text key={t} className="ars-tick" x={x(t)} y={H - 6} textAnchor="middle">{t}</text>)}
      </svg>
      </div>
    </figure>
  );
}

// ── Heatmaps: one per pitch type, catcher's view, smooth density contours ──

const RAMP = ["#1f4a7a", "#2a7a9a", "#3fa65a", "#b9d45a", "#f0c35b", "#ec8a4c", "#d9443f"];
const MIN_N = 5;

function ringsToPath(coords: number[][][][]): string {
  return coords.map((poly) => poly.map((ring) => `M${ring.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")}Z`).join("")).join("");
}

function ZoneMap({ type, rows, layer }: { type: string; rows: PitchRow[]; layer: HeatLayer }) {
  const SIDE = FRAME.side, HLO = FRAME.lo, HHI = FRAME.hi;
  const W = 150, H = (W * (HHI - HLO)) / (2 * SIDE);     // same scale both ways so a circle stays round
  const px = (side: number) => ((-side + SIDE) / (2 * SIDE)) * W;           // catcher's view: third-base side on the left
  const py = (h: number) => ((HHI - h) / (HHI - HLO)) * H;
  const pts = rows.filter(LAYERS[layer].keep);
  const bands = useMemo(() => (pts.length < MIN_N ? [] : contourDensity<PitchRow>()
    .x((r) => px(r.side)).y((r) => py(r.height)).size([W, H]).bandwidth(11).thresholds(RAMP.length + 1)(pts).slice(1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pts]);
  const zx = px(ZONE.halfWidth), zw = px(-ZONE.halfWidth) - zx, zy = py(ZONE.top), zh = py(ZONE.bottom) - zy;
  const id = `clip-${type.replace(/\W/g, "")}`;
  return (
    <figure className="ars-zone">
      <figcaption><i style={{ background: pitchColor(type) }} />{type}<span>{pts.length}{layer !== "location" && ` of ${rows.length}`}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label={`${type}: ${LAYERS[layer].label.toLowerCase()}, catcher's view`}>
        <defs><clipPath id={id}><rect width={W} height={H} rx={4} /></clipPath></defs>
        <rect className="ars-zone-bg" width={W} height={H} rx={4} />
        <g clipPath={`url(#${id})`}>
          {bands.map((b, i) => <path key={i} d={ringsToPath(b.coordinates as unknown as number[][][][])} fill={RAMP[Math.min(i, RAMP.length - 1)]} fillOpacity={0.85} />)}
          {pts.length < MIN_N && pts.map((r) => <circle key={r.id} cx={px(r.side)} cy={py(r.height)} r={3} className="ars-zone-dot" />)}
        </g>
        <rect className="ars-zone-box" x={zx} y={zy} width={zw} height={zh} />
        {[1, 2].map((k) => <line key={`v${k}`} className="ars-zone-third" x1={zx + (zw * k) / 3} x2={zx + (zw * k) / 3} y1={zy} y2={zy + zh} />)}
        {[1, 2].map((k) => <line key={`h${k}`} className="ars-zone-third" x1={zx} x2={zx + zw} y1={zy + (zh * k) / 3} y2={zy + (zh * k) / 3} />)}
        <path className="ars-plate" d={`M${zx},${H + 2} L${zx + zw},${H + 2} L${zx + zw},${H + 6} L${zx + zw / 2},${H + 11} L${zx},${H + 6} Z`} />
      </svg>
      {pts.length > 0 && pts.length < MIN_N && <div className="ars-few">Too few to shade</div>}
      {pts.length === 0 && <div className="ars-few">None</div>}
    </figure>
  );
}

/** Heatmaps show his full locations: the circle drawn in the left panel doesn't apply here. */
export function ZoneHeatmaps({ rows, types }: { rows: PitchRow[]; types: string[] }) {
  const [layer, setLayer] = useState<HeatLayer>("location");
  const [hand, setHand] = useState<HandF>("all");
  const sel = hand === "all" ? rows : rows.filter((r) => r.batterSide === hand);
  return (
    <section className="ars-heat">
      <div className="sec-title">Locations <span className="ars-sub">catcher's view</span></div>
      <div className="ars-heat-ctl">
        <div className="segmented" role="radiogroup" aria-label="Hitter side">
          {HAND_CHOICES.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={hand === k} className={hand === k ? "is-on" : ""} onClick={() => setHand(k)}>{l}</button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Shade by">
          {(Object.keys(LAYERS) as HeatLayer[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={layer === k} className={layer === k ? "is-on" : ""} onClick={() => setLayer(k)} title={LAYERS[k].help}>{LAYERS[k].label}</button>
          ))}
        </div>
      </div>
      <div className="ars-zone-grid" style={{ gridTemplateColumns: `repeat(${types.length <= 4 ? 2 : 3}, minmax(0, 1fr))` }} title={`${LAYERS[layer].help} Shading is relative within each map.`}>
        {types.map((t) => <ZoneMap key={t} type={t} rows={sel.filter((r) => r.type === t)} layer={layer} />)}
      </div>
    </section>
  );
}
