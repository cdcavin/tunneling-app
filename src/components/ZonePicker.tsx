import { HEIGHTS, SIDES, ZONE, sameLoc, type Cell, type Loc } from "../lib/grid";

// Sequential blue ramp, light (worse) to dark (better), from the validated palette.
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95", "#104281"];
const INK_ON = (i: number) => (i >= 4 ? "#ffffff" : "#13294b");

// Catcher's view: third-base side (+ side) on the left, high pitches on top.
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

interface Props {
  label: string;
  selected: Loc;
  onSelect: (loc: Loc) => void;
  heat?: HeatProps;
  best?: Loc | null;
  color: string;
}

export default function ZonePicker({ label, selected, onSelect, heat, best, color }: Props) {
  const lookup = new Map<string, Cell>();
  heat?.cells.forEach((c) => lookup.set(`${c.side.toFixed(2)}|${c.height.toFixed(2)}`, c));
  let lo = Infinity, hi = -Infinity;
  if (heat) for (const c of heat.cells) { const v = heat.value(c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const bin = (v: number) => {
    if (!heat || hi - lo < 1e-9) return 0;
    let f = (v - lo) / (hi - lo);
    if (heat.better === "low") f = 1 - f;
    return Math.min(RAMP.length - 1, Math.floor(f * RAMP.length));
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
          const isBest = !!best && sameLoc(loc, best);
          const desc = `${s > 0 ? `${(s * 12).toFixed(0)} in toward third` : s < 0 ? `${(-s * 12).toFixed(0)} in toward first` : "middle"}, ${(h * 12).toFixed(0)} in high`;
          return (
            <button
              key={`${s}|${h}`}
              type="button"
              className={`zone-cell${isSel ? " is-selected" : ""}${isBest ? " is-best" : ""}`}
              style={{
                backgroundColor: i >= 0 ? RAMP[i] : undefined,
                color: i >= 0 ? INK_ON(i) : undefined,
                ["--sel" as string]: color,
              }}
              aria-pressed={isSel}
              aria-label={`${desc}${v != null ? `, ${v.toFixed(1)} ${heat!.unit}` : ""}${isBest ? ", best spot" : ""}`}
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
      <div className="zone-axis" aria-hidden="true"><span>3B side</span><span>Catcher's view</span><span>1B side</span></div>
      {heat && (
        <div className="heat-legend">
          <span>{heat.better === "low" ? `${hi.toFixed(0)} in` : `${lo.toFixed(0)} in`}</span>
          <span className="heat-ramp" aria-hidden="true">{RAMP.map((c) => <i key={c} style={{ background: c }} />)}</span>
          <span>{heat.better === "low" ? `${lo.toFixed(0)} in` : `${hi.toFixed(0)} in`}</span>
          <span className="heat-note">darker is better</span>
        </div>
      )}
    </div>
  );
}
