import { useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import type { RealPair } from "../lib/pairs";
import { pitchColorOnDark } from "../lib/pitchColors";
import { outings } from "../lib/filters";

interface Props {
  rows: PitchRow[];                 // the selected pitches (after filters)
  pairs: RealPair[];                // quick list of real back-to-back pairs of the chosen types
  selected: RealPair | null;
  onSelect: (p: RealPair | null) => void;
}

const abKey = (r: PitchRow) => `${r.game}|${r.inning}|${r.half}|${r.pa}`;
const abLabel = (r: PitchRow) => `${r.half === "Bottom" ? "B" : "T"}${r.inning} · PA ${r.pa}${r.batter ? ` · ${r.batter}` : ""}`;
const short = (r: PitchRow) => `${r.date} ${r.half === "Bottom" ? "B" : "T"}${r.inning ?? "?"} #${r.pitchNo ?? "?"} ${r.type} ${r.velo.toFixed(0)}`;

/** Pick any two pitches to overlay: by outing, inning, at-bat (batter when known), or a text search. */
export default function PitchPicker({ rows, pairs, selected, onSelect }: Props) {
  const [game, setGame] = useState("");
  const [inning, setInning] = useState("");
  const [ab, setAb] = useState("");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"A" | "B">("A");
  const [open, setOpen] = useState(true);

  const games = useMemo(() => outings(rows), [rows]);
  const inGame = useMemo(() => (game ? rows.filter((r) => r.game === game) : rows), [rows, game]);
  const innings = useMemo(() => [...new Set(inGame.map((r) => r.inning).filter((x): x is number => x != null))].sort((a, b) => a - b), [inGame]);
  const inInning = useMemo(() => (inning ? inGame.filter((r) => String(r.inning) === inning) : inGame), [inGame, inning]);
  const abs = useMemo(() => {
    const m = new Map<string, PitchRow>();
    for (const r of inInning) if (r.pa != null && !m.has(abKey(r))) m.set(abKey(r), r);
    return [...m.entries()].sort((a, b) => (a[1].inning ?? 0) - (b[1].inning ?? 0) || (a[1].pa ?? 0) - (b[1].pa ?? 0));
  }, [inInning]);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    let l = ab ? inInning.filter((r) => abKey(r) === ab) : inInning;
    if (q) l = l.filter((r) => `${r.date} ${r.opponent} ${r.inning} ${r.half} ${r.pa} ${r.pitchNo} ${r.type} ${r.velo.toFixed(0)} ${r.call} ${r.batter ?? ""} ${r.count ?? ""}`.toLowerCase().includes(q));
    return [...l].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.inning ?? 0) - (b.inning ?? 0) || (a.pa ?? 0) - (b.pa ?? 0) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0)).slice(0, 80);
  }, [inInning, ab, q]);

  const A = selected?.anchor ?? null, B = selected?.next ?? null;
  const isPlaceholder = !!selected && selected.anchor.id === selected.next.id;

  return (
    <div className="picker">
      <div className="picker-slots">
        {([["A", A], ["B", B]] as const).map(([k, r]) => (
          <button key={k} type="button" className={`slot${slot === k ? " is-next" : ""}`} onClick={() => setSlot(k)} title={`Next pick fills ${k}`}>
            <b>{k}</b>
            {r && !(k === "B" && isPlaceholder) ? <><i style={{ background: pitchColorOnDark(r.type) }} />{short(r)}</> : <span className="muted">pick a pitch</span>}
          </button>
        ))}
        {selected && <button type="button" className="ghost" onClick={() => onSelect(null)}>Clear</button>}
        <button type="button" className="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide list" : "Browse"}</button>
      </div>
      {open && (
        <>
          <div className="picker-filters">
            <select aria-label="Outing" value={game} onChange={(e) => { setGame(e.target.value); setInning(""); setAb(""); }}>
              <option value="">All outings</option>
              {games.map((g) => <option key={g.game} value={g.game}>{g.date} vs {g.opponent} ({g.n})</option>)}
            </select>
            <select aria-label="Inning" value={inning} onChange={(e) => { setInning(e.target.value); setAb(""); }}>
              <option value="">Any inning</option>
              {innings.map((i) => <option key={i} value={String(i)}>Inning {i}</option>)}
            </select>
            <select aria-label="At-bat" value={ab} onChange={(e) => setAb(e.target.value)}>
              <option value="">Any at-bat</option>
              {abs.map(([k, r]) => <option key={k} value={k}>{abLabel(r)}</option>)}
            </select>
            <input type="search" placeholder="Search: batter, pitch, call, count…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pitches" />
          </div>
          <div className="picker-list" role="list">
            {list.map((r) => (
              <div key={r.id} role="listitem" className={`pick-row${A?.id === r.id ? " is-a" : ""}${B?.id === r.id && !isPlaceholder ? " is-b" : ""}`}>
                <span className="pick-when">{r.date} · {r.half === "Bottom" ? "B" : "T"}{r.inning ?? "?"} · PA {r.pa ?? "?"} · #{r.pitchNo ?? "?"}</span>
                <span className="pick-what"><i style={{ background: pitchColorOnDark(r.type) }} />{r.type} {r.velo.toFixed(0)}{r.count ? ` · ${r.count}` : ""} · {r.call}{r.batter ? ` · ${r.batter}` : ""}</span>
                <span className="pick-btns">
                  <button type="button" onClick={() => { setSlot("A"); onSelect(B && !isPlaceholder ? { anchor: r, next: B } : { anchor: r, next: r }); setSlot("B"); }} aria-label={`Use as A: ${short(r)}`}>A</button>
                  <button type="button" onClick={() => { onSelect(A ? { anchor: A, next: r } : { anchor: r, next: r }); }} aria-label={`Use as B: ${short(r)}`}>B</button>
                </span>
              </div>
            ))}
            {list.length === 0 && <p className="hint">No pitches match.</p>}
            {list.length === 80 && <p className="hint">Showing the first 80. Narrow it down.</p>}
          </div>
          {pairs.length > 0 && (
            <select aria-label="Quick: real back-to-back pairs" value="" onChange={(e) => { const p = pairs.find((x) => `${x.anchor.id}|${x.next.id}` === e.target.value); if (p) onSelect(p); }}>
              <option value="">Quick pick: back-to-back {pairs[0].anchor.type} → {pairs[0].next.type} ({pairs.length})</option>
              {pairs.map((p) => (
                <option key={`${p.anchor.id}|${p.next.id}`} value={`${p.anchor.id}|${p.next.id}`}>
                  {p.next.date} vs {p.next.opponent}, inn {p.next.inning}: {p.anchor.velo.toFixed(0)} {p.anchor.type} → {p.next.velo.toFixed(0)} {p.next.type} ({p.next.call})
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
