import { useEffect, useMemo, useRef, useState } from "react";
import type { PitcherSummary } from "../lib/types";

const WVU = "WES_MOU";
/** "OKL_COW" -> "OKL COW"; a real name map can replace this later. */
export const teamLabel = (code: string) => code.replace(/_/g, " ");
/** WVU gets its fall seasons spelled out; everyone else is spring only, so just the year. */
export const seasonLabel = (p: { season: string; team?: string }) => p.season;
/** Seasons he has, newest first; works for both the per-pitcher and the older per-season index. */
const seasonsOf = (p: PitcherSummary) => p.seasons ?? [p.season];
const yearsOf = (p: PitcherSummary) => p.years ?? [p.year ?? Number(p.season.replace(/\D/g, ""))];
/** "2026, Fall 2025" style summary, newest first. */
/** Season order: year, then fall after spring ("Fall 2026" > "2026"). */
const seasonRank = (s: string) => Number(s.replace(/\D/g, "")) + (/fall/i.test(s) ? 0.5 : 0);
const seasonSpan = (p: PitcherSummary) => { const s = seasonsOf(p); return s.length > 3 ? `${s[0]} … ${s[s.length - 1]}` : s.join(", "); };

interface Props {
  pitchers: PitcherSummary[];
  value: string;
  onChange: (id: string) => void;
  /** The year chosen in the finder ("" = all years), so the loaded pitcher's seasons can follow it. */
  onYear?: (year: string) => void;
}

/** Year → conference → team → pitcher, with a text search across all of it and a WVU-only switch. */
export default function PitcherFinder({ pitchers, value, onChange, onYear }: Props) {
  const [wvuOnly, setWvuOnly] = useState(true);
  const [pastWvu, setPastWvu] = useState(false);   // WVU normally means the current roster: pitchers with pitches in the newest WVU season
  const rosterSeason = useMemo(() => pitchers.filter((p) => p.team === WVU).flatMap(seasonsOf).sort((a, b) => seasonRank(b) - seasonRank(a))[0] ?? "", [pitchers]);
  const onRoster = (p: PitcherSummary) => !rosterSeason || seasonsOf(p).includes(rosterSeason);
  const [year, setYear] = useState<string>("");
  const [conf, setConf] = useState("");
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");

  const years = useMemo(() => [...new Set(pitchers.flatMap(yearsOf))].filter(Boolean).sort((a, b) => b - a), [pitchers]);
  const pool = useMemo(() => pitchers.filter((p) => (!wvuOnly || (p.team === WVU && (pastWvu || onRoster(p)))) && (!year || yearsOf(p).includes(Number(year)))), [pitchers, wvuOnly, pastWvu, year, rosterSeason]);   // eslint-disable-line react-hooks/exhaustive-deps
  const confs = useMemo(() => [...new Set(pool.map((p) => p.conf ?? ""))].filter(Boolean).sort(), [pool]);
  const inConf = useMemo(() => (conf ? pool.filter((p) => p.conf === conf) : pool), [pool, conf]);
  const teams = useMemo(() => [...new Set(inConf.map((p) => p.team ?? ""))].filter(Boolean).sort(), [inConf]);
  const inTeam = useMemo(() => (team ? inConf.filter((p) => p.team === team) : inConf), [inConf, team]);
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const l = needle
      ? inTeam.filter((p) => `${p.name} ${p.team ?? ""} ${teamLabel(p.team ?? "")} ${p.conf ?? ""} ${seasonsOf(p).join(" ")}`.toLowerCase().includes(needle))
      : inTeam;
    return [...l].sort((a, b) => a.name.localeCompare(b.name) || (b.year ?? 0) - (a.year ?? 0)).slice(0, 400);
  }, [inTeam, needle]);

  // Keep the dropdowns coherent when a higher-level choice removes the current one.
  useEffect(() => { if (conf && !confs.includes(conf)) setConf(""); }, [confs, conf]);
  useEffect(() => { if (team && !teams.includes(team)) setTeam(""); }, [teams, team]);

  const current = pitchers.find((p) => p.id === value);
  const [open, setOpen] = useState(false);          // the list shows only while searching
  const [showFilters, setShowFilters] = useState(false);
  const [hi, setHi] = useState(0);                   // highlighted row for the arrow keys
  const boxRef = useRef<HTMLDivElement>(null), listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => { setHi(0); }, [needle, wvuOnly, year, conf, team]);
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView({ block: "nearest" }); }, [hi]);
  const choose = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  const filtered = !!(year || conf || team);
  const meta = (p: PitcherSummary) => `${p.throws === "Right" ? "RHP" : "LHP"} · ${p.team === WVU ? "WVU" : teamLabel(p.team ?? "")} · ${seasonSpan(p)}`;

  return (
    <div className="finder" ref={boxRef}>
      <div className="finder-bar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="search" value={q} placeholder={current ? "Switch pitcher" : "Search pitcher or team"} aria-label="Search pitchers"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(list.length - 1, h + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === "Enter" && list[hi]) { e.preventDefault(); choose(list[hi].id); }
            else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
          }} />
        <button type="button" className={`wvu-switch${wvuOnly ? " is-on" : ""}`} onClick={() => setWvuOnly((v) => !v)} aria-pressed={wvuOnly} title={`Only WVU pitchers on the current roster (${rosterSeason})`}>WVU</button>
        <button type="button" className={`icon-btn${showFilters || filtered ? " is-on" : ""}`} onClick={() => setShowFilters((v) => !v)} aria-pressed={showFilters} title="Year, conference and team">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
        </button>
      </div>
      {showFilters && (
        <div className="finder-grid">
          {wvuOnly && (
            <label className="finder-check span2"><input type="checkbox" checked={pastWvu} onChange={(e) => setPastWvu(e.target.checked)} />Include past WVU pitchers (not on the {rosterSeason} roster)</label>
          )}
          <select aria-label="Year" value={year} onChange={(e) => { setYear(e.target.value); onYear?.(e.target.value); }}>
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <select aria-label="Conference" value={conf} onChange={(e) => setConf(e.target.value)} disabled={wvuOnly}>
            <option value="">All conferences</option>
            {confs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} disabled={wvuOnly} className="span2">
            <option value="">All teams{conf ? ` in ${conf}` : ""}</option>
            {teams.map((t) => <option key={t} value={t}>{teamLabel(t)}</option>)}
          </select>
        </div>
      )}
      {open ? (
        <div ref={listRef} className="finder-list" role="listbox" aria-label="Pitcher">
          {list.length === 0 && <div className="finder-empty">No pitchers match</div>}
          {list.map((p, i) => (
            <div key={p.id} role="option" aria-selected={p.id === value} className={`finder-item${p.id === value ? " is-on" : ""}${i === hi ? " is-hi" : ""}`}
              onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(p.id); }}>
              <span className="fi-name">{p.name}</span>
              <span className="fi-meta">{meta(p)}</span>
            </div>
          ))}
          {list.length >= 400 && <div className="finder-empty">Showing the first 400. Narrow it down.</div>}
        </div>
      ) : current ? (
        <button type="button" className="finder-current" onClick={() => setOpen(true)} title="Switch pitcher">
          <span className="fc-name">{current.name}</span>
          <span className="fc-meta">{meta(current)}</span>
          <span className="fc-meta">{current.n.toLocaleString()} pitches{current.games ? ` · ${current.games} games` : ""}</span>
        </button>
      ) : null}
    </div>
  );
}
