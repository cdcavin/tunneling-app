import { useEffect, useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import { bestPairs } from "../lib/bestPairs";
import { countOutcomes, type Outcomes } from "../lib/outcomes";
import { comboKey, gradeCuts, gradeOf, loadReference, type BinCounts, type Reference } from "../lib/reference";

interface Props {
  rows: PitchRow[];
  anchorType: string | null;
  tunnelType: string | null;
  sep: number | null;          // the current pair's separation at 23.8 ft, inches
}

const MIN_EVENTS = 15;   // his number shows only when the stat itself rests on at least this many events
const COLS = [
  { key: "chase", label: "Chase", better: "high" as const, his: (o: Outcomes) => o.chasePct, hisN: (o: Outcomes) => o.outOfZone, ref: (s: BinCounts) => r(s.chases, s.outOfZone) },
  { key: "swing", label: "Swing", better: null, his: (o: Outcomes) => (o.pitches ? o.swings / o.pitches : null), hisN: (o: Outcomes) => o.pitches, ref: (s: BinCounts) => r(s.swings, s.n) },
  { key: "whiff", label: "Whiff", better: "high" as const, his: (o: Outcomes) => o.whiffPct, hisN: (o: Outcomes) => o.swings, ref: (s: BinCounts) => r(s.whiffs, s.swings) },
  { key: "cs", label: "Called strike", better: "high" as const, his: (o: Outcomes) => o.calledStrikePct, hisN: (o: Outcomes) => o.takes, ref: (s: BinCounts) => r(s.calledStrikes, s.takes) },
  { key: "hard", label: "Hard hit", better: "low" as const, his: (o: Outcomes) => o.hardHitPct, hisN: (o: Outcomes) => o.evN, ref: (s: BinCounts) => r(s.hard, s.evN) },
];
function r(a: number | undefined, b: number | undefined) { return b ? (a ?? 0) / b : null; }
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** Real outcomes by separation band: P4 (or Big 12) next to his own pairs, current band highlighted. */
export default function SepReference({ rows, anchorType, tunnelType, sep }: Props) {
  const [ref, setRef] = useState<Reference | null>(null);
  const [pool, setPool] = useState<"P4" | "BIG12">("P4");
  useEffect(() => { loadReference().then(setRef); }, []);

  const combo = anchorType && tunnelType ? comboKey(anchorType, tunnelType) : null;
  const c = combo && ref ? ref.pools[pool]?.[combo] ?? null : null;

  const his = useMemo(() => {
    if (!anchorType || !tunnelType) return null;
    const comp = ref?.competitive;
    const pairs = bestPairs(rows, { mode: "consecutive", limit: Number.POSITIVE_INFINITY, minPlateIn: ref?.minPlateIn ?? 6,
      sameType: anchorType === tunnelType, anchorType, nextType: tunnelType })
      // same pairs as the reference: second pitch within 6 in of the zone
      .filter((p) => !comp || (Math.abs(p.next.side) <= comp.side && p.next.height >= comp.low && p.next.height <= comp.high));
    return pairs;
  }, [rows, anchorType, tunnelType, ref?.minPlateIn, ref?.competitive]);

  if (!anchorType || !tunnelType) return null;
  const grade = c && sep != null ? gradeOf(c, sep) : null;
  const cuts = c ? gradeCuts(c) : null;
  const poolName = pool === "P4" ? "P4" : "Big 12";
  // His pairs split at the same cutoffs: tunneled = Elite + Good, not tunneled = Below + Bad.
  const hisT = his && cuts ? countOutcomes(his.filter((p) => p.decisionSep <= cuts[1]).map((p) => p.next)) : null;
  const hisN = his && cuts ? countOutcomes(his.filter((p) => p.decisionSep >= cuts[2]).map((p) => p.next)) : null;
  const g = c?.groups;
  const here = grade ? (grade.cls === "elite" || grade.cls === "good" ? "t" : grade.cls === "below" || grade.cls === "poor" ? "n" : null) : null;

  return (
    <section className="sepref" aria-label="Outcomes by separation">
      <div className="sepref-head">
        <div>
          <div className="sec-title">{anchorType} → {tunnelType} · tunneled vs not</div>
          {sep != null && (
            <div className="sepref-sub">
              Your pair: <b>{sep.toFixed(1)} in</b>{grade && <> · <span className={`grade ${grade.cls}`}>{grade.label}</span> · tighter than {grade.tighter}% of {poolName} pairs</>}

            </div>
          )}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Reference pool">
          {(["P4", "BIG12"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pool === p} className={pool === p ? "is-on" : ""} onClick={() => setPool(p)}>{p === "P4" ? "P4" : "Big 12"}</button>
          ))}
        </div>
      </div>
      {cuts && (
        <div className="gradescale" role="img" aria-label={`${poolName} ${anchorType} to ${tunnelType} grades at 23.8 ft: Elite up to ${cuts[0].toFixed(1)} in, Good up to ${cuts[1].toFixed(1)}, Average up to ${cuts[2].toFixed(1)}, Below average up to ${cuts[3].toFixed(1)}, Bad beyond`}>
          {[
            { cls: "elite", label: "Elite", range: `≤ ${cuts[0].toFixed(1)} in` },
            { cls: "good", label: "Good", range: `${cuts[0].toFixed(1)}–${cuts[1].toFixed(1)}` },
            { cls: "avg", label: "Average", range: `${cuts[1].toFixed(1)}–${cuts[2].toFixed(1)}` },
            { cls: "below", label: "Below avg", range: `${cuts[2].toFixed(1)}–${cuts[3].toFixed(1)}` },
            { cls: "poor", label: "Bad", range: `> ${cuts[3].toFixed(1)} in` },
          ].map((g) => (
            <div key={g.cls} className={`gs-seg ${g.cls}${grade?.cls === g.cls ? " is-here" : ""}`}>
              <span className="gs-label">{g.label}</span>
              <span className="gs-range">{g.range}</span>
              {grade?.cls === g.cls && <span className="gs-you">your pair · {sep!.toFixed(1)} in</span>}
            </div>
          ))}
        </div>
      )}
      {!ref ? <p className="hint">Loading the reference…</p> : !c || !g || !cuts ? <p className="hint">No {poolName} reference for {anchorType} → {tunnelType}.</p> : (
        <div className="tvn">
          <div className="tvn-row tvn-head">
            <span />
            <span className={here === "t" ? "is-here" : ""}>Tunneled <small>≤ {cuts[1].toFixed(1)} in</small></span>
            <span className={here === "n" ? "is-here" : ""}>Not tunneled <small>≥ {cuts[2].toFixed(1)} in</small></span>
            <span className="tvn-diff">Diff</span>
          </div>
          {COLS.map((col) => {
            const a = col.ref(g.tunneled), b = col.ref(g.notTunneled);
            const d = a != null && b != null ? Math.round((a - b) * 100) : null;
            const tone = d == null || col.better == null || Math.abs(d) < 3 ? "" : (col.better === "high" ? d > 0 : d < 0) ? " good" : " bad";
            const his = (o: Outcomes | null) => {
              if (!o) return null;
              const n = col.hisN(o), v = col.his(o);
              return <small className="tvn-his" title={`His: ${n} to go on`}>his {n >= MIN_EVENTS && v != null ? pct(v) : "–"}</small>;
            };
            return (
              <div key={col.key} className="tvn-row">
                <span className="tvn-label">{col.label}</span>
                <span className={`tvn-v${here === "t" ? " is-here" : ""}`}>{pct(a)}{his(hisT)}</span>
                <span className={`tvn-v${here === "n" ? " is-here" : ""}`}>{pct(b)}{his(hisN)}</span>
                <span className={`tvn-diff${tone}`}>{d == null ? "—" : `${d > 0 ? "+" : ""}${d}`}</span>
              </div>
            );
          })}
          <p className="hint">{poolName}: {g.tunneled.n.toLocaleString()} vs {g.notTunneled.n.toLocaleString()} real pairs. Outcome on the second pitch. His: {his?.length ?? 0} pairs; "–" under {MIN_EVENTS}.</p>
        </div>
      )}
      <details className="howto"><summary>How to read this</summary><p className="hint">Tunneled = Elite or Good for this combo (tighter at 23.8 ft than 60% of {poolName} pairs). Not tunneled = Below avg or Bad. Back-to-back pairs that finished at least {ref?.minPlateIn ?? 6} in apart, second pitch within 6 in of the zone. Chase = swings at pitches out of the zone. Count and hitter aren't controlled; the model will.</p></details>
    </section>
  );
}
