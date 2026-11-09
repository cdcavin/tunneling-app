import { useEffect, useMemo, useState } from "react";
import type { Pitcher, PitcherSummary, PitchRow } from "../lib/types";
import { bestPairs, type ScoredPair } from "../lib/bestPairs";
import { pitchColorOnDark } from "../lib/pitchColors";
import { WVU_CODES } from "../lib/pairs";
import { readJson } from "../lib/json";

/**
 * WVU tunnel leaderboard for one pair of pitch types.
 * Built from each pitcher's real back-to-back pairs (same at-bat, one pitch right after the other). Score = inches apart
 * at the plate ÷ inches apart at 23.8 ft (same as Best tunnels), median over his pairs. 5+ pairs to qualify.
 */
interface Props { pitchers: PitcherSummary[]; onPick: (id: string) => void; onClose: () => void }

const MIN = 5;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mdy = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(2, 4)}`;
const rank = (s: string) => Number(s.slice(-4)) * 2 + (s.startsWith("Fall") ? 1 : 0);

let cache: Promise<Pitcher[]> | null = null;
function loadWvu(list: PitcherSummary[]) {
  if (!cache) cache = Promise.all(list.map((p) =>
    fetch(`${import.meta.env.BASE_URL}data/pitcher/${encodeURIComponent(p.id)}.json`).then((r) => (r.ok ? readJson<Pitcher>(r) : null)).catch(() => null),
  )).then((xs) => xs.filter((x): x is Pitcher => !!x));
  return cache;
}

type Order = "either" | "ab";
type SortBy = "score" | "dec" | "n";

export default function Leaderboard({ pitchers, onPick, onClose }: Props) {
  const wvu = useMemo(() => pitchers.filter((p) => p.team && WVU_CODES.has(p.team)), [pitchers]);
  const [all, setAll] = useState<Pitcher[] | null>(null);
  useEffect(() => { let alive = true; loadWvu(wvu).then((x) => { if (alive) setAll(x); }); return () => { alive = false; }; }, [wvu]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  // Every pitcher's back-to-back pairs, computed once.
  const pairsBy = useMemo(() => (all ?? []).map((p) => ({ p, pairs: bestPairs(p.pitches, { mode: "consecutive", sameType: true, limit: Number.MAX_SAFE_INTEGER }) })), [all]);
  const allRows = useMemo(() => (all ?? []).flatMap((p) => p.pitches), [all]);
  const types = useMemo(() => {
    const n = new Map<string, number>(); allRows.forEach((r) => n.set(r.type, (n.get(r.type) ?? 0) + 1));
    return [...n].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [allRows]);
  const seasons = useMemo(() => [...new Set(allRows.map((r) => r.season))].sort((a, b) => rank(b) - rank(a)), [allRows]);
  const outings = useMemo(() => {
    const g = new Map<string, { date: string; opp: string; season: string }>();
    allRows.forEach((r) => { if (!g.has(r.game)) g.set(r.game, { date: r.date, opp: r.opponent, season: r.season }); });
    return [...g].sort((a, b) => b[1].date.localeCompare(a[1].date));
  }, [allRows]);
  const dates = useMemo(() => allRows.map((r) => r.date).sort(), [allRows]);

  const [tA, setTA] = useState(""); const [tB, setTB] = useState("");
  const A = tA || types[0] || "", B = tB || types.find((t) => t !== A) || "";
  const [order, setOrder] = useState<Order>("either");
  const [season, setSeason] = useState<string[]>([]);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [game, setGame] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("score");

  const keep = (r: PitchRow) => (!season.length || season.includes(r.season)) && (!from || r.date >= from) && (!to || r.date <= to) && (!game || r.game === game);
  const match = (q: ScoredPair) => (q.anchor.type === A && q.next.type === B) || (order === "either" && q.anchor.type === B && q.next.type === A);

  const board = useMemo(() => pairsBy.map(({ p, pairs }) => {
    const ps = pairs.filter((q) => match(q) && keep(q.anchor) && keep(q.next));
    return { p, n: ps.length, score: median(ps.map((q) => q.ratio)), dec: median(ps.map((q) => q.decisionSep)), plate: median(ps.map((q) => q.plateSep)),
      best: ps.length ? Math.max(...ps.map((q) => q.ratio)) : NaN };
  }).filter((r) => r.n > 0), [pairsBy, A, B, order, season, from, to, game]);   // eslint-disable-line react-hooks/exhaustive-deps
  const qualified = board.filter((r) => r.n >= MIN).sort((x, y) => sortBy === "score" ? y.score - x.score : sortBy === "dec" ? x.dec - y.dec : y.n - x.n);
  const short = board.filter((r) => r.n < MIN).sort((x, y) => y.n - x.n);
  const team = qualified.length ? median(qualified.map((r) => r.score)) : NaN;

  const chip = (on: boolean) => `type-chip${on ? " is-on" : ""}`;
  const pairName = `${A}${order === "either" ? " ↔ " : " → "}${B}`;

  return (
    <div className="lb-back" role="dialog" aria-modal="true" aria-label="Tunnel leaderboard" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="lb">
        <div className="lb-head">
          <div>
            <div className="lb-title">Tunnel leaderboard</div>
            <div className="hint" style={{ margin: 0 }}>WVU pitchers · back-to-back pairs · {MIN}+ pairs to qualify</div>
          </div>
          <button type="button" className="ghost lb-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!all ? <p className="hint">Loading WVU pitchers…</p> : (
          <>
            <div className="lb-controls">
              <div className="lb-pair">
                <select aria-label="First pitch" value={A} onChange={(e) => setTA(e.target.value)}>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <button type="button" className="ghost lb-order" onClick={() => setOrder(order === "either" ? "ab" : "either")} title={order === "either" ? "Either order counts. Click for this order only." : "This order only. Click to count either order."}>
                  {order === "either" ? "↔" : "→"}
                </button>
                <select aria-label="Second pitch" value={B} onChange={(e) => setTB(e.target.value)}>{types.filter((t) => t !== A).map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <span className="hint" style={{ margin: 0 }}>{order === "either" ? "either order" : `${A} first, then ${B}`}</span>
              </div>
              <div className="lb-filters">
                <div className="lb-chips" role="group" aria-label="Seasons">
                  {seasons.map((s) => <button key={s} type="button" className={chip(season.includes(s))} onClick={() => { setGame(""); setSeason(season.includes(s) ? season.filter((x) => x !== s) : [...season, s]); }}>{s}</button>)}
                  {season.length > 0 && <button type="button" className="type-chip clear" onClick={() => setSeason([])}>All seasons</button>}
                </div>
                <div className="lb-row">
                  <label>From<input type="date" value={from} min={dates[0]} max={to || dates[dates.length - 1]} onChange={(e) => setFrom(e.target.value)} /></label>
                  <label>To<input type="date" value={to} min={from || dates[0]} max={dates[dates.length - 1]} onChange={(e) => setTo(e.target.value)} /></label>
                  <label>Outing
                    <select value={game} onChange={(e) => setGame(e.target.value)}>
                      <option value="">All outings</option>
                      {outings.filter(([, o]) => (!season.length || season.includes(o.season)) && (!from || o.date >= from) && (!to || o.date <= to))
                        .map(([g, o]) => <option key={g} value={g}>{mdy(o.date)} vs {o.opp}</option>)}
                    </select>
                  </label>
                  {(from || to || game) && <button type="button" className="type-chip clear" onClick={() => { setFrom(""); setTo(""); setGame(""); }}>Clear</button>}
                </div>
              </div>
            </div>

            <div className="lb-sum">
              <span className="tc-pair"><i style={{ background: pitchColorOnDark(A) }} />{pairName.split(/ [↔→] /)[0]}<em>{order === "either" ? "↔" : "→"}</em><i style={{ background: pitchColorOnDark(B) }} />{B}</span>
              <span>{qualified.length} qualified{Number.isFinite(team) ? ` · team median ${team.toFixed(1)}×` : ""}</span>
              <span className="segmented" role="radiogroup" aria-label="Sort by" style={{ margin: 0 }}>
                {([["score", "Score"], ["dec", "Tightest at 23.8 ft"], ["n", "Most pairs"]] as [SortBy, string][]).map(([k, l]) =>
                  <button key={k} type="button" className={sortBy === k ? "is-on" : ""} onClick={() => setSortBy(k)}>{l}</button>)}
              </span>
            </div>

            {qualified.length === 0 ? <p className="hint">Nobody has {MIN}+ back-to-back {pairName} pairs with these filters.</p> : (
              <div className="wxi-scroll">
                <table className="wxi-table lb-table">
                  <thead><tr><th>#</th><th>Pitcher</th><th>Pairs</th><th title="Median of plate gap ÷ 23.8 ft gap">Score</th><th className="lb-barh" /><th title="Median inches apart at 23.8 ft">23.8 ft</th><th title="Median inches apart at the plate">Plate</th><th title="His single best pair">Best</th></tr></thead>
                  <tbody>
                    {qualified.map((r, i) => {
                      const max = Math.max(...qualified.map((x) => x.score));
                      return (
                        <tr key={r.p.id} className="lb-r" onClick={() => { onPick(r.p.id); onClose(); }} title="Open this pitcher">
                          <td className="num dim">{i + 1}</td>
                          <td><b>{r.p.name}</b> <small className="inl">{r.p.throws === "Left" ? "LHP" : "RHP"}</small></td>
                          <td className="num">{r.n}</td>
                          <td className="num"><b>{r.score.toFixed(1)}×</b></td>
                          <td className="lb-barc"><span className="lb-bar" style={{ width: `${(r.score / max) * 100}%`, background: Number.isFinite(team) && r.score >= team ? "var(--good)" : "var(--ink-2)" }} /></td>
                          <td className="num">{r.dec.toFixed(1)}</td>
                          <td className="num">{r.plate.toFixed(0)}</td>
                          <td className="num dim">{r.best.toFixed(1)}×</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {short.length > 0 && <p className="hint">Not enough pairs yet: {short.map((r) => `${r.p.name} (${r.n})`).join(", ")}.</p>}
            <p className="hint">Score = inches apart at the plate ÷ inches apart at 23.8 ft (the hitter's decision point), median of his back-to-back pairs; higher = looks the same longer, then splits more. Green bar = at or above the team median. Click a pitcher to open him.</p>
          </>
        )}
      </div>
    </div>
  );
}
