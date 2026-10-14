import { useEffect, useMemo, useRef, useState } from "react";
import Scene3D, { CAMERA_PRESETS, type CameraPreset } from "./components/Scene3D";
import ZonePicker from "./components/ZonePicker";
import { MovementPlot, SeparationChart } from "./components/Charts";
import { aimAt, aimPoint, pairGeometry, perturb, PLATE_X, separationCurve, timeAtDist, type ShapeDelta } from "./lib/physics";
import { HEAT_METRICS, metricValue, nextPitchCells, provisionalBest, tightest, type Cell, type HeatMetric, type Loc } from "./lib/grid";
import { suggestShapes, type Suggestion } from "./lib/suggest";
import { pitchColorOnDark } from "./lib/pitchColors";
import type { ArsenalPitch, DataFile, Pitcher } from "./lib/types";

const FASTBALLS = ["Four-Seam", "Fastball", "Sinker"];
const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1];
const NO_DELTA: ShapeDelta = { ivb: 0, hb: 0, velo: 0 };

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
          <i style={{ background: pitchColorOnDark(p.type) }} aria-hidden="true" />
          {p.type}<small>{p.velo.toFixed(0)}</small>
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value, unit, note, accent }: { label: string; value: string; unit?: string; note?: string; accent?: boolean }) {
  return (
    <div className={`metric${accent ? " accent" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}{unit && <small>{unit}</small>}</div>
      {note && <div className="metric-note">{note}</div>}
    </div>
  );
}

function DeltaSlider({ label, unit, value, min, max, step, onChange }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="delta">
      <span className="delta-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <b>{signed(value, 1)} {unit}</b>
    </label>
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
  const [delta, setDelta] = useState<ShapeDelta>(NO_DELTA);
  const [suggestions, setSuggestions] = useState<{ current: Suggestion; best: Suggestion[] } | null>(null);
  const [showAim, setShowAim] = useState(false);
  const [showHeat3D, setShowHeat3D] = useState(true);
  const [camera, setCamera] = useState<CameraPreset>("catcher");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0.1);
  const [clock, setClock] = useState<number | null>(null);
  const clockRef = useRef<number | null>(null);

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
    setDelta(NO_DELTA); setSuggestions(null);
  }
  function chooseNextType(t: string) { setNextType(t); setDelta(NO_DELTA); setSuggestions(null); }

  const last = pitcher?.pitches.find((p) => p.type === lastType) ?? null;
  const next = pitcher?.pitches.find((p) => p.type === nextType) ?? null;
  const shaped = useMemo(() => (next ? perturb(next.coeffs, delta) : null), [next, delta]);

  const lastAimed = useMemo(() => (last ? aimAt(last.coeffs, lastLoc.side, lastLoc.height) : null), [last, lastLoc]);
  const nextAimed = useMemo(() => (shaped ? aimAt(shaped, nextLoc.side, nextLoc.height) : null), [shaped, nextLoc]);
  const cells = useMemo(() => (lastAimed && shaped ? nextPitchCells(lastAimed, shaped) : []), [lastAimed, shaped]);
  const bestTight = useMemo(() => tightest(cells), [cells]);
  const bestFar = useMemo(() => provisionalBest(cells, maxDecision), [cells, maxDecision]);
  const geo = lastAimed && nextAimed ? pairGeometry(lastAimed, nextAimed) : null;
  const curve = useMemo(() => (lastAimed && nextAimed ? separationCurve(lastAimed, nextAimed) : []), [lastAimed, nextAimed]);
  const aim = useMemo(() => {
    if (!showAim || !pitcher || !nextAimed) return null;
    return aimPoint(nextAimed, primaryFastball(pitcher).coeffs);
  }, [showAim, pitcher, nextAimed]);
  const heat = useMemo(() => (showHeat3D && cells.length
    ? { cells, value: (c: Cell) => metricValue(c.geo, heatMetric), better: HEAT_METRICS[heatMetric].better } : null),
    [showHeat3D, cells, heatMetric]);
  const heatProps = { cells, value: (c: Cell) => metricValue(c.geo, heatMetric), better: HEAT_METRICS[heatMetric].better, unit: "in" };

  // Flight clock: both balls leave the hand at t = 0 and fly on the same clock.
  const flightEnd = useMemo(() => Math.max(...[lastAimed, nextAimed].map((c) => (c ? timeAtDist(c, PLATE_X) ?? 0 : 0))), [lastAimed, nextAimed]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, prev = performance.now();
    const tick = (now: number) => {
      const t = Math.min(flightEnd, (clockRef.current ?? 0) + ((now - prev) / 1000) * speed);
      prev = now;
      clockRef.current = t;
      setClock(t);
      if (t >= flightEnd) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, flightEnd]);
  const play = () => { if (clockRef.current == null || clockRef.current >= flightEnd) clockRef.current = 0; setPlaying(true); };
  const reset = () => { setPlaying(false); clockRef.current = null; setClock(null); };
  const scrub = (t: number) => { setPlaying(false); clockRef.current = t; setClock(t); };

  const runSuggestions = () => { if (lastAimed && next) setSuggestions(suggestShapes(lastAimed, next.coeffs, "tightThenFar", maxDecision)); };
  const applySuggestion = (s: Suggestion) => { setDelta(s.delta); setNextLoc({ side: s.cell.side, height: s.cell.height }); };

  const sameType = lastType === nextType;
  const sceneLast = lastAimed && last ? { coeffs: lastAimed, color: pitchColorOnDark(last.type) } : null;
  const sceneNext = nextAimed && next ? { coeffs: nextAimed, color: pitchColorOnDark(next.type), dashed: sameType } : null;
  const shapedPitch = next && (delta.ivb || delta.hb || delta.velo)
    ? { type: next.type, ivb: next.ivb + delta.ivb, hb: next.hb + delta.hb, velo: next.velo + delta.velo } : null;

  if (error) return <div className="state-msg"><h1>WVU Pitch Tunneling</h1><p>{error} Check that <code>public/data/pitchers.json</code> exists, then reload.</p></div>;
  if (!data) return <div className="state-msg"><p>Loading pitchers…</p></div>;

  return (
    <div className="app">
      <header className="topbar">
        <span className="mark">WV</span>
        <h1>Pitch Tunneling</h1>
        <span className="brand"><b>West Virginia Baseball</b><span className="x">×</span>BioPrecision Labs</span>
        <span className="stamp">
          {data.sample ? <b className="sample-flag">Sample pitchers, not real data</b> : <>Data through {data.dataThrough}</>}
        </span>
      </header>

      <div className="layout">
        <aside className="panel left" aria-label="Pitch selection">
          <section>
            <div className="sec-title">Pitcher</div>
            <select id="pitcher" aria-label="Pitcher" value={pitcherId} onChange={(e) => { const p = data.pitchers.find((x) => x.id === e.target.value); if (p) choosePitcher(p); }}>
              {data.pitchers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.throws === "Right" ? "R" : "L"})</option>)}
            </select>
            {pitcher && <p className="hint">{pitcher.season}, {pitcher.pitches.reduce((s, p) => s + p.n, 0).toLocaleString()} pitches</p>}
          </section>

          <section className="pitch-block" style={{ ["--accent" as string]: last ? pitchColorOnDark(last.type) : "#9aa7ba" }}>
            <div className="sec-title">Anchor pitch</div>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={lastType} onChange={setLastType} label="Anchor pitch type" />}
            <ZonePicker label="Anchor pitch location" selected={lastLoc} onSelect={setLastLoc} color={last ? pitchColorOnDark(last.type) : "#9aa7ba"} />
          </section>

          <section className="pitch-block" style={{ ["--accent" as string]: next ? pitchColorOnDark(next.type) : "#9aa7ba" }}>
            <div className="sec-title">Tunnel pitch</div>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={nextType} onChange={chooseNextType} label="Tunnel pitch type" />}
            <div className="segmented" role="radiogroup" aria-label="Shade the grid by">
              {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={m === heatMetric} className={m === heatMetric ? "is-on" : ""} onClick={() => setHeatMetric(m)}>
                  {HEAT_METRICS[m].label}
                </button>
              ))}
            </div>
            <ZonePicker label="Tunnel pitch location, shaded by tunnel quality" selected={nextLoc} onSelect={setNextLoc}
              color={next ? pitchColorOnDark(next.type) : "#9aa7ba"} best={bestTight} heat={heatProps} />
            <div className="lock-row">
              <button type="button" className="primary" disabled={!bestTight} onClick={() => bestTight && setNextLoc({ side: bestTight.side, height: bestTight.height })}>
                Lock tightest tunnel
              </button>
              <button type="button" className="secondary" disabled={!bestFar} onClick={() => bestFar && setNextLoc({ side: bestFar.side, height: bestFar.height })}>
                Lock tight, then far
              </button>
            </div>
            <label className="slider">
              <span>“Tight, then far” stays within <b>{maxDecision} in</b> at 23.8 ft</span>
              <input type="range" min={1} max={10} step={0.5} value={maxDecision} onChange={(e) => setMaxDecision(Number(e.target.value))} aria-label="Tight-then-far limit at 23.8 ft, inches" />
            </label>
          </section>

          <section>
            <div className="sec-title">Situation</div>
            <div className="disabled-group" aria-disabled="true">
              <select aria-label="Count" disabled><option>Any count</option></select>
              <select aria-label="Hitter" disabled><option>Either side</option></select>
            </div>
            <p className="hint">Count and hitter side feed xWhiff and xWeakCon once the outcome model is in.</p>
          </section>
        </aside>

        <main className="center">
          <div className="views">
            <div className="stage">
              <Scene3D last={sceneLast} next={sceneNext} aim={aim} aimColor={next ? pitchColorOnDark(next.type) : "#ffffff"} camera={camera}
                heat={heat} selected={nextLoc} best={bestTight} onPick={setNextLoc} flightTime={clock} />
              <div className="hud hud-legend">
                {last && <span><i style={{ background: pitchColorOnDark(last.type) }} />Anchor: {last.type}</span>}
                {next && <span><i style={{ background: pitchColorOnDark(next.type) }} className={sameType ? "dashed" : ""} />Tunnel: {next.type}{shapedPitch && " (modified)"}</span>}
                <span><i className="gold" />Decision point, 23.8 ft</span>
              </div>
              <div className="hud hud-cams" role="radiogroup" aria-label="Camera">
                {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={k === camera} className={k === camera ? "is-on" : ""} onClick={() => setCamera(k)}>
                    {CAMERA_PRESETS[k].label}
                  </button>
                ))}
              </div>
              <div className="hud hud-toggles">
                <label className="hud-check"><input type="checkbox" checked={showHeat3D} onChange={(e) => setShowHeat3D(e.target.checked)} />Heat on plate</label>
                <label className="hud-check"><input type="checkbox" checked={showAim} onChange={(e) => setShowAim(e.target.checked)} />Aim point</label>
              </div>
              <div className="hud hud-play">
                <button type="button" className="play" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? "Pause" : "Play both pitches"}>
                  {playing ? "❚❚" : "▶"}
                </button>
                <button type="button" className="ghost" onClick={reset} disabled={clock == null}>Full paths</button>
                <input type="range" className="scrub" min={0} max={flightEnd || 1} step={0.001} value={clock ?? flightEnd} onChange={(e) => scrub(Number(e.target.value))} aria-label="Flight time" />
                <span className="clock">{((clock ?? flightEnd) * 1000).toFixed(0)} ms</span>
                <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </div>
            </div>

            <div className="video">
              <div className="video-empty">
                <div className="sec-title">Video overlay</div>
                <p>AWRE clips of real pairs he has thrown, stacked at release, play here.</p>
              </div>
            </div>
          </div>

          <div className="metrics" aria-live="polite">
            <Metric label="Apart at 23.8 ft" value={geo ? geo.decisionSep.toFixed(1) : "—"} unit="in" accent />
            <Metric label="Apart at plate" value={geo ? geo.plateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Late separation" value={geo ? geo.lateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Velo gap" value={last && next ? signed(next.velo + delta.velo - last.velo) : "—"} unit="mph" />
            <Metric label="Extra flight" value={geo ? signed(geo.flightTimeDiffMs, 0) : "—"} unit="ms" />
            <Metric label="xWhiff" value="—" note="model pending" />
            <Metric label="xWeakCon" value="—" note="model pending" />
          </div>

          <div className="cards">
            <section className="card sandbox">
              <div className="sec-title">Shape sandbox{next && `: ${next.type}`}</div>
              <DeltaSlider label="Vert" unit="in" value={delta.ivb} min={-8} max={8} step={0.5} onChange={(v) => setDelta({ ...delta, ivb: v })} />
              <DeltaSlider label="Horz" unit="in" value={delta.hb} min={-8} max={8} step={0.5} onChange={(v) => setDelta({ ...delta, hb: v })} />
              <DeltaSlider label="Velo" unit="mph" value={delta.velo} min={-4} max={4} step={0.5} onChange={(v) => setDelta({ ...delta, velo: v })} />
              <div className="sandbox-row">
                <button type="button" className="secondary" onClick={() => setDelta(NO_DELTA)} disabled={!shapedPitch}>Reset shape</button>
                <button type="button" className="primary" onClick={runSuggestions} disabled={!next || !lastAimed}>Suggest changes</button>
              </div>
              {shapedPitch && next && (
                <p className="hint">Now {shapedPitch.velo.toFixed(1)} mph, {shapedPitch.ivb.toFixed(1)} in vert, {shapedPitch.hb.toFixed(1)} in horz (was {next.velo.toFixed(1)}, {next.ivb.toFixed(1)}, {next.hb.toFixed(1)}).</p>
              )}
              {suggestions && (
                <div className="suggest">
                  <p className="hint">As is, at its best spot: <b>{suggestions.current.decisionSep.toFixed(1)} in</b> at 23.8 ft, {suggestions.current.plateSep.toFixed(0)} in at the plate.</p>
                  {suggestions.best.length === 0 && <p className="hint">No small change beats the current shape under the tight-then-far rule.</p>}
                  {suggestions.best.map((s) => (
                    <button key={s.label} type="button" className="suggest-row" onClick={() => applySuggestion(s)}>
                      <span className="suggest-label">{s.label}</span>
                      <span className="suggest-num"><b>{s.decisionSep.toFixed(1)}</b> in at 23.8</span>
                      <span className="suggest-num">{s.plateSep.toFixed(0)} in at plate</span>
                    </button>
                  ))}
                  <p className="hint">Each one moves the pitch to its own best spot. Click to try it.</p>
                </div>
              )}
            </section>
            <section className="card">
              {pitcher && <MovementPlot pitches={pitcher.pitches} lastType={lastType} nextType={nextType} modified={shapedPitch} />}
            </section>
            <section className="card">
              <SeparationChart curve={curve} />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
