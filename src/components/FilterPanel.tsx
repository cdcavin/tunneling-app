import { extent, outings, NO_FILTERS, type Filters, type Range } from "../lib/filters";
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

function RangeRow({ label, unit, full, value, onChange }: { label: string; unit: string; full: Range; value: Range | null; onChange: (r: Range | null) => void }) {
  const v = value ?? full;
  const set = (min: number, max: number) => {
    const r = { min: Math.min(min, max), max: Math.max(min, max) };
    onChange(r.min <= full.min && r.max >= full.max ? null : r);
  };
  return (
    <div className="range-row">
      <span className="range-label">{label}</span>
      <div className="range-inputs">
        <input type="range" min={full.min} max={full.max} step={0.5} value={v.min} onChange={(e) => set(Number(e.target.value), v.max)} aria-label={`${label} minimum`} />
        <input type="range" min={full.min} max={full.max} step={0.5} value={v.max} onChange={(e) => set(v.min, Number(e.target.value))} aria-label={`${label} maximum`} />
      </div>
      <b className={value ? "on" : ""}>{v.min}–{v.max} {unit}</b>
    </div>
  );
}

export default function FilterPanel({ all, selected, filters, onChange }: Props) {
  const seasons = seasonsOf(all);
  // Outings listed are those within the chosen seasons, so the list stays short.
  const inSeason = filters.seasons.length ? all.filter((p) => filters.seasons.includes(p.season)) : all;
  const games = outings(inSeason);
  const opponents = [...new Set(inSeason.map((p) => p.opponent))].sort();
  const types = [...new Set(all.map((p) => p.type))].sort((a, b) => all.filter((p) => p.type === b).length - all.filter((p) => p.type === a).length);
  const active = selected !== all.length;

  return (
    <div className="filters">
      <div className="filter-head">
        <span><b>{selected.toLocaleString()}</b> of {all.length.toLocaleString()} pitches</span>
        {active && <button type="button" className="link" onClick={() => onChange(NO_FILTERS)}>Show all</button>}
      </div>

      {seasons.length > 1 && (
        <div className="filter-group">
          <span className="filter-label">Season</span>
          <div className="chips">
            {seasons.map((sn) => (
              <button key={sn} type="button" className={`chip${filters.seasons.includes(sn) ? " is-on" : ""}`}
                onClick={() => onChange({ ...filters, seasons: toggle(filters.seasons, sn), games: [] })}>{sn}</button>
            ))}
          </div>
        </div>
      )}

      <div className="filter-group">
        <span className="filter-label">Outing</span>
        <div className="chips">
          {games.map((g) => (
            <button key={g.game} type="button" className={`chip${filters.games.includes(g.game) ? " is-on" : ""}`}
              onClick={() => onChange({ ...filters, games: toggle(filters.games, g.game) })}>
              {`${Number(g.date.slice(5, 7))}/${Number(g.date.slice(8, 10))}`} {g.opponent}<small>{g.n}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Opponent</span>
        <div className="chips">
          {opponents.map((o) => (
            <button key={o} type="button" className={`chip${filters.opponents.includes(o) ? " is-on" : ""}`}
              onClick={() => onChange({ ...filters, opponents: toggle(filters.opponents, o) })}>{o}</button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Pitch <small>(all in; click to leave one out)</small></span>
        <div className="chips">
          {types.map((t) => (
            <button key={t} type="button" className={`chip${filters.hiddenTypes.includes(t) ? " is-off" : " is-on"}`}
              aria-pressed={!filters.hiddenTypes.includes(t)} title={filters.hiddenTypes.includes(t) ? "Click to bring this pitch back" : "Click to leave this pitch out"}
              onClick={() => onChange({ ...filters, hiddenTypes: toggle(filters.hiddenTypes, t) })}>
              <i style={{ background: pitchColorOnDark(t) }} />{t}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <span className="filter-label">Shape</span>
        <RangeRow label="Velo" unit="mph" full={extent(all, "velo")} value={filters.velo} onChange={(r) => onChange({ ...filters, velo: r })} />
        <RangeRow label="Vert" unit="in" full={extent(all, "ivb")} value={filters.ivb} onChange={(r) => onChange({ ...filters, ivb: r })} />
        <RangeRow label="Horz" unit="in" full={extent(all, "hb")} value={filters.hb} onChange={(r) => onChange({ ...filters, hb: r })} />
      </div>
    </div>
  );
}
