import { useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import type { RealPair } from "../lib/pairs";
import { bestPairs, type PairMode, type ScoredPair } from "../lib/bestPairs";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  rows: PitchRow[];
  types: string[];
  selected: RealPair | null;
  onSelect: (p: RealPair) => void;
}

/** Rank a pitcher's real pitch pairs by tunnel score (apart at the plate ÷ apart at 23.8 ft). */
export default function BestTunnels({ rows, types, selected, onSelect }: Props) {
  const [mode, setMode] = useState<PairMode>("consecutive");
  const [anchorType, setAnchorType] = useState("");
  const [nextType, setNextType] = useState("");
  const [sameType, setSameType] = useState(false);
  const [limit, setLimit] = useState(20);
  // Live: recomputes whenever the selection, the pair mode or the type filters change.
  const list = useMemo(() => bestPairs(rows, { mode, sameType, anchorType: anchorType || undefined, nextType: nextType || undefined, limit }),
    [rows, mode, sameType, anchorType, nextType, limit]);
  const isSel = (p: ScoredPair) => !!selected && selected.anchor.id === p.anchor.id && selected.next.id === p.next.id;

  return (
    <section className="best">
      <div className="sec-title">Best tunnels</div>
      <div className="segmented" role="radiogroup" aria-label="Which pairs to rank">
        <button type="button" role="radio" aria-checked={mode === "consecutive"} className={mode === "consecutive" ? "is-on" : ""} onClick={() => setMode("consecutive")}>Back-to-back</button>
        <button type="button" role="radio" aria-checked={mode === "any"} className={mode === "any" ? "is-on" : ""} onClick={() => setMode("any")}>Any two pitches</button>
      </div>
      <div className="best-types">
        <select aria-label="First pitch type" value={anchorType} onChange={(e) => setAnchorType(e.target.value)}>
          <option value="">Any first pitch</option>
          {types.map((t) => <option key={t} value={t}>{t} first</option>)}
        </select>
        <select aria-label="Second pitch type" value={nextType} onChange={(e) => setNextType(e.target.value)}>
          <option value="">Any second pitch</option>
          {types.map((t) => <option key={t} value={t}>{t} second</option>)}
        </select>
      </div>
      <label className="hud-check inline"><input type="checkbox" checked={sameType} onChange={(e) => setSameType(e.target.checked)} />Include same-type pairs</label>
      <p className="hint">Score = inches apart at the plate ÷ inches apart at 23.8 ft (23.8 ft gap floored at 1 in). 10× means the pair ended up ten times farther apart than they were at the commit point.{mode === "any" && " Any-two pairs can come from different games; the earlier pitch is the anchor."}</p>
      <div className="best-list">
        {list.length === 0 && <p className="hint">No pairs match in the selected pitches.</p>}
        {list.map((p, i) => (
          <button key={`${p.anchor.id}|${p.next.id}`} type="button" className={`best-row${isSel(p) ? " is-on" : ""}`} onClick={() => onSelect({ anchor: p.anchor, next: p.next })}
            title={`${p.decisionSep.toFixed(1)} in apart at 23.8 ft, ${p.plateSep.toFixed(1)} in at the plate`}>
            <span className="best-rank">{i + 1}</span>
            <span className="best-what">
              <i style={{ background: pitchColorOnDark(p.anchor.type) }} />{p.anchor.type} {p.anchor.velo.toFixed(0)}
              <em>→</em>
              <i style={{ background: pitchColorOnDark(p.next.type) }} />{p.next.type} {p.next.velo.toFixed(0)}
              <small>{p.next.date} · {p.next.half === "Bottom" ? "B" : "T"}{p.next.inning ?? "?"}{p.gap != null && p.gap > 0 ? ` · ${p.gap} between` : ""}{p.gap == null && mode === "any" ? " · different AB" : ""}</small>
            </span>
            <span className="best-nums"><b>{p.ratio.toFixed(1)}×</b><small>{p.decisionSep.toFixed(1)} → {p.plateSep.toFixed(0)} in</small></span>
          </button>
        ))}
        {list.length >= limit && <button type="button" className="ghost" onClick={() => setLimit((n) => n + 20)}>Show more</button>}
      </div>
    </section>
  );
}
