import { useRef, useState } from "react";
import { ZONE } from "../../lib/grid";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { inOutline, type Outline } from "../../lib/arsenalStats";
import type { PitchRow } from "../../lib/types";

/** Frame shared with the heatmaps: 4 ft wide, 0.4–4.6 ft tall, same scale both ways. */
export const FRAME = { side: 2.0, lo: 0.4, hi: 4.6 };
const W = 220, PX = W / (2 * FRAME.side), H = (FRAME.hi - FRAME.lo) * PX;
const px = (side: number) => (side + FRAME.side) * PX;         // pitcher's view: third-base side on the right
const py = (h: number) => (FRAME.hi - h) * PX;
const toSide = (x: number) => x / PX - FRAME.side;
const toHeight = (y: number) => FRAME.hi - y / PX;
const MIN_STEP = 0.04;   // ft between recorded points, so a slow drag doesn't pile up thousands of them
const pathOf = (pts: Outline, close: boolean) => (pts.length ? `M${pts.map(([s, h]) => `${px(s).toFixed(1)},${py(h).toFixed(1)}`).join("L")}${close ? "Z" : ""}` : "");

/** Strike zone to outline a location by hand: press and draw around the pitches you want; letting go closes the shape. */
export default function ZoneDraw({ rows, outline, onChange, insideCount }: { rows: PitchRow[]; outline: Outline | null; onChange: (o: Outline | null) => void; insideCount: Record<string, number> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Outline | null>(null);
  const shown = draft ?? outline;

  const at = (e: React.PointerEvent): [number, number] => {
    const s = svg.current!, m = s.getScreenCTM();
    const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = m ? p.matrixTransform(m.inverse()) : p;
    return [toSide(q.x), toHeight(q.y)];
  };
  const down = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); setDraft([at(e)]); };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = at(e), last = draft[draft.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MIN_STEP) setDraft([...draft, p]);
  };
  const up = () => {
    if (draft && draft.length >= 3) onChange(draft);   // a click or a tiny scribble doesn't make a shape
    setDraft(null);
  };

  const zx = Math.min(px(ZONE.halfWidth), px(-ZONE.halfWidth)), zw = Math.abs(px(ZONE.halfWidth) - px(-ZONE.halfWidth)), zy = py(ZONE.top), zh = py(ZONE.bottom) - zy;
  const total = Object.values(insideCount).reduce((a, b) => a + b, 0);
  return (
    <div className="zd">
      <svg ref={svg} className="zd-svg" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="Strike zone, pitcher's view. Press and draw around a location."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <rect className="ars-zone-bg" width={W} height={H} rx={4} />
        {rows.map((r) => {
          const inside = !outline || draft || inOutline(r, outline);
          return <circle key={r.id} cx={px(r.side)} cy={py(r.height)} r={2.3} fill={inside ? pitchColor(r.type) : "#4f6283"} opacity={inside ? 0.85 : 0.35} />;
        })}
        <rect className="ars-zone-box" x={zx} y={zy} width={zw} height={zh} pointerEvents="none" />
        <path className="ars-plate" d={`M${zx},${H + 2} L${zx + zw},${H + 2} L${zx + zw},${H + 6} L${zx + zw / 2},${H + 11} L${zx},${H + 6} Z`} />
        {shown && <path className="zd-circle" d={pathOf(shown, !draft)} />}
      </svg>
      <div className="zd-foot">
        {outline ? (
          <>
            <span className="zd-sum"><b>{total}</b> inside{Object.entries(insideCount).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={t}> · <i style={{ background: pitchColor(t) }} />{pitchAbbr(t)} {n}</span>)}</span>
            <button type="button" className="ghost zd-clear" onClick={() => onChange(null)}>Clear</button>
          </>
        ) : <span className="hint">Press and draw around the pitches you want. Letting go closes the outline; draw again to replace it.</span>}
      </div>
    </div>
  );
}
