import { useEffect, useMemo, useState } from "react";
import type { PitchRow } from "../lib/types";
import type { RealPair } from "../lib/pairs";
import { outings } from "../lib/filters";
import { ZONE } from "../lib/grid";
import { pitchAbbr, pitchColorOnDark } from "../lib/pitchColors";
import { outcomeOf } from "./PitchPicker";
import { callLabel, missInches, targetBox, useCalls, type Call } from "../lib/calls";

/**
 * At-bat playback: pick an outing and an at-bat, see its pitches in order, and step through them a pair at a time
 * (1→2, 2→3, …). Each step loads the pair exactly like picking A and B in Find pitches. Never rolls into the next at-bat.
 * Each pitch shows its call from the paper charts (lib/calls.ts) and how far it missed the called spot.
 */
const abKey = (r: PitchRow) => `${r.game}|${r.inning}|${r.half}|${r.pa}`;
const half = (r: PitchRow) => (r.half === "Bottom" ? "B" : "T");
const side = (r: PitchRow) => (r.batterSide === "Left" ? "LHH" : r.batterSide === "Right" ? "RHH" : "");
const resultOf = (r: PitchRow) => { const o = outcomeOf(r); return o === "In play: hit" || o === "In play: out" ? (r.result === "Out" ? "In play: out" : r.result ?? o) : o === "Other" ? r.call : o; };
/** How the at-bat ended, from its last pitch. */
function abResult(last: PitchRow) {
  const [b, s] = (last.count ?? "").split("-").map(Number);
  if (last.call === "StrikeSwinging" && s === 2) return "Strikeout swinging";
  if (last.call === "StrikeCalled" && s === 2) return "Strikeout looking";
  if ((last.call === "BallCalled" || last.call === "BallinDirt" || last.call === "BallIntentional") && b === 3) return "Walk";
  if (last.call === "HitByPitch") return "Hit by pitch";
  if (last.call === "InPlay") return last.result && last.result !== "Undefined" ? (last.result === "Out" ? "In play, out" : last.result) : "In play";
  return "At-bat ended";
}

export default function AtBatPlayer({ rows, selected, onSelect, active }: { rows: PitchRow[]; selected: RealPair | null; onSelect: (p: RealPair | null) => void; active: boolean }) {
  const games = useMemo(() => outings(rows), [rows]);
  const [game, setGame] = useState(games[0]?.game ?? "");
  useEffect(() => { if (!games.some((g) => g.game === game)) setGame(games[0]?.game ?? ""); }, [games, game]);
  const atBats = useMemo(() => {
    const m = new Map<string, PitchRow[]>();
    for (const r of rows) { if (r.game !== game || r.pa == null) continue; const k = abKey(r); const l = m.get(k) ?? []; l.push(r); m.set(k, l); }
    return [...m.entries()].map(([k, l]) => [k, l.sort((a, b) => (a.pitchNo ?? 0) - (b.pitchNo ?? 0))] as const)
      .sort((a, b) => (a[1][0].inning ?? 0) - (b[1][0].inning ?? 0) || (a[1][0].pa ?? 0) - (b[1][0].pa ?? 0));
  }, [rows, game]);
  const calls = useCalls();
  const [ab, setAb] = useState("");
  const list = useMemo(() => atBats.find(([k]) => k === ab)?.[1] ?? [], [atBats, ab]);

  // Which pair is showing comes from what's loaded, so it stays right if a pair is picked elsewhere.
  const at = selected ? list.findIndex((r, i) => r.id === selected.anchor.id && list[i + 1]?.id === selected.next.id) : -1;
  const go = (i: number) => { if (i >= 0 && i < list.length - 1) onSelect({ anchor: list[i], next: list[i + 1] }); };
  const pick = (k: string) => {
    setAb(k);
    const l = atBats.find(([kk]) => kk === k)?.[1] ?? [];
    if (l.length >= 2) onSelect({ anchor: l[0], next: l[1] });
  };

  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight" && at >= 0) { e.preventDefault(); go(at + 1); }
      if (e.key === "ArrowLeft" && at > 0) { e.preventDefault(); go(at - 1); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });   // eslint-disable-line react-hooks/exhaustive-deps

  const pairs = Math.max(0, list.length - 1);
  const misses = list.map((r) => missInches(r, calls[r.id])).filter((m): m is number => m != null);
  const callText = (r: PitchRow, c: Call | undefined) => {
    if (!c) return "Call: —";
    const m = missInches(r, c);
    return `Call: ${callLabel(c)}${m == null ? "" : m < 0.05 ? " · hit" : ` · ${m.toFixed(1)} in`}`;
  };
  const callTitle = (c: Call | undefined) => !c ? "No call charted for this pitch" :
    [`Chart page ${c.chart.replace("-", ", pitch ")}`, c.result && `charted result ${c.result}`, !c.typeOk && "chart and Trackman disagree on pitch type",
     c.nameDiffers && "sheet has a different pitcher's name for this outing"].filter(Boolean).join(" · ");
  // mini zone, catcher's view: x = −side (third-base side on the left)
  const X = (s: number) => 60 - s * 34, Y = (h: number) => 158 - h * 34;
  return (
    <div className="ab">
      <div className="ab-pick">
        <select aria-label="Outing" value={game} onChange={(e) => { setGame(e.target.value); setAb(""); }}>
          {games.map((g) => <option key={g.game} value={g.game}>{g.date} vs {g.opponent} ({g.n})</option>)}
        </select>
        <select aria-label="At-bat" value={ab} onChange={(e) => pick(e.target.value)}>
          <option value="">Pick an at-bat…</option>
          {atBats.map(([k, l]) => <option key={k} value={k}>{half(l[0])}{l[0].inning} · PA {l[0].pa}{side(l[0]) ? ` · ${side(l[0])}` : ""} · {l.length} pitch{l.length === 1 ? "" : "es"} · {abResult(l[l.length - 1])}</option>)}
        </select>
        {list.length > 0 && <span className="ab-sum">{list.length} pitch{list.length === 1 ? "" : "es"} · {abResult(list[list.length - 1])}{misses.length ? ` · avg miss ${(misses.reduce((a, b) => a + b, 0) / misses.length).toFixed(1)} in` : ""}</span>}
      </div>

      {list.length > 0 && (
        <div className="ab-body">
          <div className="ab-main">
          <div className="ab-strip" role="list">
            {list.map((r, i) => {
              const isA = at === i, isB = at >= 0 && at + 1 === i;
              return (
                <button key={r.id} type="button" role="listitem" className={`ab-chip${isA ? " is-a" : ""}${isB ? " is-b" : ""}`}
                  onClick={() => go(Math.min(i, list.length - 2))} title={i === list.length - 1 ? "Last pitch: shows as B of the final pair" : "Use as A (the next pitch becomes B)"}>
                  {isA && <span className="ab-tag a">A</span>}{isB && <span className="ab-tag b">B</span>}
                  <span className="ab-top"><b>{i + 1}</b><i style={{ background: pitchColorOnDark(r.type) }} />{pitchAbbr(r.type)} {r.velo.toFixed(0)}</span>
                  <span className="ab-sub">{r.count ?? ""} · {resultOf(r)}</span>
                  <span className={`ab-sub ab-call${calls[r.id] ? " has" : ""}`} title={callTitle(calls[r.id])}>{callText(r, calls[r.id])}</span>
                </button>
              );
            })}
          </div>

          <div className="ab-nav">
            <button type="button" className="ghost" onClick={() => go(at - 1)} disabled={at <= 0} aria-label="Previous pair">◀ Back</button>
            <span className="ab-now">
              {pairs === 0 ? "Only one pitch in this at-bat" : at >= 0
                ? <><b>Pair {at + 1} of {pairs}</b> · {pitchAbbr(list[at].type)} → {pitchAbbr(list[at + 1].type)}</>
                : <>Click a pitch or Next to start</>}
            </span>
            <button type="button" className="ghost" onClick={() => go(at + 1)} disabled={pairs === 0 || at >= pairs - 1} aria-label="Next pair">Next ▶</button>
          </div>
          </div>
          <svg className="ab-zone" viewBox="0 0 120 150" role="img" aria-label="Where each pitch of the at-bat crossed, catcher's view">
              <rect x={X(ZONE.halfWidth)} y={Y(ZONE.top)} width={X(-ZONE.halfWidth) - X(ZONE.halfWidth)} height={Y(ZONE.bottom) - Y(ZONE.top)} className="ab-zone-box" />
              {at >= 0 && ([[list[at], "a"], [list[at + 1], "b"]] as const).map(([r, k]) => {
                const box = r ? targetBox(calls[r.id]?.loc ?? "", r.batterSide) : null;
                if (!box) return null;
                const xa = X(box.x0), xb = X(box.x1);
                return <rect key={k} className={`ab-target ${k}`} x={Math.min(xa, xb)} y={Y(box.y1)} width={Math.abs(xb - xa)} height={Y(box.y0) - Y(box.y1)} />;
              })}
              {list.map((r, i) => {
                const cls = at === i ? "a" : at >= 0 && at + 1 === i ? "b" : "";
                const cx = Math.max(10, Math.min(110, X(r.side))), cy = Math.max(10, Math.min(140, Y(r.height)));
                return <g key={r.id} className={`ab-dot ${cls}`}><circle cx={cx} cy={cy} r={9} /><text x={cx} y={cy}>{i + 1}</text></g>;
              })}
            </svg>
        </div>
      )}
      {!list.length && atBats.length === 0 && <p className="hint">No at-bats in this outing.</p>}
    </div>
  );
}
