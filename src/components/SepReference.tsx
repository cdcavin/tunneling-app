import { useEffect, useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import { bestPairs } from "../lib/bestPairs";
import { countOutcomes, type Outcomes } from "../lib/outcomes";
import { BANDS, bandOf, bandTotals, comboKey, loadReference, tighterThan, type BinCounts, type Reference } from "../lib/reference";

interface Props {
  rows: PitchRow[];
  anchorType: string | null;
  tunnelType: string | null;
  sep: number | null;          // the current pair's separation at 23.8 ft, inches
}

const MIN_HIS = 20;
const COLS = [
  { key: "chase", label: "Chase", better: "high" as const, his: (o: Outcomes) => o.chasePct, hisN: (o: Outcomes) => o.outOfZone, ref: (s: BinCounts) => r(s.chases, s.outOfZone) },
  { key: "whiff", label: "Whiff", better: "high" as const, his: (o: Outcomes) => o.whiffPct, hisN: (o: Outcomes) => o.swings, ref: (s: BinCounts) => r(s.whiffs, s.swings) },
  { key: "cs", label: "Called K", better: "high" as const, his: (o: Outcomes) => o.calledStrikePct, hisN: (o: Outcomes) => o.takes, ref: (s: BinCounts) => r(s.calledStrikes, s.takes) },
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
  const refBands = useMemo(() => (c ? bandTotals(c) : null), [c]);

  const his = useMemo(() => {
    if (!anchorType || !tunnelType) return null;
    const pairs = bestPairs(rows, { mode: "consecutive", limit: Number.POSITIVE_INFINITY, minPlateIn: ref?.minPlateIn ?? 6,
      sameType: anchorType === tunnelType, anchorType, nextType: tunnelType });
    const buckets: PitchRow[][] = BANDS.map(() => []);
    for (const p of pairs) { const i = bandOf(p.decisionSep); if (i >= 0) buckets[i].push(p.next); }
    return { total: pairs.length, bands: buckets.map((b) => ({ n: b.length, o: countOutcomes(b) })) };
  }, [rows, anchorType, tunnelType, ref?.minPlateIn]);

  if (!anchorType || !tunnelType) return null;
  const cur = sep != null ? bandOf(sep) : -1;
  const tighter = c && sep != null ? Math.round(tighterThan(c, sep)) : null;
  const poolName = pool === "P4" ? "P4" : "Big 12";

  return (
    <section className="sepref" aria-label="Outcomes by separation">
      <div className="sepref-head">
        <div>
          <div className="sec-title">{anchorType} → {tunnelType}: outcomes on the {tunnelType.toLowerCase()} by how close the pair was at 23.8 ft</div>
          {sep != null && (
            <div className="sepref-sub">
              Your pair: <b>{sep.toFixed(1)} in</b>{tighter != null && <> · tighter than {tighter}% of {poolName} pairs</>}
              {his && <> · {his.total} of his real pairs in the selected pitches</>}
            </div>
          )}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Reference pool">
          {(["P4", "BIG12"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pool === p} className={pool === p ? "is-on" : ""} onClick={() => setPool(p)}>{p === "P4" ? "P4" : "Big 12"}</button>
          ))}
        </div>
      </div>
      {!ref ? <p className="hint">Loading the reference…</p> : !c ? <p className="hint">No {poolName} reference for {anchorType} → {tunnelType}.</p> : (
        <div className="sepref-scroll">
          <table className="sepref-table">
            <thead>
              <tr className="grp">
                <th /><th />
                {COLS.map((col) => <th key={col.key} colSpan={2} className="gl">{col.label}</th>)}
              </tr>
              <tr>
                <th scope="col">Apart</th>
                <th scope="col" className="num" title="His back-to-back pairs in this band">His pairs</th>
                {COLS.map((col) => [
                  <th key={col.key + "h"} scope="col" className="num gl">His</th>,
                  <th key={col.key + "p"} scope="col" className="num">{poolName}</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {BANDS.map((band, i) => {
                const h = his?.bands[i];
                const s = refBands![i];
                return (
                  <tr key={band.label} className={i === cur ? "on" : ""}>
                    <th scope="row">{band.label}{i === cur && <span className="you"> your pair</span>}</th>
                    <td className="num">{h?.n ?? 0}</td>
                    {COLS.map((col) => {
                      const hv = h && h.n >= MIN_HIS ? col.his(h.o) : null;
                      const pv = col.ref(s);
                      let tone = "";
                      if (hv != null && pv != null && Math.abs(hv - pv) >= 0.03) tone = (col.better === "high" ? hv > pv : hv < pv) ? " good" : " bad";
                      return [
                        <td key={col.key + "h"} className={`num his gl${tone}${hv == null ? " thin" : ""}`}
                          title={hv == null ? `Fewer than ${MIN_HIS} of his pairs here` : `${pct(hv)} on ${col.hisN(h!.o)} (${poolName} ${pct(pv)})`}>
                          {pct(hv)}
                        </td>,
                        <td key={col.key + "p"} className="num p4" title={`${poolName}: ${s.n?.toLocaleString() ?? 0} pairs`}>{pct(pv)}</td>,
                      ];
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">What happened on the second pitch of real back-to-back pairs that finished at least {ref?.minPlateIn ?? 6} in apart. Green or red: his number is at least 3 points better or worse than {poolName} in the same band. "—" when he has fewer than {MIN_HIS} pairs in a band. Location isn't controlled here; the model separates that out.</p>
    </section>
  );
}
