import { useRef, useState } from "react";
import { ZONE } from "../../lib/grid";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import type { Circle } from "../../lib/arsenalStats";
import type { PitchRow } from "../../lib/types";

/** Frame shared with the heatmaps: 4 ft wide, 0.4–4.6 ft tall, same scale both ways so a circle stays round. */
export const FRAME = { side: 2.0, lo: 0.4, hi: 4.6 };
const W = 220, PX = W / (2 * FRAME.side), H = (FRAME.hi - FRAME.lo) * PX;
const px = (side: number) => (FRAME.side - side) * PX;         // catcher's view: third-base side on the left
const py = (h: number) => (FRAME.hi - h) * PX;
const toSide = (x: number) => FRAME.side - x / PX;
const toHeight = (y: number) => FRAME.hi - y / PX;
const CLICK_R = 0.45;   // a click without a drag drops a circle this big (ft)

/** Strike zone to draw one circle on: press and drag to size it, drag the middle to move it. */
export default function ZoneDraw({ rows, circle, onChange, insideCount }: { rows: PitchRow[]; circle: Circle | null; onChange: (c: Circle | null) => void; insideCount: Record<string, number> }) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Circle | null>(null);
  const drag = useRef<{ mode: "draw" | "move"; dx: number; dy: number } | null>(null);
  const shown = draft ?? circle;

  const at = (e: React.PointerEvent) => {
    const s = svg.current!, m = s.getScreenCTM();
    const p = s.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = m ? p.matrixTransform(m.inverse()) : p;
    return { side: toSide(q.x), height: toHeight(q.y) };
  };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (circle && Math.hypot(p.side - circle.side, p.height - circle.height) < circle.r) {
      drag.current = { mode: "move", dx: p.side - circle.side, dy: p.height - circle.height };
      setDraft(circle);
    } else {
      drag.current = { mode: "draw", dx: 0, dy: 0 };
      setDraft({ side: p.side, height: p.height, r: 0 });
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !draft) return;
    const p = at(e);
    setDraft(d.mode === "draw"
      ? { ...draft, r: Math.hypot(p.side - draft.side, p.height - draft.height) }
      : { ...draft, side: p.side - d.dx, height: p.height - d.dy });
  };
  const up = () => {
    if (draft) onChange(drag.current?.mode === "draw" && draft.r < 0.12 ? { ...draft, r: CLICK_R } : draft);
    drag.current = null; setDraft(null);
  };

  const zx = px(ZONE.halfWidth), zw = px(-ZONE.halfWidth) - zx, zy = py(ZONE.top), zh = py(ZONE.bottom) - zy;
  const total = Object.values(insideCount).reduce((a, b) => a + b, 0);
  return (
    <div className="zd">
      <svg ref={svg} className="zd-svg" viewBox={`0 0 ${W} ${H + 14}`} role="img" aria-label="Strike zone, catcher's view. Press and drag to circle a location."
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <rect className="ars-zone-bg" width={W} height={H} rx={4} />
        {rows.map((r) => {
          const inside = !shown || (r.side - shown.side) ** 2 + (r.height - shown.height) ** 2 <= shown.r ** 2;
          return <circle key={r.id} cx={px(r.side)} cy={py(r.height)} r={2.3} fill={inside ? pitchColor(r.type) : "#4f6283"} opacity={inside ? 0.85 : 0.35} />;
        })}
        <rect className="ars-zone-box" x={zx} y={zy} width={zw} height={zh} pointerEvents="none" />
        {[1, 2].map((k) => <line key={`v${k}`} className="ars-zone-third" x1={zx + (zw * k) / 3} x2={zx + (zw * k) / 3} y1={zy} y2={zy + zh} />)}
        {[1, 2].map((k) => <line key={`h${k}`} className="ars-zone-third" x1={zx} x2={zx + zw} y1={zy + (zh * k) / 3} y2={zy + (zh * k) / 3} />)}
        <path className="ars-plate" d={`M${zx},${H + 2} L${zx + zw},${H + 2} L${zx + zw},${H + 6} L${zx + zw / 2},${H + 11} L${zx},${H + 6} Z`} />
        {shown && <circle className="zd-circle" cx={px(shown.side)} cy={py(shown.height)} r={shown.r * PX} />}
      </svg>
      <div className="zd-foot">
        {circle ? (
          <>
            <span className="zd-sum"><b>{total}</b> inside{Object.entries(insideCount).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([t, n]) => <span key={t}> · <i style={{ background: pitchColor(t) }} />{pitchAbbr(t)} {n}</span>)}</span>
            <button type="button" className="ghost zd-clear" onClick={() => onChange(null)}>Clear</button>
          </>
        ) : <span className="hint">Press and drag to circle a spot. Drag the middle to move it.</span>}
      </div>
    </div>
  );
}
