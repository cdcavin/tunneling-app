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

/** Where each pitch was called vs where it went (catcher's view). Called boxes for the current pair as corner brackets. */
function CalledZone({ list, at, calls }: { list: PitchRow[]; at: number; calls: Record<string, Call> }) {
  const K = 55, CX = 110, X = (s: number) => CX - s * K, Y = (h: number) => 34 + (4.4 - h) * K;
  const clampX = (x: number) => Math.max(10, Math.min(210, x)), clampY = (y: number) => Math.max(36, Math.min(262, y));
  const pair = at >= 0 ? [{ r: list[at], k: "a" as const, i: at }, { r: list[at + 1], k: "b" as const, i: at + 1 }].filter((p) => p.r) : [];
  const hand = list[0]?.batterSide === "Left" ? "LHH" : list[0]?.batterSide === "Right" ? "RHH" : "";
  const z = { x0: X(ZONE.halfWidth), x1: X(-ZONE.halfWidth), y0: Y(ZONE.top), y1: Y(ZONE.bottom) };
  const cw = (z.x1 - z.x0) / 3, my = (z.y0 + z.y1) / 2;
  const brackets = (x0: number, y0: number, x1: number, y1: number) => {
    const t = Math.min(10, (x1 - x0) / 3, (y1 - y0) / 3);
    return `M${x0} ${y0 + t}V${y0}H${x0 + t}M${x1 - t} ${y0}H${x1}V${y0 + t}M${x0} ${y1 - t}V${y1}H${x0 + t}M${x1 - t} ${y1}H${x1}V${y1 - t}`;
  };
  return (
    <div className="cz">
      <div className="cz-head"><span>Called vs actual</span><span>{hand}</span></div>
      <svg viewBox="0 0 220 270" role="img" aria-label="Called location and where each pitch went, catcher's view">
        <rect x={z.x0} y={z.y0} width={z.x1 - z.x0} height={z.y1 - z.y0} className="cz-zone" />
        <line x1={z.x0} x2={z.x1} y1={my} y2={my} className="cz-grid" />
        <line x1={z.x0 + cw} x2={z.x0 + cw} y1={z.y0} y2={z.y1} className="cz-grid" />
        <line x1={z.x0 + 2 * cw} x2={z.x0 + 2 * cw} y1={z.y0} y2={z.y1} className="cz-grid" />
        {list.map((r, i) => pair.some((p) => p.i === i) ? null : (
          <g key={r.id} className="cz-other"><circle cx={clampX(X(r.side))} cy={clampY(Y(r.height))} r={6} /><text x={clampX(X(r.side))} y={clampY(Y(r.height))}>{i + 1}</text></g>
        ))}
        {pair.map(({ r, k, i }) => {
          const box = targetBox(calls[r.id]?.loc ?? "", r.batterSide);
          const dx = clampX(X(r.side)), dy = clampY(Y(r.height));
          let mark = null, line = null, label = null;
          if (box) {
            const bx0 = Math.min(X(box.x0), X(box.x1)), bx1 = Math.max(X(box.x0), X(box.x1)), by0 = Y(box.y1), by1 = Y(box.y0);
            mark = <g className={`cz-target ${k}`}><rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} /><path d={brackets(bx0, by0, bx1, by1)} /></g>;
            const m = missInches(r, calls[r.id]);
            if (m != null && m >= 0.05) {
              const nx = Math.max(bx0, Math.min(bx1, dx)), ny = Math.max(by0, Math.min(by1, dy));
              line = <line className={`cz-miss ${k}`} x1={nx} y1={ny} x2={dx} y2={dy} />;
              label = <text className={`cz-num ${k}`} x={dx + (dx > 170 ? -12 : 12)} y={dy - 9} textAnchor={dx > 170 ? "end" : "start"}>{m.toFixed(1)}</text>;
            }
          }
          return <g key={k}>{mark}{line}<g className={`cz-dot ${k}`}><circle cx={dx} cy={dy} r={8} /><text x={dx} y={dy}>{i + 1}</text></g>{label}</g>;
        })}
      </svg>
      {pair.length > 0 && (
        <div className="cz-rows">
          {pair.map(({ r, k }) => {
            const c = calls[r.id]; const m = missInches(r, c);
            return (
              <div key={k} className="cz-row"><i className={k} /><b>{pitchAbbr(r.type)}</b><span>{c ? c.loc : "—"}</span>
                <em className={k}>{m == null ? "" : m < 0.05 ? "hit" : `${m.toFixed(1)} in`}</em></div>
            );
          })}
        </div>
      )}
    </div>
  );
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
          <CalledZone list={list} at={at} calls={calls} />
        </div>
      )}
      {!list.length && atBats.length === 0 && <p className="hint">No at-bats in this outing.</p>}
    </div>
  );
}
