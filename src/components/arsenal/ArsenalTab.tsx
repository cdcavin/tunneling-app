import { useCallback, useMemo, useState } from "react";
import PitcherFinder, { teamLabel } from "../PitcherFinder";
import FilterPanel from "../FilterPanel";
import { applyFilters, type Filters } from "../../lib/filters";
import { atWvuPark } from "../../lib/pairs";
import { ANY_SITUATION, applySituation, arsenalLines, COUNT_CHOICES, inCircle, RESULT_CHOICES, type ArsenalLine, type Circle, type Situation } from "../../lib/arsenalStats";
import ZoneDraw from "./ZoneDraw";
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
  const [sit, setSit] = useState<Situation>(ANY_SITUATION);
  const [circle, setCircle] = useState<Circle | null>(null);
  const dated = useMemo(() => (pitcher ? applyFilters(pitcher.pitches, filters) : []), [pitcher, filters]);
  const rows = useMemo(() => applySituation(dated, sit), [dated, sit]);                       // everything after the filters
  const picked = useMemo(() => (circle ? rows.filter((r) => inCircle(r, circle)) : rows), [rows, circle]);   // inside the circle
  const inside = useMemo(() => (circle ? new Set(picked.map((r) => r.id)) : null), [circle, picked]);
  const lines = useMemo(() => arsenalLines(picked), [picked]);
  const types = useMemo(() => arsenalLines(rows).map((l) => l.type), [rows]);
  const insideCount = useMemo(() => Object.fromEntries(lines.map((l) => [l.type, l.n])), [lines]);
  const skewed = !!circle || sit.result !== "all";
  const hasVideo = useCallback((r: PitchRow) => !!r.utc && atWvuPark(r, pitcher?.team), [pitcher?.team]);
  const [video, setVideo] = useState<PitchRow | null>(null);
  const summary = data.pitchers.find((p) => p.id === pitcherId);

  return (
    <div className="layout ars-layout">
      <aside className="panel left" aria-label="Pitcher">
        <section>
          <div className="sec-title">Pitcher</div>
          <PitcherFinder pitchers={data.pitchers} value={pitcherId} onChange={onPitcher} />
          {loading && <p className="hint">Loading pitches…</p>}
          {pitcher && <p className="hint ars-who">{pitcher.throws === "Left" ? "LHP" : "RHP"} · {teamLabel(pitcher.team ?? "")}{pitcher.conf && ` · ${pitcher.conf}`}{summary?.games != null && ` · ${summary.games} outings`}</p>}
        </section>
        {pitcher && (
          <section className="dfilter-sec">
            <FilterPanel all={pitcher.pitches} selected={dated.length} filters={filters} onChange={onFilters} />
          </section>
        )}
        {pitcher && (
          <section>
            <div className="sec-title">Location <span className="ars-sub">catcher's view</span></div>
            <ZoneDraw rows={rows} circle={circle} onChange={setCircle} insideCount={insideCount} />
          </section>
        )}
        {pitcher && (
          <section className="ars-sit">
            <div className="sec-title">Situation</div>
            <div className="ars-sit-row"><span>Count</span><div className="segmented" role="radiogroup" aria-label="Count">
              {COUNT_CHOICES.map(([k, l, t]) => <button key={k} type="button" role="radio" aria-checked={sit.count === k} className={sit.count === k ? "is-on" : ""} title={t} onClick={() => setSit({ ...sit, count: k })}>{l}</button>)}
            </div></div>
            <div className="ars-sit-row"><span>Result</span><div className="segmented" role="radiogroup" aria-label="Result">
              {RESULT_CHOICES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={sit.result === k} className={sit.result === k ? "is-on" : ""} onClick={() => setSit({ ...sit, result: k })}>{l}</button>)}
            </div></div>
            <p className="hint">{rows.length.toLocaleString()} of {dated.length.toLocaleString()} pitches match.</p>
          </section>
        )}
        <section>
          <div className="sec-title">Video</div>
          <p className="hint ars-key"><span className="k-fill" /> filled dot: has video, click it <br /><span className="k-hollow" /> hollow dot: away game, no video</p>
        </section>
      </aside>
      <main className="ars-main">
      {pitcher && picked.length === 0 && <p className="hint ars-empty">No pitches match these filters{circle && " inside the circle"}.</p>}
      {pitcher && picked.length > 0 && (
        <>
          <div className="ars-grid">
            <section className="card"><ArsenalMovement rows={rows} lines={lines} throws={pitcher.throws} hasVideo={hasVideo} onPick={setVideo} inside={inside} /></section>
            <section className="card"><VeloRidges rows={picked} lines={lines} /></section>
            <section className="card"><ZoneHeatmaps rows={rows} types={types} /></section>
          </div>
          <section className="card ars-table-card">
            {skewed && <p className="ars-warn">Zone %, Chase % and Whiff % only count the pitches {circle ? "inside your circle" : ""}{circle && sit.result !== "all" ? " and " : ""}{sit.result !== "all" ? "matching the result filter" : ""}, so they're skewed by the selection. Don't read them as his real rates.</p>}
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
          </section>
        </>
      )}
      </main>
      {video && <PitchVideo row={video} onClose={() => setVideo(null)} />}
    </div>
  );
}
