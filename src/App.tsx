import { useEffect, useMemo, useRef, useState } from "react";
import Scene3D, { CAMERA_PRESETS, type CameraPreset } from "./components/Scene3D";
import ZonePicker from "./components/ZonePicker";
import { MovementPlot, SeparationChart } from "./components/Charts";
import { aimAt, aimPoint, pairGeometry, PLATE_X, separationCurve, timeAtDist } from "./lib/physics";
import { HEAT_METRICS, metricValue, nextPitchCells, provisionalBest, type HeatMetric, type Loc } from "./lib/grid";
import { pitchColorOnDark } from "./lib/pitchColors";
import type { ArsenalPitch, DataFile, Pitcher } from "./lib/types";

const FASTBALLS = ["Four-Seam", "Fastball", "Sinker"];
const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1];

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
  const heat = useMemo(() => (showHeat3D && cells.length
    ? { cells, value: (c: typeof cells[number]) => metricValue(c.geo, heatMetric), better: HEAT_METRICS[heatMetric].better }
    : null), [showHeat3D, cells, heatMetric]);

  // Flight clock: both balls leave the hand at t = 0 and fly on the same clock.
  const flightEnd = useMemo(() => {
    const ts = [lastAimed, nextAimed].map((c) => (c ? timeAtDist(c, PLATE_X) ?? 0 : 0));
    return Math.max(...ts);
  }, [lastAimed, nextAimed]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, prev = performance.now();
    const tick = (now: number) => {
      const dt = ((now - prev) / 1000) * speed;
      prev = now;
      const t = Math.min(flightEnd, (clockRef.current ?? 0) + dt);
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

  const sameType = lastType === nextType;
  const sceneLast = lastAimed && last ? { coeffs: lastAimed, color: pitchColorOnDark(last.type) } : null;
  const sceneNext = nextAimed && next ? { coeffs: nextAimed, color: pitchColorOnDark(next.type), dashed: sameType } : null;
  const heatProps = { cells, value: (c: typeof cells[number]) => metricValue(c.geo, heatMetric), better: HEAT_METRICS[heatMetric].better, unit: "in" };

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
            <div className="sec-title">Last pitch</div>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={lastType} onChange={setLastType} label="Last pitch type" />}
            <ZonePicker label="Last pitch location" selected={lastLoc} onSelect={setLastLoc} color={last ? pitchColorOnDark(last.type) : "#9aa7ba"} />
          </section>

          <section className="pitch-block" style={{ ["--accent" as string]: next ? pitchColorOnDark(next.type) : "#9aa7ba" }}>
            <div className="sec-title">Next pitch</div>
            {pitcher && <PitchButtons pitches={pitcher.pitches} value={nextType} onChange={setNextType} label="Next pitch type" />}
            <div className="segmented" role="radiogroup" aria-label="Shade the grid by">
              {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={m === heatMetric} className={m === heatMetric ? "is-on" : ""} onClick={() => setHeatMetric(m)}>
                  {HEAT_METRICS[m].label}
                </button>
              ))}
            </div>
            <ZonePicker label="Next pitch location, shaded by tunnel quality" selected={nextLoc} onSelect={setNextLoc}
              color={next ? pitchColorOnDark(next.type) : "#9aa7ba"} best={best} heat={heatProps} />
            <div className="best-row">
              <button type="button" className="primary" disabled={!best} onClick={() => best && setNextLoc({ side: best.side, height: best.height })}>
                Move to best spot
              </button>
              <label className="slider">
                <span>within <b>{maxDecision} in</b> at 23.8 ft</span>
                <input type="range" min={1} max={10} step={0.5} value={maxDecision} onChange={(e) => setMaxDecision(Number(e.target.value))} aria-label="Best spot must stay within this many inches at 23.8 ft" />
              </label>
            </div>
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

        <main className="stage">
          <Scene3D last={sceneLast} next={sceneNext} aim={aim} aimColor={next ? pitchColorOnDark(next.type) : "#ffffff"} camera={camera}
            heat={heat} selected={nextLoc} best={best} onPick={setNextLoc} flightTime={clock} />

          <div className="hud hud-legend">
            {last && <span><i style={{ background: pitchColorOnDark(last.type) }} />Last: {last.type}</span>}
            {next && <span><i style={{ background: pitchColorOnDark(next.type) }} className={sameType ? "dashed" : ""} />Next: {next.type}</span>}
            <span><i className="gold" />Decision point, 23.8 ft</span>
          </div>

          <div className="hud hud-cams" role="radiogroup" aria-label="Camera">
            {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={k === camera} className={k === camera ? "is-on" : ""} onClick={() => setCamera(k)}>
                {CAMERA_PRESETS[k].label}
              </button>
            ))}
            <span className="hud-sep" />
            <label className="hud-check"><input type="checkbox" checked={showHeat3D} onChange={(e) => setShowHeat3D(e.target.checked)} />Heat on plate</label>
            <label className="hud-check"><input type="checkbox" checked={showAim} onChange={(e) => setShowAim(e.target.checked)} />Aim point</label>
          </div>

          <div className="hud hud-play">
            <button type="button" className="play" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? "Pause" : "Play both pitches"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <button type="button" className="ghost" onClick={reset} disabled={clock == null}>Full paths</button>
            <input type="range" className="scrub" min={0} max={flightEnd || 1} step={0.001} value={clock ?? flightEnd} onChange={(e) => scrub(Number(e.target.value))} aria-label="Flight time" />
            <span className="clock">{clock == null ? `${(flightEnd * 1000).toFixed(0)} ms` : `${(clock * 1000).toFixed(0)} ms`}</span>
            <select className="speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>

          <div className="metrics" aria-live="polite">
            <Metric label="Apart at 23.8 ft" value={geo ? geo.decisionSep.toFixed(1) : "—"} unit="in" accent />
            <Metric label="Apart at plate" value={geo ? geo.plateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Late separation" value={geo ? geo.lateSep.toFixed(1) : "—"} unit="in" />
            <Metric label="Velo gap" value={last && next ? signed(next.velo - last.velo) : "—"} unit="mph" />
            <Metric label="Extra flight" value={geo ? signed(geo.flightTimeDiffMs, 0) : "—"} unit="ms" />
            <Metric label="xWhiff" value="—" note="model pending" />
            <Metric label="xWeakCon" value="—" note="model pending" />
          </div>
        </main>

        <aside className="panel right" aria-label="Video and pitch shapes">
          <section>
            <div className="sec-title">Video overlay</div>
            <div className="video-empty"><p>AWRE clips of real pairs he has thrown, stacked at release.</p></div>
          </section>
          <section>{pitcher && <MovementPlot pitches={pitcher.pitches} lastType={lastType} nextType={nextType} />}</section>
          <section><SeparationChart curve={curve} /></section>
        </aside>
      </div>
    </div>
  );
}
