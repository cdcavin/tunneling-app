import { HEIGHTS, SIDES, ZONE, sameLoc, type Cell, type Loc } from "../lib/grid";

import { HEAT_RAMP as RAMP, heatInk as INK_ON, heatBin } from "../lib/heatRamp";
const EMPTY = "#1b2740";

// Catcher's view: third-base side (+ side) on the left, high pitches on top.
// A grid can be used with the keyboard (each cell is a button); the 3D plate mirrors it.
const COLS = [...SIDES].reverse();
const ROWS = [...HEIGHTS].reverse();
const STEP = 0.25;
const LEFT = SIDES[SIDES.length - 1] + STEP / 2, TOP = HEIGHTS[HEIGHTS.length - 1] + STEP / 2;
const W = STEP * SIDES.length, H = STEP * HEIGHTS.length;
const xPct = (side: number) => ((LEFT - side) / W) * 100;
const yPct = (h: number) => ((TOP - h) / H) * 100;

interface HeatProps {
  cells: Cell[];
  value: (c: Cell) => number;
  better: "low" | "high";
  unit: string;
}

export interface Marker { loc: Loc; color: string; name: string }

interface Props {
  label: string;
  markers: Marker[];        // anchor and tunnel markers, drawn on the same grid
  active: number;           // index into markers: the one a click moves
  onSelect: (loc: Loc) => void;
  heat?: HeatProps;
  best?: Loc | null;
}

export default function ZonePicker({ label, markers, active, onSelect, heat, best }: Props) {
  const selected = markers[active]?.loc ?? { side: 0, height: 2.5 };
  const lookup = new Map<string, Cell>();
  heat?.cells.forEach((c) => lookup.set(`${c.side.toFixed(2)}|${c.height.toFixed(2)}`, c));
  let lo = Infinity, hi = -Infinity;
  if (heat) for (const c of heat.cells) { const v = heat.value(c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const bin = (v: number) => {
    if (!heat || hi - lo < 1e-9) return 0;
    let f = (v - lo) / (hi - lo);
    if (heat.better === "low") f = 1 - f;
    return heatBin(f);
  };

  return (
    <div className="zone-picker">
      <div className="zone-grid" role="grid" aria-label={label} style={{ gridTemplateColumns: `repeat(${COLS.length}, 1fr)` }}>
        {ROWS.map((h) => COLS.map((s) => {
          const loc = { side: s, height: h };
          const cell = lookup.get(`${s.toFixed(2)}|${h.toFixed(2)}`);
          const v = cell && heat ? heat.value(cell) : null;
          const i = v != null ? bin(v) : -1;
          const isSel = sameLoc(loc, selected);
          const here = markers.filter((m) => sameLoc(m.loc, loc));
          const isBest = !!best && sameLoc(loc, best);
          const desc = `${s > 0 ? `${(s * 12).toFixed(0)} in toward third` : s < 0 ? `${(-s * 12).toFixed(0)} in toward first` : "middle"}, ${(h * 12).toFixed(0)} in high`;
          return (
            <button
              key={`${s}|${h}`}
              type="button"
              className={`zone-cell${isSel ? " is-selected" : ""}${isBest ? " is-best" : ""}${here.length ? " has-marker" : ""}`}
              style={{
                backgroundColor: i >= 0 ? RAMP[i] : EMPTY,
                color: i >= 0 ? INK_ON(i) : undefined,
                ["--m1" as string]: here[0]?.color ?? "transparent",
                ["--m2" as string]: here[1]?.color ?? here[0]?.color ?? "transparent",
              }}
              aria-pressed={isSel}
              aria-label={`${desc}${v != null ? `, ${v.toFixed(1)} ${heat!.unit}` : ""}${here.map((m) => `, ${m.name} here`).join("")}${isBest ? ", best spot" : ""}`}
              title={v != null ? `${v.toFixed(1)} ${heat!.unit}` : undefined}
              onClick={() => onSelect(loc)}
            />
          );
        }))}
        <div
          className="zone-outline"
          aria-hidden="true"
          style={{
            left: `${xPct(ZONE.halfWidth)}%`, width: `${xPct(-ZONE.halfWidth) - xPct(ZONE.halfWidth)}%`,
            top: `${yPct(ZONE.top)}%`, height: `${yPct(ZONE.bottom) - yPct(ZONE.top)}%`,
          }}
        />
      </div>
      <div className="zone-axis" aria-hidden="true"><span>3B</span><span>catcher's view</span><span>1B</span></div>
      {heat && (
        <div className="heat-legend">
          <span>{heat.better === "low" ? `${hi.toFixed(0)} in` : `${lo.toFixed(0)} in`}</span>
          <span className="heat-ramp" aria-hidden="true">{RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>
          <span>{heat.better === "low" ? `${lo.toFixed(0)} in` : `${hi.toFixed(0)} in`}</span>
          
        </div>
      )}
    </div>
  );
}
