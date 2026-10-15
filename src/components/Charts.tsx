import { useState } from "react";
import type { ArsenalPitch, PitchRow } from "../lib/types";
import { pitchAbbr, pitchColor } from "../lib/pitchColors";
import { DECISION_FT, type SepSample } from "../lib/physics";

// ── Movement plot: induced vertical break vs horizontal break, one dot per pitch type ──

interface MovementProps {
  pitches: ArsenalPitch[];       // type averages over the selection
  rows?: PitchRow[];             // every selected pitch, drawn as small dots
  lastType: string | null;
  nextType: string | null;
  throws?: "Right" | "Left";
  modified?: { type: string; ivb: number; hb: number; velo: number } | null;
}

/**
 * Savant-style movement plot: pitcher's view, rings every 6 in, every pitch as a faint dot and
 * each type's average as a labeled marker. Trackman HB is + toward third base, which is the
 * pitcher's right, so x = +HB to the right; arm side is right for a righty, left for a lefty.
 */
export function MovementPlot({ pitches, rows = [], lastType, nextType, throws = "Right", modified }: MovementProps) {
  const [hover, setHover] = useState<ArsenalPitch | null>(null);
  const [hoverRow, setHoverRow] = useState<PitchRow | null>(null);
  const S = 300, cx = S / 2, cy = S / 2 - 4, R = 27, rad = 122;   // R = inches at the outer ring
  const sc = rad / R;
  const x = (hb: number) => cx + hb * sc;
  const y = (ivb: number) => cy - ivb * sc;
  const rings = [6, 12, 18, 24];
  const armRight = throws === "Right";
  return (
    <figure className="chart mvmt"><div className="sec-title">Pitch movement</div>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Movement plot of this pitcher's arsenal, pitcher's view">
        <defs>
          <clipPath id="mvmt-clip"><circle cx={cx} cy={cy} r={rad} /></clipPath>
        </defs>
        <circle className="mvmt-disc" cx={cx} cy={cy} r={rad} />
        {rings.map((r) => <circle key={r} className="mvmt-ring" cx={cx} cy={cy} r={r * sc} />)}
        <line className="mvmt-axis" x1={cx - rad} x2={cx + rad} y1={cy} y2={cy} />
        <line className="mvmt-axis" x1={cx} x2={cx} y1={cy - rad} y2={cy + rad} />
        {rings.map((r) => <text key={r} className="mvmt-ringlabel" x={cx + 3} y={cy - r * sc - 2}>{r}″</text>)}
        <text className="mvmt-side" x={cx - rad + 4} y={cy + rad + 14}>{armRight ? "◀ Glove side" : "◀ Arm side"}</text>
        <text className="mvmt-side" x={cx + rad - 4} y={cy + rad + 14} textAnchor="end">{armRight ? "Arm side ▶" : "Glove side ▶"}</text>
        <text className="mvmt-side" x={cx} y={cy - rad - 6} textAnchor="middle">Rise ▲</text>
        <text className="mvmt-side" x={cx} y={cy + rad + 14} textAnchor="middle">▼ Drop</text>
        <g clipPath="url(#mvmt-clip)">
          {rows.map((r) => (
            <circle key={r.id} className="pitch-dot" cx={x(r.hb)} cy={y(r.ivb)} r={2.4} fill={pitchColor(r.type)}
              onMouseEnter={() => setHoverRow(r)} onMouseLeave={() => setHoverRow(null)} />
          ))}
        </g>
        {modified && (() => {
          const from = pitches.find((p) => p.type === modified.type);
          if (!from) return null;
          return (
            <g className="modified">
              <line x1={x(from.hb)} y1={y(from.ivb)} x2={x(modified.hb)} y2={y(modified.ivb)} stroke={pitchColor(modified.type)} strokeWidth={1.5} strokeDasharray="3 3" />
              <circle cx={x(modified.hb)} cy={y(modified.ivb)} r={8} fill="none" stroke={pitchColor(modified.type)} strokeWidth={2.5} />
              <text className="mvmt-label" x={x(modified.hb) + 11} y={y(modified.ivb) + 4}>{pitchAbbr(modified.type)}′</text>
            </g>
          );
        })()}
        {pitches.map((p) => {
          const active = p.type === lastType || p.type === nextType;
          return (
            <g key={p.type} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={16} fill="transparent" />
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={active ? 9 : 7} fill={pitchColor(p.type)} stroke="#ffffff" strokeWidth={2.5} />
              <text className="mvmt-label" x={x(p.hb) + 12} y={y(p.ivb) + 4}>{pitchAbbr(p.type)} <tspan className="mvmt-velo">{p.velo.toFixed(0)}</tspan></text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tip" role="status">
          <strong>{hover.type}, average</strong>
          <span>{hover.velo.toFixed(1)} mph{hover.spin != null && `, ${Math.round(hover.spin)} rpm`}</span>
          <span>{hover.ivb.toFixed(1)} in IVB, {hover.hb.toFixed(1)} in HB</span>
          <span>{hover.n.toLocaleString()} pitches</span>
        </div>
      )}
      {hoverRow && !hover && (
        <div className="tip" role="status">
          <strong>{hoverRow.type}, {hoverRow.date}</strong>
          <span>{hoverRow.velo.toFixed(1)} mph{hoverRow.spin != null && `, ${hoverRow.spin} rpm`}</span>
          <span>{hoverRow.ivb.toFixed(1)} in IVB, {hoverRow.hb.toFixed(1)} in HB</span>
          <span>vs {hoverRow.opponent}: {hoverRow.call}</span>
        </div>
      )}
    </figure>
  );
}

// ── Separation over the flight: inches apart vs distance from the plate ──

export function SeparationChart({ curve, names }: { curve: SepSample[]; names?: [string, string] }) {
  const [hover, setHover] = useState<SepSample | null>(null);
  if (curve.length < 2) return null;
  const W = 300, H = 150, padL = 30, padR = 8, padT = 12, padB = 22;
  const maxD = Math.ceil(curve[0].distFromPlate / 5) * 5;
  const span = Math.max(6, Math.ceil(Math.max(...curve.flatMap((c) => [c.sep, Math.abs(c.dv), Math.abs(c.dh)])) / 6) * 6);
  const x = (d: number) => padL + ((maxD - d) / maxD) * (W - padL - padR);
  const y = (s: number) => padT + ((span - s) / (2 * span)) * (H - padT - padB);
  const path = (k: keyof SepSample) => curve.map((c, i) => `${i ? "L" : "M"}${x(c.distFromPlate).toFixed(1)},${y(c[k]).toFixed(1)}`).join("");
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = maxD - ((e.clientX - r.left) / r.width) * maxD;
    setHover(curve.reduce((a, b) => (Math.abs(b.distFromPlate - d) < Math.abs(a.distFromPlate - d) ? b : a)));
  };
  const yTicks = [-span, -span / 2, 0, span / 2, span];
  const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
  const second = names?.[1] ?? "second pitch";
  return (
    <figure className="chart sep-chart"><div className="sec-title">Inches apart over the flight</div>
      <div className="sep-legend">
        <span><i className="l-total" />Total</span>
        <span><i className="l-vert" />Vert (+ = {second} higher)</span>
        <span><i className="l-horz" />Horz (+ = {second} toward 3B)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Separation between the two pitches from release to the plate: total, vertical and horizontal">
        {yTicks.map((t) => (
          <g key={t} className="axis">
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : ""} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {[maxD, 40, 20, 0].filter((d) => d <= maxD).map((d) => (
          <text key={d} className="axis" x={x(d)} y={H - 8} textAnchor="middle">{d === 0 ? "plate" : `${d} ft`}</text>
        ))}
        <line className="decision" x1={x(DECISION_FT)} x2={x(DECISION_FT)} y1={padT} y2={H - padB} />
        <text className="decision-label" x={x(DECISION_FT) + 4} y={padT + 9}>23.8 ft</text>
        <path d={path("dv")} className="sep-vert" />
        <path d={path("dh")} className="sep-horz" />
        <path d={path("sep")} className="sep-line" />
        {hover && (
          <g>
            <line className="crosshair" x1={x(hover.distFromPlate)} x2={x(hover.distFromPlate)} y1={padT} y2={H - padB} />
            <circle cx={x(hover.distFromPlate)} cy={y(hover.sep)} r={4} className="sep-dot" />
            <circle cx={x(hover.distFromPlate)} cy={y(hover.dv)} r={3} className="sep-dot-vert" />
            <circle cx={x(hover.distFromPlate)} cy={y(hover.dh)} r={3} className="sep-dot-horz" />
          </g>
        )}
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover && <div className="tip tip-inline" role="status">{hover.distFromPlate.toFixed(1)} ft out: {hover.sep.toFixed(1)} in apart · vert {sgn(hover.dv)} · horz {sgn(hover.dh)}</div>}
    </figure>
  );
}
