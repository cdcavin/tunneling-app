import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PitchRow } from "../lib/types";
import type { RealPair } from "../lib/pairs";
import { pitchColorOnDark } from "../lib/pitchColors";
import { outings } from "../lib/filters";
import { IN_ZONES, OUT_ZONES, zoneOf, type Zone } from "../lib/zones";
import { ZONE } from "../lib/grid";

interface Props {
  rows: PitchRow[];                 // the selected pitches (after filters)
  pairs: RealPair[];                // quick list of real back-to-back pairs of the chosen types
  selected: RealPair | null;
  onSelect: (p: RealPair | null) => void;
  isHome?: (r: PitchRow) => boolean;  // pitches at WVU's park (the only ones AWRE can have video for)
  throws?: string;                  // "Right" | "Left", for arm/glove side on the movement plot
}

/** AWRE facts per pitch: has video (and center field), runners on first/second/third. null = no AWRE record. */
interface Meta { video: boolean; cf: boolean; on1: boolean; on2: boolean; on3: boolean; outs: number | null }
const metaCache = new Map<string, Meta | null>();
async function loadMeta(ids: string[], onProgress: (done: number) => void) {
  const todo = ids.filter((id) => !metaCache.has(id));
  let done = ids.length - todo.length; onProgress(done);
  const chunks: string[][] = []; for (let i = 0; i < todo.length; i += 15) chunks.push(todo.slice(i, i + 15));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      try {
        const r = await fetch(`/api/awre/meta?ids=${c.map(encodeURIComponent).join(",")}`);
        const j = (await r.json()) as Record<string, Meta | null>;
        for (const id of c) metaCache.set(id, j[id] ?? null);
      } catch { for (const id of c) metaCache.set(id, null); }
      done += c.length; onProgress(done);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}
type Runners = "any" | "on" | "risp";

const abKey = (r: PitchRow) => `${r.game}|${r.inning}|${r.half}|${r.pa}`;
const abLabel = (r: PitchRow) => `${r.half === "Bottom" ? "B" : "T"}${r.inning} · PA ${r.pa}${r.batter ? ` · ${r.batter}` : ""}`;
const short = (r: PitchRow) => `${r.date} ${r.half === "Bottom" ? "B" : "T"}${r.inning ?? "?"} #${r.pitchNo ?? "?"} ${r.type} ${r.velo.toFixed(0)}`;

// Mini zone map geometry, catcher's view: screen x = -side (third-base side on the left), screen y = 5 - height.
const ZX = ZONE.halfWidth, OX = 1.5, Y = (h: number) => 5 - h;
const ZT = Y(ZONE.top), ZB = Y(ZONE.bottom), MID = Y((ZONE.top + ZONE.bottom) / 2), OT = Y(4.4), OB = Y(0.6);
const CW = (2 * ZX) / 3, RH = (ZB - ZT) / 3;
const OUTER: Record<number, string> = {
  11: `${-OX},${OT} 0,${OT} 0,${ZT} ${-ZX},${ZT} ${-ZX},${MID} ${-OX},${MID}`,
  12: `${OX},${OT} 0,${OT} 0,${ZT} ${ZX},${ZT} ${ZX},${MID} ${OX},${MID}`,
  13: `${-OX},${MID} ${-ZX},${MID} ${-ZX},${ZB} 0,${ZB} 0,${OB} ${-OX},${OB}`,
  14: `${OX},${MID} ${ZX},${MID} ${ZX},${ZB} 0,${ZB} 0,${OB} ${OX},${OB}`,
};
const OUTER_LABEL: Record<number, [number, number]> = { 11: [-1.17, 1.05], 12: [1.17, 1.05], 13: [-1.17, 3.95], 14: [1.17, 3.95] };
const ZONE_NAME: Record<number, string> = {
  1: "up, third-base side", 2: "up, middle", 3: "up, first-base side", 4: "middle, third-base side", 5: "heart",
  6: "middle, first-base side", 7: "down, third-base side", 8: "down, middle", 9: "down, first-base side",
  11: "out of zone, up / third-base side", 12: "out of zone, up / first-base side", 13: "out of zone, down / third-base side", 14: "out of zone, down / first-base side",
};
/** What happened on the pitch, from Trackman's PitchCall (and PlayResult for balls in play). */
const OUTCOMES = ["Ball", "Called strike", "Whiff", "Foul", "In play: out", "In play: hit", "In play: other", "HBP"] as const;
type Outcome = (typeof OUTCOMES)[number] | "Other";
export function outcomeOf(r: PitchRow): Outcome {
  const c = r.call;
  if (c === "BallCalled" || c === "BallinDirt" || c === "BallIntentional") return "Ball";
  if (c === "StrikeCalled") return "Called strike";
  if (c === "StrikeSwinging") return "Whiff";
  if (c.startsWith("FoulBall")) return "Foul";
  if (c === "HitByPitch") return "HBP";
  if (c === "InPlay") return r.result === "Out" ? "In play: out" : r.result && ["Single", "Double", "Triple", "HomeRun"].includes(r.result) ? "In play: hit" : "In play: other";
  return "Other";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Clickable 13-zone map; each zone shows how many pitches in the current filter landed there. A and B are dotted on it. */
function ZoneMap({ counts, on, toggle, a, b }: { counts: Map<Zone, number>; on: Set<Zone>; toggle: (z: Zone) => void; a: PitchRow | null; b: PitchRow | null }) {
  const max = Math.max(1, ...counts.values());
  const shade = (z: Zone) => (on.has(z) ? "var(--steel-soft)" : `rgba(180, 193, 214, ${(0.04 + 0.26 * ((counts.get(z) ?? 0) / max)).toFixed(3)})`);
  const cell = (z: Zone, shape: ReactNode, lx: number, ly: number) => (
    <g key={z} className={`zm-zone${on.has(z) ? " is-on" : ""}`} role="button" tabIndex={0} aria-pressed={on.has(z)}
      aria-label={`Zone ${z}, ${ZONE_NAME[z]}: ${counts.get(z) ?? 0} pitch${counts.get(z) === 1 ? "" : "es"}`} onClick={() => toggle(z)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(z); } }}>
      <title>{`Zone ${z}: ${ZONE_NAME[z]}`}</title>
      {shape}
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central">{counts.get(z) ?? 0}</text>
    </g>
  );
  const dot = (r: PitchRow | null, color: string) => r && <circle cx={clamp(-r.side, -OX + 0.08, OX - 0.08)} cy={clamp(Y(r.height), OT + 0.08, OB - 0.08)} r={0.09} fill={color} stroke="#0b1526" strokeWidth={0.03} pointerEvents="none" />;
  return (
    <svg className="zone-map" viewBox={`${-OX} ${OT} ${2 * OX} ${OB - OT}`} aria-label="Location filter, catcher's view">
      {OUT_ZONES.map((z) => cell(z, <polygon points={OUTER[z]} fill={shade(z)} />, ...OUTER_LABEL[z]))}
      {IN_ZONES.map((z) => {
        const i = z - 1, x = -ZX + (i % 3) * CW, y = ZT + Math.floor(i / 3) * RH;
        return cell(z, <rect x={x} y={y} width={CW} height={RH} fill={shade(z)} />, x + CW / 2, y + RH / 2);
      })}
      <rect x={-ZX} y={ZT} width={2 * ZX} height={ZB - ZT} fill="none" className="zm-outline" pointerEvents="none" />
      {dot(a, "var(--wvu-gold)")}{dot(b, "var(--steel)")}
    </svg>
  );
}

/** Movement box in inches: horizontal (HB) and vertical (IVB) break ranges. */
interface MoveBox { h0: number; h1: number; v0: number; v1: number }
const MV = 25;
const rnd = (v: number) => String(Math.round(v) || 0);   // no "-0"   // plot spans ±25 in on both axes
/** Mini movement plot (pitcher's view, like the main one). Drag a box to keep only pitches inside it; click to clear. */
function MovePlot({ rows, allowed, box, setBox, a, b, throws }: { rows: PitchRow[]; allowed: Set<string> | null; box: MoveBox | null; setBox: (b: MoveBox | null) => void; a: PitchRow | null; b: PitchRow | null; throws?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(null);
  const pt = (e: React.PointerEvent) => {
    const svg = ref.current!; const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: clamp(p.x, -MV, MV), y: clamp(-p.y, -MV, MV) };   // svg y down = −IVB
  };
  const live = drag ? { h0: Math.min(drag.x, drag.x2), h1: Math.max(drag.x, drag.x2), v0: Math.min(drag.y, drag.y2), v1: Math.max(drag.y, drag.y2) } : box;
  const inBox = (r: PitchRow) => !live || (r.hb >= live.h0 && r.hb <= live.h1 && r.ivb >= live.v0 && r.ivb <= live.v1);
  const armRight = throws !== "Left";
  const dot = (r: PitchRow | null, color: string) => r && <circle cx={clamp(r.hb, -MV + 1, MV - 1)} cy={clamp(-r.ivb, -MV + 1, MV - 1)} r={1.6} fill={color} stroke="#0b1526" strokeWidth={0.5} pointerEvents="none" />;
  return (
    <div className="mv-wrap">
      <svg ref={ref} className="mv-plot" viewBox={`${-MV} ${-MV} ${2 * MV} ${2 * MV}`} aria-label="Movement filter: drag a box around the break you want"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); const p = pt(e); setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y }); }}
        onPointerMove={(e) => { if (drag) { const p = pt(e); setDrag({ ...drag, x2: p.x, y2: p.y }); } }}
        onPointerUp={() => { if (!drag) return; const d = drag; setDrag(null); setBox(Math.abs(d.x2 - d.x) < 1 && Math.abs(d.y2 - d.y) < 1 ? null : { h0: Math.min(d.x, d.x2), h1: Math.max(d.x, d.x2), v0: Math.min(d.y, d.y2), v1: Math.max(d.y, d.y2) }); }}>
        {[6, 12, 18, 24].map((r) => <circle key={r} cx={0} cy={0} r={r} className="mv-ring" />)}
        <line x1={-MV} x2={MV} y1={0} y2={0} className="mv-axis" /><line y1={-MV} y2={MV} x1={0} x2={0} className="mv-axis" />
        {rows.filter((r) => allowed && !allowed.has(r.id)).map((r) => <circle key={r.id} cx={clamp(r.hb, -MV + 0.6, MV - 0.6)} cy={clamp(-r.ivb, -MV + 0.6, MV - 0.6)} r={0.7} className="mv-off" pointerEvents="none" />)}
        {rows.filter((r) => !allowed || allowed.has(r.id)).map((r) => <circle key={r.id} cx={clamp(r.hb, -MV + 0.6, MV - 0.6)} cy={clamp(-r.ivb, -MV + 0.6, MV - 0.6)} r={0.75} fill={pitchColorOnDark(r.type)} opacity={inBox(r) ? 0.85 : 0.15} pointerEvents="none" />)}
        {live && <rect x={live.h0} y={-live.v1} width={live.h1 - live.h0} height={live.v1 - live.v0} className="mv-box" pointerEvents="none" />}
        {dot(a, "var(--wvu-gold)")}{dot(b, "var(--steel)")}
      </svg>
      <div className="zm-axis" aria-hidden="true"><span>{armRight ? "Glove" : "Arm"}</span><span>{armRight ? "Arm" : "Glove"}</span></div>
      <div className="mv-range">{box ? `${rnd(box.v0)} to ${rnd(box.v1)} in vert · ${rnd(box.h0)} to ${rnd(box.h1)} in horz` : "Drag a box to filter · click to clear"}</div>
    </div>
  );
}

/** Pick any two pitches to overlay: by pitch type, location zone, outing, inning, at-bat (batter when known), or a text search. */
export default function PitchPicker({ rows, pairs, selected, onSelect, isHome = () => true, throws }: Props) {
  const [mvBox, setMvBox] = useState<MoveBox | null>(null);
  const [game, setGame] = useState("");
  const [inning, setInning] = useState("");
  const [ab, setAb] = useState("");
  const [query, setQuery] = useState("");
  const [slot, setSlot] = useState<"A" | "B">("A");
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [zones, setZones] = useState<Set<Zone>>(new Set());
  const [outs, setOuts] = useState<Set<Outcome>>(new Set());
  /** Picking A clears every filter so the search for B starts fresh. */
  const [videoOnly, setVideoOnly] = useState(false);
  const [runners, setRunners] = useState<Runners>("any");
  const [metaN, setMetaN] = useState(0);            // bumps as AWRE answers arrive
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const needMeta = videoOnly || runners !== "any";
  const homeIds = useMemo(() => rows.filter(isHome).map((r) => r.id), [rows, isHome]);
  useEffect(() => {
    if (!open || !needMeta || !homeIds.length) return;
    let alive = true;
    const total = homeIds.length;
    loadMeta(homeIds, (done) => { if (alive) { setProgress(done < total ? { done, total } : null); setMetaN((n) => n + 1); } });
    return () => { alive = false; };
  }, [open, needMeta, homeIds]);
  // After picking A everything resets except "Has video", so B is still a pitch with video.
  const resetFilters = () => { setTypes(new Set()); setOuts(new Set()); setZones(new Set()); setGame(""); setInning(""); setAb(""); setQuery(""); setRunners("any"); setMvBox(null); };
  const flip = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  const games = useMemo(() => outings(rows), [rows]);
  const inGame = useMemo(() => (game ? rows.filter((r) => r.game === game) : rows), [rows, game]);
  const innings = useMemo(() => [...new Set(inGame.map((r) => r.inning).filter((x): x is number => x != null))].sort((a, b) => a - b), [inGame]);
  const inInning = useMemo(() => (inning ? inGame.filter((r) => String(r.inning) === inning) : inGame), [inGame, inning]);
  const abs = useMemo(() => {
    const m = new Map<string, PitchRow>();
    for (const r of inInning) if (r.pa != null && !m.has(abKey(r))) m.set(abKey(r), r);
    return [...m.entries()].sort((a, b) => (a[1].inning ?? 0) - (b[1].inning ?? 0) || (a[1].pa ?? 0) - (b[1].pa ?? 0));
  }, [inInning]);
  const q = query.trim().toLowerCase();
  // Outing, inning, at-bat and text search first; then type counts come from that, and zone counts from that plus the type choice.
  const base = useMemo(() => {
    let l = ab ? inInning.filter((r) => abKey(r) === ab) : inInning;
    if (q) l = l.filter((r) => `${r.date} ${r.opponent} ${r.inning} ${r.half} ${r.pa} ${r.pitchNo} ${r.type} ${r.velo.toFixed(0)} ${r.call} ${r.batter ?? ""} ${r.count ?? ""}`.toLowerCase().includes(q));
    if (videoOnly) l = l.filter((r) => metaCache.get(r.id)?.video === true);
    if (runners !== "any") l = l.filter((r) => {
      const m = metaCache.get(r.id); if (!m) return false;
      const on = m.on1 || m.on2 || m.on3;
      return runners === "on" ? on : m.on2 || m.on3;
    });
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inInning, ab, q, videoOnly, runners, metaN]);
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of base) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);
  const ofType = useMemo(() => (types.size ? base.filter((r) => types.has(r.type)) : base), [base, types]);
  const outCounts = useMemo(() => {
    const m = new Map<Outcome, number>();
    for (const r of ofType) { const o = outcomeOf(r); m.set(o, (m.get(o) ?? 0) + 1); }
    return OUTCOMES.filter((o) => m.get(o)).map((o) => [o, m.get(o)!] as const);
  }, [ofType]);
  const ofOut = useMemo(() => (outs.size ? ofType.filter((r) => outs.has(outcomeOf(r))) : ofType), [ofType, outs]);
  // The two plots are linked: zone counts only count pitches inside the movement box, and the movement plot greys out
  // pitches outside the chosen zones (they can't be picked there).
  const inBox = (r: PitchRow) => !mvBox || (r.hb >= mvBox.h0 && r.hb <= mvBox.h1 && r.ivb >= mvBox.v0 && r.ivb <= mvBox.v1);
  const zoneCounts = useMemo(() => {
    const m = new Map<Zone, number>();
    for (const r of ofOut) { if (!inBox(r)) continue; const z = zoneOf(r.side, r.height); m.set(z, (m.get(z) ?? 0) + 1); }
    return m;
  }, [ofOut, mvBox]);   // eslint-disable-line react-hooks/exhaustive-deps
  const inZones = useMemo(() => (zones.size ? ofOut.filter((r) => zones.has(zoneOf(r.side, r.height))) : ofOut), [ofOut, zones]);
  const matched = useMemo(() => (mvBox ? inZones.filter(inBox) : inZones), [inZones, mvBox]);   // eslint-disable-line react-hooks/exhaustive-deps
  const zoneIds = useMemo(() => new Set(inZones.map((r) => r.id)), [inZones]);
  const list = useMemo(() => {
    const l = matched;
    return [...l].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.inning ?? 0) - (b.inning ?? 0) || (a.pa ?? 0) - (b.pa ?? 0) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0)).slice(0, 80);
  }, [matched]);

  const A = selected?.anchor ?? null, B = selected?.next ?? null;
  const isPlaceholder = !!selected && selected.anchor.id === selected.next.id;

  return (
    <div className="picker">
      <div className="picker-slots">
        {([["A", A], ["B", B]] as const).map(([k, r]) => (
          <button key={k} type="button" className={`slot${slot === k ? " is-next" : ""}`} onClick={() => setSlot(k)} title={`Next pick fills ${k}`}>
            <b>{k}</b>
            {r && !(k === "B" && isPlaceholder) ? <><i style={{ background: pitchColorOnDark(r.type) }} />{short(r)}</> : <span className="muted">pick a pitch</span>}
          </button>
        ))}
        {selected && <button type="button" className="ghost" onClick={() => onSelect(null)}>Clear</button>}
        <button type="button" className={`ghost dd${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Done ▴" : "Find pitches ▾"}</button>
      </div>
      {open && (
        <div className="picker-pop" role="dialog" aria-label="Find pitches">
          <div className="picker-filters">
            <select aria-label="Outing" value={game} onChange={(e) => { setGame(e.target.value); setInning(""); setAb(""); }}>
              <option value="">All outings</option>
              {games.map((g) => <option key={g.game} value={g.game}>{g.date} vs {g.opponent} ({g.n})</option>)}
            </select>
            <select aria-label="Inning" value={inning} onChange={(e) => { setInning(e.target.value); setAb(""); }}>
              <option value="">Any inning</option>
              {innings.map((i) => <option key={i} value={String(i)}>Inning {i}</option>)}
            </select>
            <select aria-label="At-bat" value={ab} onChange={(e) => setAb(e.target.value)}>
              <option value="">Any at-bat</option>
              {abs.map(([k, r]) => <option key={k} value={k}>{abLabel(r)}</option>)}
            </select>
            <input type="search" placeholder="Search: batter, pitch, call, count…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search pitches" />
          </div>
          <div className="picker-types" role="group" aria-label="Video and runners">
            <button type="button" className={`type-chip${videoOnly ? " is-on" : ""}`} aria-pressed={videoOnly} onClick={() => setVideoOnly((v) => !v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>Has video
            </button>
            <span className="chip-sep" aria-hidden="true" />
            {(([["any", "Any runners"], ["on", "Runners on"], ["risp", "Runner in scoring position"]]) as [Runners, string][]).map(([k, label]) => (
              <button key={k} type="button" className={`type-chip${runners === k ? " is-on" : ""}`} aria-pressed={runners === k} onClick={() => setRunners(k)}>{label}</button>
            ))}
            {progress && <span className="meta-progress">Checking AWRE… {progress.done}/{progress.total}</span>}
          </div>
          <div className="picker-types" role="group" aria-label="Pitch type">
            {typeCounts.map(([t, n]) => (
              <button key={t} type="button" className={`type-chip${types.has(t) ? " is-on" : ""}`} aria-pressed={types.has(t)} onClick={() => setTypes((s) => flip(s, t))}>
                <i style={{ background: pitchColorOnDark(t) }} />{t} <span>{n}</span>
              </button>
            ))}
          </div>
          <div className="picker-types" role="group" aria-label="Outcome">
            {outCounts.map(([o, n]) => (
              <button key={o} type="button" className={`type-chip out${outs.has(o) ? " is-on" : ""}`} aria-pressed={outs.has(o)} onClick={() => setOuts((s) => flip(s, o))}>
                {o} <span>{n}</span>
              </button>
            ))}
            {(types.size > 0 || zones.size > 0 || outs.size > 0 || videoOnly || runners !== "any" || mvBox) && <button type="button" className="type-chip clear" onClick={() => { setTypes(new Set()); setZones(new Set()); setOuts(new Set()); setVideoOnly(false); setRunners("any"); setMvBox(null); }}>Clear filters</button>}
          </div>
          <div className="picker-body">
          <div className="picker-zone">
            <div className="picker-plots">
              <div className="pp-col">
                <div className="pp-title">Movement</div>
                <MovePlot rows={ofOut} allowed={zones.size ? zoneIds : null} box={mvBox} setBox={setMvBox} a={A} b={isPlaceholder ? null : B} throws={throws} />
              </div>
              <div className="pp-col">
                <div className="pp-title">Location</div>
                <ZoneMap counts={zoneCounts} on={zones} toggle={(z) => setZones((s) => flip(s, z))} a={A} b={isPlaceholder ? null : B} />
                <div className="zm-axis" aria-hidden="true"><span>3B</span><span>catcher</span><span>1B</span></div>
                <div className="zm-quick">
                  <button type="button" onClick={() => setZones(new Set(IN_ZONES))}>In zone</button>
                  <button type="button" onClick={() => setZones(new Set(OUT_ZONES))}>Out</button>
                </div>
              </div>
            </div>
            <p className="zm-count">{matched.length.toLocaleString()} pitch{matched.length === 1 ? "" : "es"}</p>
          </div>
          <div className="picker-list" role="list">
            {list.map((r) => (
              <div key={r.id} role="listitem" className={`pick-row${A?.id === r.id ? " is-a" : ""}${B?.id === r.id && !isPlaceholder ? " is-b" : ""}`}>
                <span className="pick-main">
                  <span className="pick-what">{metaCache.get(r.id)?.video && <svg className="pick-cam" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-label="has video"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>}<i style={{ background: pitchColorOnDark(r.type) }} />{r.type} <b>{r.velo.toFixed(1)}</b><span className="pick-out">{outcomeOf(r) === "In play: hit" ? r.result : outcomeOf(r) === "Other" ? r.call : outcomeOf(r)}{r.ev != null ? ` · ${r.ev.toFixed(0)} EV` : ""}</span></span>
                  <span className="pick-when">{`${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}`} · {r.half === "Bottom" ? "B" : "T"}{r.inning ?? "?"} · PA {r.pa ?? "?"} · #{r.pitchNo ?? "?"}{r.count ? ` · ${r.count}` : ""}{r.batter ? ` · ${r.batter}` : ""}</span>
                </span>
                <span className="pick-btns">
                  <button type="button" onClick={() => { onSelect(B && !isPlaceholder ? { anchor: r, next: B } : { anchor: r, next: r }); setSlot("B"); resetFilters(); }} aria-label={`Use as A: ${short(r)}`}>A</button>
                  <button type="button" onClick={() => { onSelect(A ? { anchor: A, next: r } : { anchor: r, next: r }); if (A) setOpen(false); }} aria-label={`Use as B: ${short(r)}`}>B</button>
                </span>
              </div>
            ))}
            {list.length === 0 && <p className="hint">No pitches match.</p>}
            {list.length === 80 && <p className="hint">Showing the first 80. Narrow it down.</p>}
          </div>
          </div>
          {pairs.length > 0 && (
            <select aria-label="Quick: real back-to-back pairs" value="" onChange={(e) => { const p = pairs.find((x) => `${x.anchor.id}|${x.next.id}` === e.target.value); if (p) { onSelect(p); setOpen(false); } }}>
              <option value="">Quick pick: back-to-back {pairs[0].anchor.type} → {pairs[0].next.type} ({pairs.length})</option>
              {pairs.map((p) => (
                <option key={`${p.anchor.id}|${p.next.id}`} value={`${p.anchor.id}|${p.next.id}`}>
                  {p.next.date} vs {p.next.opponent}, inn {p.next.inning}: {p.anchor.velo.toFixed(0)} {p.anchor.type} → {p.next.velo.toFixed(0)} {p.next.type} ({p.next.call})
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
