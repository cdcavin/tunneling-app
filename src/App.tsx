import { useEffect, useMemo, useState } from "react";
import Scene3D, { CAMERA_PRESETS, type CameraPreset } from "./components/Scene3D";
import ZonePicker from "./components/ZonePicker";
import { MovementPlot, SeparationChart } from "./components/Charts";
import { aimAt, aimPoint, pairGeometry, separationCurve } from "./lib/physics";
import { HEAT_METRICS, metricValue, nextPitchCells, provisionalBest, type HeatMetric, type Loc } from "./lib/grid";
import { pitchColor, pitchColorOnDark } from "./lib/pitchColors";
import type { ArsenalPitch, DataFile, Pitcher } from "./lib/types";

const FASTBALLS = ["Four-Seam", "Fastball", "Sinker"];
const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "\u2212" : ""}${Math.abs(v).toFixed(d)}`;

function primaryFastball(p: Pitcher): ArsenalPitch {
  const fbs = p.pitches.filter((x) => FASTBALLS.includes(x.type));
  const pool = fbs.length ? fbs : p.pitches;
  return pool.reduce((a, b) => (b.n > a.n ? b : a));
}

function PitchButtons({ pitches, value, onChange, label }: { pitches: ArsenalPitch[]; value: string; onChange: (t: string) => void; label: string }) {
  return (
    <div className="pitch-buttons" role="radiogroup" aria-label={label}>
      {pitches.map((p) => (
        <button key={p.type} type="button" role="radio" aria-checked={p.type === value}
          className={p.type === value ? "is-on" : ""} onClick={() => onChange(p.type)}>
          <i style={{ background: pitchColor(p.type) }} aria-hidden="true" />
          {p.type}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}{unit && <small>{unit}</small>}</div>
      <div className="metric-label">{label}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DataFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitcherId, setPitcherId] = useState("");
  const [lastType, setLastType] = useState("");
  const [nextType, setNextType] = useState("");
  const [lastLoc, setLastLoc] = useState<Loc>({ side: 0, height: 2.0 });
  const [nextLoc, setNextLoc] = useState<Loc>({ side: 0, height: 1.5 });
  const [heatMetric, setHeatMetric] = useState<HeatMetric>("decision");
  const [maxDecision, setMaxDecision] = useState(4);
  const [showAim, setShowAim] = useState(false);
  const [camera, setCamera] = useState<CameraPreset>("catcher");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/pitchers.json`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`The data file did not load (HTTP ${r.status}).`); return r.json(); })
      .then((d: DataFile) => { setData(d); if (d.pitchers[0]) choosePitcher(d.pitchers[0]); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const pitcher = data?.pitchers.find((p) => p.id === pitcherId) ?? null;

  function choosePitcher(p: Pitcher) {
    setPitcherId(p.id);
    const fb = primaryFastball(p);
    setLastType(fb.type);
    const second = p.pitches.filter((x) => x.type !== fb.type).sort((a, b) => b.n - a.n)[0] ?? fb;
    setNextType(second.type);
  }

  const last = pitcher?.pitches.find((p) => p.type === lastType) ?? null;
  const next = pitcher?.pitches.find((p) => p.type === nextType) ?? null;

  const lastAimed = useMemo(() => (last ? aimAt(last.coeffs, lastLoc.side, lastLoc.height) : null), [last, lastLoc]);
  const nextAimed = useMemo(() => (next ? aimAt(next.coeffs, nextLoc.side, nextLoc.height) : null), [next, nextLoc]);
  const cells = useMemo(() => (lastAimed && next ? nextPitchCells(lastAimed, next.coeffs) : []), [lastAimed, next]);
  const best = useMemo(() => provisionalBest(cells, maxDecision), [cells, maxDecision]);
  const geo = lastAimed && nextAimed ? pairGeometry(lastAimed, nextAimed) : null;
  const curve = useMemo(() => (lastAimed && nextAimed ? separationCurve(lastAimed, nextAimed) : []), [lastAimed, nextAimed]);
  const aim = useMemo(() => {
    if (!showAim || !pitcher || !nextAimed) return null;
    return aimPoint(nextAimed, primaryFastball(pitcher).coeffs);
  }, [showAim, pitcher, nextAimed]);

  const sameType = lastType === nextType;
  const sceneLast = lastAimed && last ? { coeffs: lastAimed, color: pitchColorOnDark(last.type) } : null;
  const sceneNext = nextAimed && next ? { coeffs: nextAimed, color: pitchColorOnDark(next.type), dashed: sameType } : null;

  if (error) return <div className="state-msg"><h1>WVU Pitch Tunneling</h1><p>{error} Check that <code>public/data/pitchers.json</code> exists, then reload.</p></div>;
  if (!data) return <div className="state-msg"><p>Loading pitchers…</p></div>;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Pitch Tunneling</h1>
        <span className="wordmark">West Virginia Baseball</span>
        <span className="stamp">
          {data.sample ? <b className="sample-flag">Sample pitchers, not real data</b> : <>Data through {data.dataThrough}</>}
        </span>
      </header>

      <div className="layout">
        <aside className="controls" aria-label="Pitch selection">
          <section>
            <label className="field-label" htmlFor="pitcher">Pitcher</label>
            <select id="pitcher" value={pitcherId} onChange={(e) => { const p = data.pitchers.find((x) => x.id === e.target.value); if (p) choosePitcher(p); }}>
              {data.pitchers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.throws === "Right" ? "R" : "L"})</option>)}
            </select>
            {pitcher && <p className="hint">{pitcher.season} arsenal, {pitcher.pitches.reduce((s, p) => s + p.n, 0).toLocaleString()} pitches</p>}
          </section>

          <section>
            <h2>Last pitch</h2>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={lastType} onChange={setLastType} label="Last pitch type" />}
            <ZonePicker label="Last pitch location" selected={lastLoc} onSelect={setLastLoc} color={last ? pitchColor(last.type) : "#13294b"} />
          </section>

          <section>
            <h2>Next pitch</h2>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={nextType} onChange={setNextType} label="Next pitch type" />}
            <div className="segmented" role="radiogroup" aria-label="Shade the grid by">
              {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={m === heatMetric} className={m === heatMetric ? "is-on" : ""} onClick={() => setHeatMetric(m)}>
                  {HEAT_METRICS[m].label}
                </button>
              ))}
            </div>
            <ZonePicker
              label="Next pitch location, shaded by tunnel quality"
              selected={nextLoc}
              onSelect={setNextLoc}
              color={next ? pitchColor(next.type) : "#13294b"}
              best={best}
              heat={{ cells, value: (c) => metricValue(c.geo, heatMetric), better: HEAT_METRICS[heatMetric].better, unit: "in" }}
            />
            <div className="best-row">
              <button type="button" className="primary" disabled={!best} onClick={() => best && setNextLoc({ side: best.side, height: best.height })}>
                Move to best spot
              </button>
              <label className="slider">
                <span>Best spot stays within <b>{maxDecision} in</b> at 23.8 ft</span>
                <input type="range" min={1} max={10} step={0.5} value={maxDecision} onChange={(e) => setMaxDecision(Number(e.target.value))} />
              </label>
            </div>
            <p className="hint">The best spot is a placeholder rule: farthest apart at the plate while staying close at 23.8 ft. The outcome model replaces it.</p>
          </section>

          <section>
            <h2>Situation</h2>
            <div className="disabled-group" aria-disabled="true">
              <label className="field-label" htmlFor="count">Count</label>
              <select id="count" disabled><option>Any count</option></select>
              <label className="field-label" htmlFor="hitter">Hitter</label>
              <select id="hitter" disabled><option>Either side</option></select>
            </div>
            <p className="hint">Count and hitter side change xWhiff and xWeakCon once the outcome model is in.</p>
          </section>
        </aside>

        <main className="stage">
          <div className="scene-wrap">
            <Scene3D last={sceneLast} next={sceneNext} aim={aim} aimColor={next ? pitchColorOnDark(next.type) : "#ffffff"} camera={camera} />
            <div className="scene-legend">
              {last && <span><i style={{ background: pitchColorOnDark(last.type) }} />Last: {last.type}</span>}
              {next && <span><i style={{ background: pitchColorOnDark(next.type) }} className={sameType ? "dashed" : ""} />Next: {next.type}</span>}
              <span><i className="gold" />23.8 ft decision point</span>
            </div>
            <div className="camera-bar" role="radiogroup" aria-label="Camera">
              {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={k === camera} className={k === camera ? "is-on" : ""} onClick={() => setCamera(k)}>
                  {CAMERA_PRESETS[k].label}
                </button>
              ))}
              <label className="aim-toggle"><input type="checkbox" checked={showAim} onChange={(e) => setShowAim(e.target.checked)} /> Aim point</label>
            </div>
          </div>

          <div className="metrics" aria-live="polite">
            <Metric label="Apart at 23.8 ft" value={geo ? geo.decisionSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Apart at the plate" value={geo ? geo.plateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Late separation" value={geo ? geo.lateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Velo gap" value={last && next ? signed(next.velo - last.velo) : "—"} unit="mph" />
            <Metric label="Extra flight time" value={geo ? signed(geo.flightTimeDiffMs, 0) : "—"} unit="ms" />
            <Metric label="xWhiff" value="—" note="model not built" />
            <Metric label="xWeakCon" value="—" note="model not built" />
          </div>

          <SeparationChart curve={curve} />
        </main>

        <aside className="side" aria-label="Video and pitch shapes">
          <figure className="video-slot">
            <figcaption>Video overlay</figcaption>
            <div className="video-empty">
              <p>AWRE clips of real pairs he has thrown will play here, stacked so you can see how they tunnel.</p>
            </div>
          </figure>
          {pitcher && <MovementPlot pitches={pitcher.pitches} lastType={lastType} nextType={nextType} />}
        </aside>
      </div>
    </div>
  );
}
