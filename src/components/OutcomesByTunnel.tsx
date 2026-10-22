import { useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import { bestPairs } from "../lib/bestPairs";
import { countOutcomes, type Outcomes } from "../lib/outcomes";

interface Props {
  rows: PitchRow[];
  anchorType: string | null;
  tunnelType: string | null;
}

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const avg3 = (v: number | null) => (v == null ? "—" : v.toFixed(3).replace(/^0/, ""));
const mph = (v: number | null) => (v == null ? "—" : v.toFixed(1));

const COLS: { key: keyof Outcomes; label: string; fmt: (v: number | null) => string; denom: keyof Outcomes; better: "high" | "low"; title: string }[] = [
  { key: "whiffPct", label: "Whiff", fmt: pct, denom: "swings", better: "high", title: "Whiffs ÷ swings" },
  { key: "chasePct", label: "Chase", fmt: pct, denom: "outOfZone", better: "high", title: "Swings at pitches outside the zone ÷ pitches outside the zone" },
  { key: "contactPct", label: "Contact", fmt: pct, denom: "swings", better: "low", title: "Foul or in play ÷ swings" },
  { key: "calledStrikePct", label: "Called K", fmt: pct, denom: "takes", better: "high", title: "Called strikes ÷ takes" },
  { key: "ev", label: "EV", fmt: mph, denom: "evN", better: "low", title: "Average exit velo on balls in play, mph" },
  { key: "hardHitPct", label: "Hard hit", fmt: pct, denom: "evN", better: "low", title: "Balls in play at 95+ mph ÷ balls in play with exit velo" },
  { key: "avg", label: "AVG", fmt: avg3, denom: "ab", better: "low", title: "Hits ÷ at-bats, on PAs that ended on this pitch" },
  { key: "obp", label: "OBP", fmt: avg3, denom: "pa", better: "low", title: "(Hits + BB + HBP) ÷ PAs that ended on this pitch" },
  { key: "slg", label: "SLG", fmt: avg3, denom: "ab", better: "low", title: "Total bases ÷ at-bats, on PAs that ended on this pitch" },
  { key: "kPct", label: "K", fmt: pct, denom: "pa", better: "high", title: "Strikeouts ÷ PAs that ended on this pitch" },
];

/** Real results on the second pitch of his back-to-back pairs, split by how tight they were at 23.8 ft. */
export default function OutcomesByTunnel({ rows, anchorType, tunnelType }: Props) {
  const [scope, setScope] = useState<"combo" | "all">("combo");
  const data = useMemo(() => {
    const same = !!anchorType && anchorType === tunnelType;
    const pairs = bestPairs(rows, {
      mode: "consecutive", limit: Number.POSITIVE_INFINITY, minPlateIn: 6,
      sameType: scope === "all" || same,
      anchorType: scope === "combo" ? anchorType ?? undefined : undefined,
      nextType: scope === "combo" ? tunnelType ?? undefined : undefined,
    }).sort((a, b) => a.decisionSep - b.decisionSep);
    const n = pairs.length;
    const cut = (i: number) => pairs.slice(Math.floor((n * i) / 3), Math.floor((n * (i + 1)) / 3));
    const bands = [
      { label: "Tightest third", pairs: cut(0) },
      { label: "Middle third", pairs: cut(1) },
      { label: "Widest third", pairs: cut(2) },
    ].map((b) => ({
      ...b,
      lo: b.pairs[0]?.decisionSep ?? null, hi: b.pairs[b.pairs.length - 1]?.decisionSep ?? null,
      o: countOutcomes(b.pairs.map((p) => p.next)),
    }));
    return { n, bands, all: countOutcomes(pairs.map((p) => p.next)) };
  }, [rows, anchorType, tunnelType, scope]);

  // Shade a cell when the tight-third value beats the wide-third value, so the direction reads at a glance.
  const [tight, , wide] = data.bands;
  const edge = (c: (typeof COLS)[number]) => {
    const a = tight.o[c.key] as number | null, b = wide.o[c.key] as number | null;
    if (a == null || b == null || a === b) return "";
    return (c.better === "high" ? a > b : a < b) ? " better" : " worse";
  };

  return (
    <section className="card outcomes">
      <div className="outcomes-head">
        <div className="sec-title">What happened when he tunneled well vs. poorly</div>
        <div className="segmented" role="radiogroup" aria-label="Which pairs">
          <button type="button" role="radio" aria-checked={scope === "combo"} className={scope === "combo" ? "is-on" : ""} onClick={() => setScope("combo")}>
            {anchorType && tunnelType ? `${anchorType} → ${tunnelType}` : "This combo"}
          </button>
          <button type="button" role="radio" aria-checked={scope === "all"} className={scope === "all" ? "is-on" : ""} onClick={() => setScope("all")}>All his pairs</button>
        </div>
      </div>
      {data.n < 9 ? (
        <p className="hint">Only {data.n} back-to-back pairs in the selected pitches. Widen the filters (more seasons or outings) or pick All his pairs.</p>
      ) : (
        <div className="outcomes-scroll">
          <table className="outcomes-table">
            <thead>
              <tr>
                <th scope="col">Apart at 23.8 ft</th>
                <th scope="col" className="num">Pairs</th>
                {COLS.map((c) => <th key={c.key} scope="col" className="num" title={c.title}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.bands.map((b, i) => (
                <tr key={b.label}>
                  <th scope="row">
                    <span className="band-label">{b.label}</span>
                    <small>{b.lo?.toFixed(1)}–{b.hi?.toFixed(1)} in</small>
                  </th>
                  <td className="num">{b.pairs.length}</td>
                  {COLS.map((c) => {
                    const d = b.o[c.denom] as number;
                    return (
                      <td key={c.key} className={`num${i === 0 ? edge(c) : ""}${d < 10 ? " thin" : ""}`} title={`${c.title} (n = ${d})`}>
                        {c.fmt(b.o[c.key] as number | null)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="all-row">
                <th scope="row"><span className="band-label">All</span></th>
                <td className="num">{data.n}</td>
                {COLS.map((c) => <td key={c.key} className="num">{c.fmt(data.all[c.key] as number | null)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">Outcomes are on the second pitch of each back-to-back pair that finished at least 6 in apart. Faded numbers rest on fewer than 10 events. Green/red on the tightest row: better/worse than the widest. P4 reference bands replace the thirds once they're built.</p>
    </section>
  );
}
