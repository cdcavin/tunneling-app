import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Scene3D, { CAMERA_PRESETS, type CameraPreset } from "./components/Scene3D";
import ZonePicker from "./components/ZonePicker";
import { MovementPlot, SeparationChart } from "./components/Charts";
import { aimAt, aimPoint, DECISION_FT, pairGeometry, perturb, PLATE_X, posAtTime, separationCurve, timeAtDist, type ShapeDelta } from "./lib/physics";
import { HEAT_METRICS, metricValue, nextPitchCells, provisionalBest, tightest, type Cell, type HeatMetric, type Loc } from "./lib/grid";
import { suggestShapes, type Suggestion } from "./lib/suggest";
import { pitchColorOnDark } from "./lib/pitchColors";
import FilterPanel from "./components/FilterPanel";
import VideoOverlay from "./components/VideoOverlay";
import ArsenalPanel, { type ArsenalRow } from "./components/ArsenalPanel";
import BestTunnels from "./components/BestTunnels";
import PitcherFinder from "./components/PitcherFinder";
import { realLoc } from "./lib/arsenal";
import { realPairs, type RealPair } from "./lib/pairs";
import { applyFilters, NO_FILTERS, type Filters } from "./lib/filters";
import { buildArsenal, seasonsOf, type ArsenalPitch, type IndexFile, type Pitcher } from "./lib/types";

const FASTBALLS = ["Four-Seam", "Fastball", "Sinker"];
const signed = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;
const SPEEDS = [0.05, 0.1, 0.25, 0.5, 1];
const NO_DELTA: ShapeDelta = { ivb: 0, hb: 0, velo: 0 };

function primaryFastball(arsenal: ArsenalPitch[]): ArsenalPitch | null {
  const fbs = arsenal.filter((x) => FASTBALLS.includes(x.type));
  const pool = fbs.length ? fbs : arsenal;
  return pool.length ? pool.reduce((a, b) => (b.n > a.n ? b : a)) : null;
}

function PitchButtons({ pitches, value, onChange, label }: { pitches: ArsenalPitch[]; value: string; onChange: (t: string) => void; label: string }) {
  return (
    <div className="pitch-buttons" role="radiogroup" aria-label={label}>
      {pitches.map((p) => (
        <button key={p.type} type="button" role="radio" aria-checked={p.type === value}
          className={p.type === value ? "is-on" : ""} onClick={() => onChange(p.type)}>
          <i style={{ background: pitchColorOnDark(p.type) }} aria-hidden="true" />
          {p.type}<small>{p.velo.toFixed(0)} · {p.n}</small>
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
  const [data, setData] = useState<IndexFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitcherId, setPitcherId] = useState("");
  const [pitcher, setPitcher] = useState<Pitcher | null>(null);
  const [loadingPitcher, setLoadingPitcher] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [lastType, setLastType] = useState("");
  const [nextType, setNextType] = useState("");
  const [lastLoc, setLastLoc] = useState<Loc>({ side: 0, height: 2.0 });
  const [nextLoc, setNextLoc] = useState<Loc>({ side: 0, height: 1.5 });
  const [placing, setPlacing] = useState<0 | 1>(1);   // 0 = anchor, 1 = tunnel pitch
  const [arsenalMode, setArsenalMode] = useState(false);
  const [arsLoc, setArsLoc] = useState<Record<string, Loc>>({});     // arsenal mode: where each pitch is placed (default: its real average)
  const [arsOff, setArsOff] = useState<string[]>([]);                // arsenal mode: pitches unchecked (not drawn)
  const [pair, setPair] = useState<RealPair | null>(null);        // a real back-to-back pair he threw
  const [showActual, setShowActual] = useState(true);              // draw the real pair instead of the aimed averages
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
  const [videoClock, setVideoClock] = useState<number | null>(null);   // flight time driven by the video, when linked
  const onFlightTime = useCallback((t: number | null) => setVideoClock(t), []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/index.json`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`The pitcher list did not load (HTTP ${r.status}).`); return r.json(); })
      .then((d: IndexFile) => {
        setData(d);
        const wvu = d.pitchers.filter((p) => p.team === "WES_MOU");
        const pool = wvu.length ? wvu : d.pitchers;
        const top = [...pool].sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || Number(b.fall ?? 0) - Number(a.fall ?? 0) || b.n - a.n)[0];
        if (top) setPitcherId(top.id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Load one pitcher's pitches when the selection changes.
  useEffect(() => {
    if (!pitcherId) return;
    let cancelled = false;
    setLoadingPitcher(true);
    fetch(`${import.meta.env.BASE_URL}data/pitcher/${encodeURIComponent(pitcherId)}.json`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`This pitcher's data did not load (HTTP ${r.status}).`); return r.json(); })
      .then((p: Pitcher) => { if (!cancelled) { setPitcher(p); setUpPitcher(p); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoadingPitcher(false); });
    return () => { cancelled = true; };
  }, [pitcherId]);

  const rows = useMemo(() => (pitcher ? applyFilters(pitcher.pitches, filters) : []), [pitcher, filters]);
  const arsenal = useMemo(() => buildArsenal(rows), [rows]);

  function setUpPitcher(p: Pitcher) {
    // Default to his most recent season.
    const latest = seasonsOf(p.pitches)[0];
    const f = { ...NO_FILTERS, seasons: latest ? [latest] : [] };
    setFilters(f);
    const ars = buildArsenal(applyFilters(p.pitches, f));
    const fb = primaryFastball(ars);
    setLastType(fb?.type ?? "");
    const second = ars.filter((x) => x.type !== fb?.type)[0] ?? fb;
    setNextType(second?.type ?? "");
    setDelta(NO_DELTA); setSuggestions(null);
  }
  function chooseNextType(t: string) { setNextType(t); setDelta(NO_DELTA); setSuggestions(null); }

  // If a filter removes the selected type, fall back to what's left.
  const last = arsenal.find((p) => p.type === lastType) ?? arsenal[0] ?? null;
  const next = arsenal.find((p) => p.type === nextType) ?? arsenal.find((p) => p.type !== last?.type) ?? arsenal[0] ?? null;
  const shaped = useMemo(() => (next ? perturb(next.coeffs, delta) : null), [next, delta]);

  // In arsenal mode every pitch has its own spot (real average unless moved); the anchor and the active pitch read from there.
  const locOf = (p: ArsenalPitch): Loc => arsLoc[p.type] ?? realLoc(p.coeffs);
  const curLastLoc = arsenalMode && last ? locOf(last) : lastLoc;
  const curNextLoc = arsenalMode && next ? locOf(next) : nextLoc;
  const moveTo = (type: string, loc: Loc) => setArsLoc((m) => ({ ...m, [type]: loc }));
  const place = (loc: Loc) => {
    if (arsenalMode) { const p = placing === 0 ? last : next; if (p) moveTo(p.type, loc); return; }
    if (placing === 0) setLastLoc(loc); else setNextLoc(loc);
  };

  const actual = pair && showActual && pair.anchor.id !== pair.next.id ? pair : null;
  const lastAimed = useMemo(() => (actual ? actual.anchor.coeffs : last ? aimAt(last.coeffs, curLastLoc.side, curLastLoc.height) : null), [actual, pair, last, curLastLoc]);
  const nextAimed = useMemo(() => (actual ? actual.next.coeffs : shaped ? aimAt(shaped, curNextLoc.side, curNextLoc.height) : null), [actual, pair, shaped, curNextLoc]);
  const pairs = useMemo(() => (last && next ? realPairs(rows, last.type, next.type) : []), [rows, last, next]);
  // Drop the pair if the selection or the pitch types no longer include it.
  // Drop the real pair when it no longer fits: a pitch filtered out, or the anchor/tunnel types changed under it.
  useEffect(() => {
    if (!pair) return;
    const inRows = rows.some((r) => r.id === pair.anchor.id) && rows.some((r) => r.id === pair.next.id);
    const sameTypes = !last || !next || (pair.anchor.type === last.type && pair.next.type === next.type);
    if (!inRows || !sameTypes) setPair(null);
  }, [rows, pair, last, next]);
  const cells = useMemo(() => (lastAimed && shaped ? nextPitchCells(lastAimed, shaped) : []), [lastAimed, shaped]);
  const bestTight = useMemo(() => tightest(cells), [cells]);
  const bestFar = useMemo(() => provisionalBest(cells, maxDecision), [cells, maxDecision]);
  const geo = lastAimed && nextAimed ? pairGeometry(lastAimed, nextAimed) : null;
  const curve = useMemo(() => (lastAimed && nextAimed ? separationCurve(lastAimed, nextAimed) : []), [lastAimed, nextAimed]);
  const aim = useMemo(() => {
    const fb = primaryFastball(arsenal);
    if (!showAim || !fb || !nextAimed) return null;
    return aimPoint(nextAimed, fb.coeffs);
  }, [showAim, arsenal, nextAimed]);
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
  // Park the 3D clock at the moment the anchor pitch is `ft` from the plate. The video is left alone:
  // its frames are 33 ms apart (about 4 ft of ball flight), so it can't honestly be put "at 23.8 ft".
  const jumpTo = (ft: number) => {
    if (!lastAimed) return;
    const t = ft <= 0 ? timeAtDist(lastAimed, PLATE_X) : timeAtDist(lastAimed, PLATE_X + ft);
    if (t == null) return;
    scrub(t);
  };
  const ballFt = clock == null ? null : (() => { const p = lastAimed ? posAtTime(lastAimed, clock) : null; return p ? p.dist - PLATE_X : null; })();
  const JUMPS = [50, 40, 30, DECISION_FT, 20, 10, 0];

  const runSuggestions = () => { if (lastAimed && next) setSuggestions(suggestShapes(lastAimed, next.coeffs, "tightThenFar", maxDecision)); };
  const applySuggestion = (s: Suggestion) => { setDelta(s.delta); setNextLoc({ side: s.cell.side, height: s.cell.height }); };

  const sameType = !!last && !!next && last.type === next.type;
  const sceneLast = lastAimed && last ? { coeffs: lastAimed, color: pitchColorOnDark(last.type) } : null;
  const sceneNext = nextAimed && next ? { coeffs: nextAimed, color: pitchColorOnDark(next.type), dashed: sameType } : null;
  // Arsenal mode: every other checked pitch, aimed at its own spot, measured off the anchor.
  const arsenalRows: ArsenalRow[] = useMemo(() => {
    if (!arsenalMode || !last || !lastAimed) return [];
    return arsenal.map((p) => {
      const loc = locOf(p);
      const isAnchor = p.type === last.type;
      const geo = isAnchor ? null : pairGeometry(lastAimed, aimAt(p.coeffs, loc.side, loc.height));
      const real = realLoc(p.coeffs);
      return { pitch: p, on: !arsOff.includes(p.type), isAnchor, isActive: isAnchor ? placing === 0 : p.type === next?.type && placing === 1, loc,
        moved: !!arsLoc[p.type] && (Math.abs(loc.side - real.side) > 1e-6 || Math.abs(loc.height - real.height) > 1e-6),
        decisionSep: geo?.decisionSep ?? null, plateSep: geo?.plateSep ?? null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arsenalMode, arsenal, last, lastAimed, next, arsLoc, arsOff, placing]);
  const extraTracks = useMemo(() => arsenalRows
    .filter((r) => r.on && !r.isAnchor && r.pitch.type !== next?.type)
    .map((r) => ({ coeffs: aimAt(r.pitch.coeffs, r.loc.side, r.loc.height), color: pitchColorOnDark(r.pitch.type), faint: true })), [arsenalRows, next]);
  const optimizeAll = () => {
    if (!lastAimed || !last) return;
    const m: Record<string, Loc> = { ...arsLoc };
    for (const p of arsenal) {
      if (p.type === last.type || arsOff.includes(p.type)) continue;
      const best = tightest(nextPitchCells(lastAimed, p.coeffs));
      if (best) m[p.type] = { side: best.side, height: best.height };
    }
    setArsLoc(m);
  };
  const activate = (type: string) => {
    if (last && type === last.type) { setPlacing(0); return; }
    chooseNextType(type); setPlacing(1);
  };
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
            <PitcherFinder pitchers={data.pitchers} value={pitcherId} onChange={setPitcherId} />
            {loadingPitcher && <p className="hint">Loading pitches…</p>}
          </section>

          <section>
            <div className="sec-title">Pitches in use</div>
            {pitcher && <FilterPanel all={pitcher.pitches} selected={rows.length} filters={filters} onChange={setFilters} />}
            <p className="hint">Every pitch type below is the average of the selected pitches.</p>
          </section>

          <div className="mode-switch" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" aria-checked={!arsenalMode} className={!arsenalMode ? "is-on" : ""} onClick={() => setArsenalMode(false)}>Pair</button>
            <button type="button" role="radio" aria-checked={arsenalMode} className={arsenalMode ? "is-on" : ""} onClick={() => { setArsenalMode(true); setPair(null); }}>Arsenal mode</button>
          </div>

          {arsenalMode && (
            <>
              <ArsenalPanel rows={arsenalRows} canOptimize={!!lastAimed}
                onToggle={(t, on) => setArsOff((o) => (on ? o.filter((x) => x !== t) : [...o, t]))}
                onAnchor={(t) => { setLastType(t); if (next?.type === t) { const other = arsenal.find((p) => p.type !== t); if (other) chooseNextType(other.type); } setPlacing(0); }}
                onActivate={activate} onMove={moveTo}
                onResetOne={(t) => setArsLoc((m) => { const n = { ...m }; delete n[t]; return n; })}
                onOptimizeAll={optimizeAll} onResetAll={() => setArsLoc({})} />
              <section className="pitch-block" style={{ ["--accent" as string]: (placing === 0 ? last : next) ? pitchColorOnDark((placing === 0 ? last : next)!.type) : "#9aa7ba" }}>
                <div className="sec-title">Place {(placing === 0 ? last : next)?.type ?? ""}{placing === 0 ? " (anchor)" : ""}</div>
                <div className="segmented" role="radiogroup" aria-label="Shade the grid by">
                  {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={m === heatMetric} className={m === heatMetric ? "is-on" : ""} onClick={() => setHeatMetric(m)}>
                      {HEAT_METRICS[m].label}
                    </button>
                  ))}
                </div>
                <ZonePicker label="Where every pitch is placed; shaded by how the active pitch tunnels off the anchor" active={arsenalRows.filter((r) => r.on).findIndex((r) => r.isActive)} onSelect={place}
                  best={placing === 1 ? bestTight : null} heat={placing === 1 ? heatProps : undefined}
                  markers={arsenalRows.filter((r) => r.on).map((r) => ({ loc: r.loc, color: pitchColorOnDark(r.pitch.type), name: r.isAnchor ? `anchor ${r.pitch.type}` : r.pitch.type }))} />
                <p className="hint">Green is better for the active pitch. Click a cell to move it there.</p>
              </section>
            </>
          )}

          {!arsenalMode && (<>
          <section className="pitch-block" style={{ ["--accent" as string]: last ? pitchColorOnDark(last.type) : "#9aa7ba" }}>
            <div className="sec-title">Anchor pitch</div>
            <PitchButtons pitches={arsenal} value={last?.type ?? ""} onChange={setLastType} label="Anchor pitch type" />
          </section>

          <section className="pitch-block" style={{ ["--accent" as string]: next ? pitchColorOnDark(next.type) : "#9aa7ba" }}>
            <div className="sec-title">Tunnel pitch</div>
            <PitchButtons pitches={arsenal} value={next?.type ?? ""} onChange={chooseNextType} label="Tunnel pitch type" />
            <div className="segmented" role="radiogroup" aria-label="Shade the grid by">
              {(Object.keys(HEAT_METRICS) as HeatMetric[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={m === heatMetric} className={m === heatMetric ? "is-on" : ""} onClick={() => setHeatMetric(m)}>
                  {HEAT_METRICS[m].label}
                </button>
              ))}
            </div>
            <div className="placing" role="radiogroup" aria-label="Which pitch a click places">
              <button type="button" role="radio" aria-checked={placing === 0} className={placing === 0 ? "is-on" : ""} onClick={() => setPlacing(0)}>
                <i style={{ background: last ? pitchColorOnDark(last.type) : "#9aa7ba" }} />Place anchor
              </button>
              <button type="button" role="radio" aria-checked={placing === 1} className={placing === 1 ? "is-on" : ""} onClick={() => setPlacing(1)}>
                <i style={{ background: next ? pitchColorOnDark(next.type) : "#9aa7ba" }} />Place tunnel pitch
              </button>
            </div>
            <ZonePicker label="Pitch locations, shaded by how the tunnel pitch tunnels" active={placing} onSelect={place} best={bestTight} heat={heatProps}
              markers={[
                { loc: lastLoc, color: last ? pitchColorOnDark(last.type) : "#9aa7ba", name: `anchor ${last?.type ?? ""}` },
                { loc: nextLoc, color: next ? pitchColorOnDark(next.type) : "#9aa7ba", name: `tunnel ${next?.type ?? ""}` },
              ]} />
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
          </>)}

          <BestTunnels rows={rows} types={arsenal.map((p) => p.type)} selected={pair}
            onSelect={(p) => { setPair(p); setShowActual(true); if (arsenalMode) setArsenalMode(false); setLastType(p.anchor.type); chooseNextType(p.next.type); }} />

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
              <Scene3D last={sceneLast} next={sceneNext} extra={extraTracks} aim={aim} aimColor={next ? pitchColorOnDark(next.type) : "#ffffff"} camera={camera}
                heat={heat} selected={placing === 0 ? curLastLoc : curNextLoc} anchorLoc={curLastLoc} anchorColor={last ? pitchColorOnDark(last.type) : "#9aa7ba"} best={bestTight} onPick={place} flightTime={playing || videoClock == null ? clock : videoClock} />
              <div className="hud hud-legend">
                {last && <span><i style={{ background: pitchColorOnDark(last.type) }} />Anchor: {last.type}</span>}
                {next && <span><i style={{ background: pitchColorOnDark(next.type) }} className={sameType ? "dashed" : ""} />Tunnel: {next.type}{shapedPitch && " (modified)"}</span>}
                {arsenalRows.filter((r) => r.on && !r.isAnchor && r.pitch.type !== next?.type).map((r) => (
                  <span key={r.pitch.type}><i style={{ background: pitchColorOnDark(r.pitch.type) }} />{r.pitch.type}</span>
                ))}
                <span><i className="gold" />Decision point, 23.8 ft</span>
                {actual && <span className="legend-note">Real pitches, {actual.next.date}</span>}
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
                {pair && <label className="hud-check"><input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />Show the real pair</label>}
              </div>
              <div className="hud hud-jumps" role="group" aria-label="Jump to a distance from the plate">
                {JUMPS.map((ft) => (
                  <button key={ft} type="button" className={ballFt != null && Math.abs(ballFt - ft) < 0.6 ? "is-on" : ""} onClick={() => jumpTo(ft)} disabled={!lastAimed}
                    title={ft === DECISION_FT ? "Decision point" : ft === 0 ? "Front of the plate" : `${ft} ft from the plate`}>
                    {ft === 0 ? "Plate" : ft === DECISION_FT ? "23.8" : ft}
                  </button>
                ))}
                <span className="jumps-unit">ft out</span>
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
              <VideoOverlay pairs={pairs} rows={rows} selected={pair} onSelect={setPair} anchorType={last?.type ?? ""} nextType={next?.type ?? ""} onFlightTime={onFlightTime} drivesScene={!!actual} />
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
              <MovementPlot pitches={arsenal} rows={rows} lastType={last?.type ?? null} nextType={next?.type ?? null} throws={pitcher?.throws} modified={shapedPitch} />
            </section>
            <section className="card">
              <SeparationChart curve={curve} names={last && next ? [last.type, next.type] : undefined} />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
