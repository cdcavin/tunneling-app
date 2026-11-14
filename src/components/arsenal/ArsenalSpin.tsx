import { useMemo } from "react";
import type { PitchRow } from "../../lib/types";
import { pitchColorOnDark } from "../../lib/pitchColors";
import { spinProfile } from "../../lib/spin";
import { avgCoeffs, type ArsenalLine } from "../../lib/arsenalStats";
import { Ball } from "../SpinCard";

/** Spin profile of each pitch (his average): the spinning ball from the tunneling page, tilt as a clock, rpm, spin efficiency, gyro. */
export default function ArsenalSpin({ rows, lines }: { rows: PitchRow[]; lines: ArsenalLine[] }) {
  const cards = useMemo(() => lines.map((l) => {
    const rs = rows.filter((r) => r.type === l.type);
    const c = avgCoeffs(rs);
    return { l, p: c ? spinProfile(c, l.spin) : null };
  }), [rows, lines]);
  return (
    <section className="card ars-spin">
      <div className="sec-title">Spin profile <span className="ars-sub">his average pitch of each type · pitcher's view · tilt as a clock, spin efficiency and gyro worked out from the movement</span></div>
      <div className="ars-spin-row">
        {cards.map(({ l, p }) => {
          const color = pitchColorOnDark(l.type);
          return (
            <div key={l.type} className="spin-ball ars-spin-ball">
              <div className="spin-name"><i style={{ background: color }} />{l.type}</div>
              {p ? <Ball p={p} color={color} rpm={l.spin} /> : <div className="spin-canvas spin-empty">No trajectory</div>}
              <div className="spin-clock">{p?.clock ?? "—"}</div>
              <div className="spin-stats">
                <div><b>{l.spin != null ? Math.round(l.spin).toLocaleString() : "—"}</b><span>rpm</span></div>
                <div><b>{p?.eff != null ? `${Math.round(p.eff * 100)}%` : "—"}</b><span>spin eff</span></div>
                <div><b>{p?.gyroDeg != null ? `${Math.round(p.gyroDeg)}°` : "—"}</b><span>gyro</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
