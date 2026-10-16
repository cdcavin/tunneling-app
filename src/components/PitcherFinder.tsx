import { useEffect, useMemo, useState } from "react";
import type { PitcherSummary } from "../lib/types";

const WVU = "WES_MOU";
/** "OKL_COW" -> "OKL COW"; a real name map can replace this later. */
export const teamLabel = (code: string) => code.replace(/_/g, " ");
/** WVU gets its fall seasons spelled out; everyone else is spring only, so just the year. */
export const seasonLabel = (p: { season: string; team?: string }) => (p.team === WVU ? p.season : p.season.replace(/^Fall /, "Fall "));

interface Props {
  pitchers: PitcherSummary[];
  value: string;
  onChange: (id: string) => void;
}

/** Year → conference → team → pitcher, with a text search across all of it and a WVU-only switch. */
export default function PitcherFinder({ pitchers, value, onChange }: Props) {
  const [wvuOnly, setWvuOnly] = useState(true);
  const [year, setYear] = useState<string>("");
  const [conf, setConf] = useState("");
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");

  const years = useMemo(() => [...new Set(pitchers.map((p) => p.year ?? Number(p.season.replace(/\D/g, ""))))].filter(Boolean).sort((a, b) => b - a), [pitchers]);
  const pool = useMemo(() => pitchers.filter((p) => (!wvuOnly || p.team === WVU) && (!year || String(p.year ?? "") === year)), [pitchers, wvuOnly, year]);
  const confs = useMemo(() => [...new Set(pool.map((p) => p.conf ?? ""))].filter(Boolean).sort(), [pool]);
  const inConf = useMemo(() => (conf ? pool.filter((p) => p.conf === conf) : pool), [pool, conf]);
  const teams = useMemo(() => [...new Set(inConf.map((p) => p.team ?? ""))].filter(Boolean).sort(), [inConf]);
  const inTeam = useMemo(() => (team ? inConf.filter((p) => p.team === team) : inConf), [inConf, team]);
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => {
    const l = needle
      ? inTeam.filter((p) => `${p.name} ${p.team ?? ""} ${teamLabel(p.team ?? "")} ${p.conf ?? ""} ${p.season}`.toLowerCase().includes(needle))
      : inTeam;
    return [...l].sort((a, b) => a.name.localeCompare(b.name) || (b.year ?? 0) - (a.year ?? 0)).slice(0, 400);
  }, [inTeam, needle]);

  // Keep the dropdowns coherent when a higher-level choice removes the current one.
  useEffect(() => { if (conf && !confs.includes(conf)) setConf(""); }, [confs, conf]);
  useEffect(() => { if (team && !teams.includes(team)) setTeam(""); }, [teams, team]);

  const current = pitchers.find((p) => p.id === value);
  return (
    <div className="finder">
      <div className="finder-row">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pitcher or team" aria-label="Search pitchers" />
        <button type="button" className={`wvu-switch${wvuOnly ? " is-on" : ""}`} onClick={() => setWvuOnly((v) => !v)} aria-pressed={wvuOnly} title="Show only WVU pitchers">WVU</button>
      </div>
      <div className="finder-grid">
        <select aria-label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
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
      <select aria-label="Pitcher" value={list.some((p) => p.id === value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)} size={Math.min(8, Math.max(3, list.length))} className="finder-list">
        {list.length === 0 && <option value="" disabled>No pitchers match</option>}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.throws === "Right" ? "R" : "L"} · {p.team === WVU ? "WVU" : teamLabel(p.team ?? "")} · {seasonLabel(p)} · {p.n}
          </option>
        ))}
      </select>
      {current && <p className="hint">{current.name}: {current.n.toLocaleString()} pitches{current.games ? ` in ${current.games} games` : ""}, {seasonLabel(current)}{current.first ? `, ${current.first} to ${current.last}` : ""}.</p>}
      {list.length >= 400 && <p className="hint">Showing the first 400. Narrow it down.</p>}
    </div>
  );
}
