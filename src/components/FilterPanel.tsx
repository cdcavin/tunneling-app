import { useState } from "react";
import { outings, NO_FILTERS, type Filters } from "../lib/filters";
import { seasonsOf, type PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  all: PitchRow[];         // every pitch the pitcher has
  selected: number;        // how many pass the current filters
  filters: Filters;
  onChange: (f: Filters) => void;
}

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/**
 * Which of his pitches everything is built from, as one slim bar ("Fall 2026 · all outings · 116 pitches") with a
 * funnel that opens season, outing, opponent and pitch-type choices, like the pitcher search.
 */
export default function FilterPanel({ all, selected, filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const seasons = seasonsOf(all);
  // Outings listed are those within the chosen seasons, so the list stays short.
  const inSeason = filters.seasons.length ? all.filter((p) => filters.seasons.includes(p.season)) : all;
  const games = outings(inSeason);
  const opponents = [...new Set(inSeason.map((p) => p.opponent))].sort();
  const types = [...new Set(all.map((p) => p.type))].sort((a, b) => all.filter((p) => p.type === b).length - all.filter((p) => p.type === a).length);
  const narrowed = filters.games.length > 0 || filters.opponents.length > 0 || filters.hiddenTypes.length > 0;

  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const seasonText = filters.seasons.length ? filters.seasons.join(", ") : "All seasons";
  const gameText = filters.games.length === 1
    ? (() => { const g = games.find((x) => x.game === filters.games[0]); return g ? `${md(g.date)} ${g.opponent}` : "1 outing"; })()
    : filters.games.length ? `${filters.games.length} outings` : filters.opponents.length === 1 ? `vs ${filters.opponents[0]}` : filters.opponents.length ? `${filters.opponents.length} opponents` : "all outings";

  return (
    <div className="dfilter">
      <div className="dfilter-bar">
        <span className="dfilter-sum" title="The pitches every average, chart and the 3D view are built from">
          {seasonText} · {gameText}{filters.hiddenTypes.length ? ` · ${filters.hiddenTypes.length} type${filters.hiddenTypes.length > 1 ? "s" : ""} off` : ""} · <b>{selected.toLocaleString()}</b> pitches
        </span>
        {(narrowed || filters.seasons.length > 0) && selected !== all.length && (
          <button type="button" className="icon-btn" onClick={() => onChange(NO_FILTERS)} title="Use all his pitches" aria-label="Clear filters">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
        <button type="button" className={`icon-btn${open || narrowed ? " is-on" : ""}`} onClick={() => setOpen((v) => !v)} aria-pressed={open} aria-expanded={open} title="Season, outing, opponent and pitch types">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
        </button>
      </div>

      {open && (
        <div className="dfilter-pop">
          {seasons.length > 1 && (
            <div className="dfilter-row" role="group" aria-label="Season">
              {seasons.map((sn) => (
                <button key={sn} type="button" className={`type-chip${filters.seasons.includes(sn) ? " is-on" : ""}`}
                  onClick={() => onChange({ ...filters, seasons: toggle(filters.seasons, sn), games: [] })}>{sn}</button>
              ))}
            </div>
          )}
          <div className="finder-grid">
            <select aria-label="Outing" value={filters.games.length === 1 ? filters.games[0] : ""}
              onChange={(e) => onChange({ ...filters, games: e.target.value ? [e.target.value] : [] })}>
              <option value="">All outings</option>
              {games.map((g) => <option key={g.game} value={g.game}>{md(g.date)} {g.opponent} ({g.n})</option>)}
            </select>
            <select aria-label="Opponent" value={filters.opponents.length === 1 ? filters.opponents[0] : ""}
              onChange={(e) => onChange({ ...filters, opponents: e.target.value ? [e.target.value] : [] })}>
              <option value="">All opponents</option>
              {opponents.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="dfilter-row" role="group" aria-label="Pitch types (click to leave one out)">
            {types.map((t) => {
              const off = filters.hiddenTypes.includes(t);
              return (
                <button key={t} type="button" className={`type-chip${off ? " is-off" : ""}`} aria-pressed={!off}
                  title={off ? "Click to bring this pitch back" : "Click to leave this pitch out"}
                  onClick={() => onChange({ ...filters, hiddenTypes: toggle(filters.hiddenTypes, t) })}>
                  <i style={{ background: pitchColorOnDark(t) }} />{t}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
