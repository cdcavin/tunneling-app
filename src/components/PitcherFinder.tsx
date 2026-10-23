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
  const [year, setYear] = useState<string>("");
  const [conf, setConf] = useState("");
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");

  const years = useMemo(() => [...new Set(pitchers.flatMap(yearsOf))].filter(Boolean).sort((a, b) => b - a), [pitchers]);
  const pool = useMemo(() => pitchers.filter((p) => (!wvuOnly || p.team === WVU) && (!year || yearsOf(p).includes(Number(year)))), [pitchers, wvuOnly, year]);
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
  const listRef = useRef<HTMLDivElement>(null);
  // Keep the loaded pitcher in view when the list changes.
  useEffect(() => { listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [value, list]);
  const step = (d: number) => {
    const i = list.findIndex((p) => p.id === value);
    const next = list[Math.min(list.length - 1, Math.max(0, (i < 0 ? -1 : i) + d))];
    if (next) onChange(next.id);
  };
  return (
    <div className="finder">
      <div className="finder-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pitcher or team" aria-label="Search pitchers" />
        <button type="button" className={`wvu-switch${wvuOnly ? " is-on" : ""}`} onClick={() => setWvuOnly((v) => !v)} aria-pressed={wvuOnly} title="Show only WVU pitchers">WVU</button>
      </div>
      <div className="finder-grid">
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
      <div ref={listRef} className="finder-list" role="listbox" aria-label="Pitcher" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); step(1); } else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); } }}>
        {list.length === 0 && <div className="finder-empty">No pitchers match</div>}
        {list.map((p) => (
          <div key={p.id} role="option" aria-selected={p.id === value} className={`finder-item${p.id === value ? " is-on" : ""}`} onClick={() => onChange(p.id)}>
            <span className="fi-name">{p.name}</span>
            <span className="fi-meta">{p.throws === "Right" ? "RHP" : "LHP"} · {p.team === WVU ? "WVU" : teamLabel(p.team ?? "")} · {seasonSpan(p)}</span>
          </div>
        ))}
      </div>
      {current && <p className="hint">{current.n.toLocaleString()} pitches{current.games ? ` in ${current.games} games` : ""} across {seasonsOf(current).join(", ")}. Pick the season under Pitches in use.</p>}
      {list.length >= 400 && <p className="hint">Showing the first 400. Narrow it down.</p>}
    </div>
  );
}
