import { useCallback, useMemo, useState } from "react";
import PitcherFinder, { teamLabel } from "../PitcherFinder";
import FilterPanel from "../FilterPanel";
import { applyFilters, type Filters } from "../../lib/filters";
import { atWvuPark } from "../../lib/pairs";
import { arsenalLines, type ArsenalLine } from "../../lib/arsenalStats";
import { pitchColor } from "../../lib/pitchColors";
import type { IndexFile, Pitcher, PitchRow } from "../../lib/types";
import { ArsenalMovement, VeloRidges, ZoneHeatmaps } from "./ArsenalCharts";
import PitchVideo from "./PitchVideo";

interface Props {
  data: IndexFile;
  pitcherId: string;
  onPitcher: (id: string) => void;
  pitcher: Pitcher | null;
  loading: boolean;
  filters: Filters;
  onFilters: (f: Filters) => void;
}

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}`);
const num = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d).replace(/^-/, "−"));

const COLS: { key: string; label: string; title: string; cell: (l: ArsenalLine) => string }[] = [
  { key: "n", label: "Count", title: "Pitches thrown", cell: (l) => l.n.toLocaleString() },
  { key: "share", label: "%", title: "Share of his pitches", cell: (l) => pct(l.share) },
  { key: "velo", label: "Velo", title: "Release speed, mph", cell: (l) => num(l.velo) },
  { key: "ivb", label: "IVB", title: "Induced vertical break, in (gravity removed)", cell: (l) => num(l.ivb) },
  { key: "hb", label: "HB", title: "Horizontal break, in (+ = third-base side)", cell: (l) => num(l.hb) },
  { key: "spin", label: "Spin", title: "Spin rate, rpm", cell: (l) => num(l.spin, 0) },
  { key: "vaa", label: "VAA", title: "Vertical approach angle at the plate, degrees (more negative = steeper)", cell: (l) => num(l.vaa) },
  { key: "haa", label: "HAA", title: "Horizontal approach angle at the plate, degrees (+ = toward third base)", cell: (l) => num(l.haa) },
  { key: "relh", label: "Rel ht", title: "Release height, ft", cell: (l) => num(l.relHeight, 2) },
  { key: "ext", label: "Ext", title: "Extension: how far in front of the rubber he lets go, ft", cell: (l) => num(l.extension, 1) },
  { key: "shape", label: "Shape+", title: "Shape+ (not hooked up yet)", cell: (l) => num(l.shapePlus, 0) },
  { key: "zone", label: "Zone%", title: "Share of pitches in the strike zone", cell: (l) => pct(l.zonePct) },
  { key: "chase", label: "Chase%", title: "Swings at pitches out of the zone ÷ pitches out of the zone", cell: (l) => pct(l.chasePct) },
  { key: "whiff", label: "Whiff%", title: "Misses ÷ swings", cell: (l) => pct(l.whiffPct) },
];

export default function ArsenalTab({ data, pitcherId, onPitcher, pitcher, loading, filters, onFilters }: Props) {
  const rows = useMemo(() => (pitcher ? applyFilters(pitcher.pitches, filters) : []), [pitcher, filters]);
  const lines = useMemo(() => arsenalLines(rows), [rows]);
  const hasVideo = useCallback((r: PitchRow) => !!r.utc && atWvuPark(r, pitcher?.team), [pitcher?.team]);
  const [video, setVideo] = useState<PitchRow | null>(null);
  const summary = data.pitchers.find((p) => p.id === pitcherId);

  return (
    <div className="ars">
      <header className="ars-top">
        <div className="ars-who">
          {pitcher ? (
            <>
              <h2>{pitcher.name}</h2>
              <span>{pitcher.throws === "Left" ? "LHP" : "RHP"} · {teamLabel(pitcher.team ?? "")}{pitcher.conf && ` · ${pitcher.conf}`}{summary?.games != null && ` · ${summary.games} outings`}</span>
            </>
          ) : <h2>{loading ? "Loading…" : "Pick a pitcher"}</h2>}
        </div>
        <div className="ars-find"><PitcherFinder pitchers={data.pitchers} value={pitcherId} onChange={onPitcher} /></div>
        {pitcher && <div className="ars-filter"><FilterPanel all={pitcher.pitches} selected={rows.length} filters={filters} onChange={onFilters} /></div>}
      </header>

      {pitcher && rows.length === 0 && <p className="hint ars-empty">No pitches match these filters.</p>}
      {pitcher && rows.length > 0 && (
        <>
          <div className="ars-grid">
            <section className="card"><ArsenalMovement rows={rows} lines={lines} throws={pitcher.throws} hasVideo={hasVideo} onPick={setVideo} /></section>
            <section className="card"><VeloRidges rows={rows} lines={lines} /></section>
            <section className="card"><ZoneHeatmaps rows={rows} lines={lines} /></section>
          </div>
          <section className="card ars-table-card">
            <div className="ars-table-wrap">
              <table className="ars-table">
                <thead>
                  <tr><th>Pitch</th>{COLS.map((c) => <th key={c.key} title={c.title}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.type}>
                      <th scope="row"><i style={{ background: pitchColor(l.type) }} />{l.type}</th>
                      {COLS.map((c) => <td key={c.key} className={c.key === "shape" && l.shapePlus == null ? "na" : ""}>{c.cell(l)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">Release height, extension and approach angles come from Trackman's trajectory fit. Shape+ isn't hooked up yet. Hover a column name for its definition.</p>
          </section>
        </>
      )}
      {video && <PitchVideo row={video} onClose={() => setVideo(null)} />}
    </div>
  );
}
