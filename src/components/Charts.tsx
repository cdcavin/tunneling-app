import { useState } from "react";
import type { ArsenalPitch } from "../lib/types";
import { pitchAbbr, pitchColor } from "../lib/pitchColors";
import { DECISION_FT } from "../lib/physics";

// ── Movement plot: induced vertical break vs horizontal break, one dot per pitch type ──

interface MovementProps {
  pitches: ArsenalPitch[];
  lastType: string | null;
  nextType: string | null;
  modified?: { type: string; ivb: number; hb: number; velo: number } | null;
}

export function MovementPlot({ pitches, lastType, nextType, modified }: MovementProps) {
  const [hover, setHover] = useState<ArsenalPitch | null>(null);
  const S = 250, pad = 28, R = 25; // R = axis range in inches either way
  const x = (hb: number) => pad + ((hb + R) / (2 * R)) * (S - 2 * pad);
  const y = (ivb: number) => S - pad - ((ivb + R) / (2 * R)) * (S - 2 * pad);
  const ticks = [-20, -10, 0, 10, 20];
  return (
    <figure className="chart"><div className="sec-title">Pitch shapes</div>
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Movement plot of this pitcher's arsenal">
        {ticks.map((t) => (
          <g key={t} className="axis">
            <line x1={x(t)} x2={x(t)} y1={pad} y2={S - pad} className={t === 0 ? "zero" : ""} />
            <line y1={y(t)} y2={y(t)} x1={pad} x2={S - pad} className={t === 0 ? "zero" : ""} />
            <text x={x(t)} y={S - pad + 13} textAnchor="middle">{t}</text>
            <text x={pad - 6} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        <text className="axis-title" x={S / 2} y={S - 3} textAnchor="middle">Horizontal break, in (+ toward 3B)</text>
        <text className="axis-title" x={9} y={S / 2} textAnchor="middle" transform={`rotate(-90 9 ${S / 2})`}>Induced vertical break, in</text>
        {modified && (() => {
          const from = pitches.find((p) => p.type === modified.type);
          if (!from) return null;
          return (
            <g className="modified">
              <line x1={x(from.hb)} y1={y(from.ivb)} x2={x(modified.hb)} y2={y(modified.ivb)} stroke={pitchColor(modified.type)} strokeWidth={1.5} strokeDasharray="3 3" />
              <circle cx={x(modified.hb)} cy={y(modified.ivb)} r={7} fill="none" stroke={pitchColor(modified.type)} strokeWidth={2.5} />
              <text className="dot-label" x={x(modified.hb) + 10} y={y(modified.ivb) + 4}>{pitchAbbr(modified.type)}′</text>
            </g>
          );
        })()}
        {pitches.map((p) => {
          const active = p.type === lastType || p.type === nextType;
          return (
            <g key={p.type} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={14} fill="transparent" />
              <circle cx={x(p.hb)} cy={y(p.ivb)} r={active ? 7 : 5} fill={pitchColor(p.type)} stroke="#0f1a2e" strokeWidth={2} />
              <text className="dot-label" x={x(p.hb) + 10} y={y(p.ivb) + 4}>{pitchAbbr(p.type)}</text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tip" role="status">
          <strong>{hover.type}</strong>
          <span>{hover.velo.toFixed(1)} mph</span>
          <span>{hover.ivb.toFixed(1)} in IVB, {hover.hb.toFixed(1)} in HB</span>
          <span>{hover.n.toLocaleString()} pitches</span>
        </div>
      )}
    </figure>
  );
}

// ── Separation over the flight: inches apart vs distance from the plate ──

export function SeparationChart({ curve }: { curve: { distFromPlate: number; sep: number }[] }) {
  const [hover, setHover] = useState<{ distFromPlate: number; sep: number } | null>(null);
  if (curve.length < 2) return null;
  const W = 300, H = 130, padL = 26, padR = 8, padT = 12, padB = 22;
  const maxD = Math.ceil(curve[0].distFromPlate / 5) * 5;
  const maxS = Math.max(6, Math.ceil(Math.max(...curve.map((c) => c.sep)) / 6) * 6);
  const x = (d: number) => padL + ((maxD - d) / maxD) * (W - padL - padR);
  const y = (s: number) => H - padB - (s / maxS) * (H - padT - padB);
  const path = curve.map((c, i) => `${i ? "L" : "M"}${x(c.distFromPlate).toFixed(1)},${y(c.sep).toFixed(1)}`).join("");
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const d = maxD - ((e.clientX - r.left) / r.width) * maxD;
    setHover(curve.reduce((a, b) => (Math.abs(b.distFromPlate - d) < Math.abs(a.distFromPlate - d) ? b : a)));
  };
  const yTicks = [0, maxS / 2, maxS];
  return (
    <figure className="chart sep-chart"><div className="sec-title">Inches apart over the flight</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Separation between the two pitches from release to the plate">
        {yTicks.map((t) => (
          <g key={t} className="axis">
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "zero" : ""} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {[maxD, 20, 0].filter((d) => d <= maxD).map((d) => (
          <text key={d} className="axis" x={x(d)} y={H - 8} textAnchor="middle">{d === 0 ? "plate" : `${d} ft`}</text>
        ))}
        <line className="decision" x1={x(DECISION_FT)} x2={x(DECISION_FT)} y1={padT} y2={H - padB} />
        <text className="decision-label" x={x(DECISION_FT) + 4} y={padT + 9}>23.8 ft</text>
        <path d={path} className="sep-line" />
        {hover && (
          <g>
            <line className="crosshair" x1={x(hover.distFromPlate)} x2={x(hover.distFromPlate)} y1={padT} y2={H - padB} />
            <circle cx={x(hover.distFromPlate)} cy={y(hover.sep)} r={4} className="sep-dot" />
          </g>
        )}
        <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover && <div className="tip tip-inline" role="status">{hover.sep.toFixed(1)} in apart, {hover.distFromPlate.toFixed(1)} ft from the plate</div>}
    </figure>
  );
}
