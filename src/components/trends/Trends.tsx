import { useMemo, useState } from "react";
import PitcherFinder, { teamLabel } from "../PitcherFinder";
import FilterPanel from "../FilterPanel";
import { applyFilters, type Filters } from "../../lib/filters";
import { arsenalLines, releaseOf } from "../../lib/arsenalStats";
import { tally } from "../../lib/sequencing";
import { atWvuPark } from "../../lib/pairs";
import { pitchColor } from "../../lib/pitchColors";
import { makeAxis, outings, PIN_KINDS, pinColor, pinLabel, usePins, workEvents } from "../../lib/trends";
import type { Pens, Source } from "../../lib/pens";
import WorkloadChart from "./WorkloadChart";
import type { IndexFile, Pitcher, PitchRow } from "../../lib/types";
import TrendChart, { type Series } from "./TrendChart";
import { PitchClip } from "../arsenal/PitchVideo";

interface Props { data: IndexFile; pitcherId: string; onPitcher: (id: string) => void; pitcher: Pitcher | null; loading: boolean; filters: Filters; onFilters: (f: Filters) => void; pens: Pens; source: Source }

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
/** His normal range for a series: mean ± 1 SD across outings (needs 4+ outings). */
function band(vals: (number | null)[]): [number, number] | null {
  const v = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 4) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
  return [m - sd, m + sd];
}
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const sg = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const today = () => new Date().toISOString().slice(0, 10);

export default function Trends({ data, pitcherId, onPitcher, pitcher, loading, filters, onFilters, pens, source }: Props) {
  const gameRows = useMemo(() => (pitcher ? applyFilters(pitcher.pitches, filters) : []), [pitcher, filters]);
  const penRows = useMemo(() => applyFilters(pens.pitches, filters), [pens, filters]);
  const rows = useMemo(() => (source === "games" ? gameRows : source === "pens" ? penRows : [...gameRows, ...penRows]), [source, gameRows, penRows]);
  const outs = useMemo(() => outings(rows), [rows]);
  const gameOuts = useMemo(() => outings(gameRows), [gameRows]);
  const events = useMemo(() => {
    const ids = new Set(penRows.map((r) => r.game));
    return workEvents(gameRows, pens.sessions.filter((s) => ids.has(s.id)));
  }, [gameRows, penRows, pens]);
  const types = useMemo(() => arsenalLines(rows).map((l) => l.type), [rows]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const shown = types.filter((t) => !hidden.has(t));
  const { pins, err, save, remove } = usePins(pitcherId);
  const [selPin, setSelPin] = useState<string | null>(null);
  const [form, setForm] = useState({ date: today(), kind: "grip", pitch: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const byType = (key: "velo" | "ivb" | "hb" | "spin" | "relH" | "relS" | "ext"): Series[] => shown.map((t) => {
    const values = outs.map((o) => { const x = o.byType[t]; return x && x.n >= 3 && x[key] != null ? (x[key] as number) : null; });
    return { name: t, color: pitchColor(t), values, band: band(values) };
  });
  const one = (name: string, color: string, values: (number | null)[], withBand = true): Series[] => [{ name, color, values, band: withBand ? band(values) : null }];
  const axis = useMemo(() => makeAxis([...outs, ...gameOuts].map((o) => o.date).concat(events.map((e) => e.date))), [outs, gameOuts, events]);
  const common = { outs, axis, pins, selPin, onPin: (id: string) => setSelPin((p) => (p === id ? null : id)) };

  const addPin = async () => {
    setBusy(true); setMsg(null);
    try { await save({ date: form.date, kind: form.kind, pitch: form.pitch || undefined, note: form.note.trim() || undefined }); setForm({ ...form, note: "" }); setMsg("Pin added."); }
    catch (e) { setMsg(`Couldn't save the pin (${(e as Error).message}).`); }
    setBusy(false);
  };
  const pin = pins.find((p) => p.id === selPin) ?? null;

  return (
    <div className="layout ars-layout">
      <aside className="panel left" aria-label="Pitcher">
        <section>
          <div className="sec-title">Pitcher</div>
          <PitcherFinder pitchers={data.pitchers} value={pitcherId} onChange={(id) => { setSelPin(null); onPitcher(id); }} />
          {loading && <p className="hint">Loading pitches…</p>}
          {pitcher && <p className="hint ars-who">{pitcher.throws === "Left" ? "LHP" : "RHP"} · {teamLabel(pitcher.team ?? "")} · {outs.length} outings</p>}
        </section>
        {pitcher && <section className="dfilter-sec"><FilterPanel all={pitcher.pitches} selected={rows.length} filters={filters} onChange={onFilters} /></section>}
        {pitcher && (
          <section>
            <div className="sec-title">Add a change pin</div>
            <label className="gp-field"><span>Date it started</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="gp-field"><span>What changed</span>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{PIN_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </label>
            <label className="gp-field"><span>Pitch (optional)</span>
              <select value={form.pitch} onChange={(e) => setForm({ ...form, pitch: e.target.value })}><option value="">All pitches</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            </label>
            <label className="gp-field"><span>Note (optional)</span><input type="text" maxLength={200} value={form.note} placeholder="e.g. spiked curveball grip" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <button type="button" className="or-play" disabled={busy} onClick={addPin}>{busy ? "Saving…" : "Add pin"}</button>
            {msg && <p className="hint">{msg}</p>}
          </section>
        )}
        {pitcher && (
          <section>
            <div className="sec-title">Pins</div>
            {err && <p className="hint">{err}</p>}
            {!pins.length && !err && <p className="hint">None yet. Pins show on every chart; click one to compare before vs after.</p>}
            <ul className="tr-pins">
              {pins.map((p) => (
                <li key={p.id} className={selPin === p.id ? "is-on" : ""}>
                  <button type="button" className="tr-pin-main" onClick={() => setSelPin(selPin === p.id ? null : p.id)}>
                    <i style={{ background: pinColor(p.kind) }} /><b>{pinLabel(p.kind)}</b> · {p.date}{p.pitch && ` · ${p.pitch}`}{p.note && <small>{p.note}</small>}
                  </button>
                  <button type="button" className="ghost tr-pin-x" aria-label="Delete pin" onClick={() => { if (selPin === p.id) setSelPin(null); remove(p.id).catch((e: Error) => setMsg(`Couldn't delete (${e.message}).`)); }}>✕</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
      <main className="ars-main tr-main">
        {!pitcher && <p className="hint ars-empty">{loading ? "Loading…" : "Pick a pitcher."}</p>}
        {pitcher && outs.length < 2 && <p className="hint ars-empty">Trends need at least 2 {source === "pens" ? "bullpens" : "outings"} in these filters.</p>}
        {pitcher && outs.length >= 2 && (
          <>
            {pin && <BeforeAfter rows={gameRows} pin={pin} types={types} team={pitcher.team} onClose={() => setSelPin(null)} />}
            <div className="tr-types">
              {types.map((t) => (
                <button key={t} type="button" className={hidden.has(t) ? "is-off" : ""} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })}>
                  <i style={{ background: pitchColor(t) }} />{t}
                </button>
              ))}
              <span className="hint">Shaded band = his normal range (average ± 1 SD across these outings). Outings with under 3 of a pitch are left out of its line.{source === "both" && " Hollow points = bullpens."}</span>
            </div>
            <section className="card tr-sec"><div className="sec-title">Stuff by pitch</div>
              <div className="tr-grid">
                <TrendChart title="Velo" unit="mph" series={byType("velo")} {...common} />
                <TrendChart title="Spin" unit="rpm" series={byType("spin")} fmt={(v) => v.toFixed(0)} {...common} />
                <TrendChart title="IVB" unit="in" series={byType("ivb")} {...common} />
                <TrendChart title="HB" unit="in" series={byType("hb")} {...common} />
              </div>
            </section>
            <section className="card tr-sec"><div className="sec-title">Release</div>
              <div className="tr-grid tr-grid-3">
                <TrendChart title="Release height" unit="ft" series={byType("relH")} fmt={(v) => v.toFixed(2)} {...common} />
                <TrendChart title="Release side" unit="ft (+ = 3B side)" series={byType("relS")} fmt={(v) => v.toFixed(2)} {...common} />
                <TrendChart title="Extension" unit="ft" series={byType("ext")} fmt={(v) => v.toFixed(2)} {...common} />
              </div>
            </section>
            <section className="card tr-sec"><div className="sec-title">Workload <span className="ars-sub">games and bullpens, whatever the games/pens toggle says</span></div>
              <WorkloadChart events={events} axis={axis} />
              <div className="tr-grid tr-roll">
                <TrendChart title="Rolling pitch totals" unit="(games + pens, at each game)" series={(() => {
                  const roll = (d: string, n: number) => events.filter((e) => { const k = (Date.parse(d) - Date.parse(e.date)) / 86400000; return k >= 0 && k < n; }).reduce((a, e) => a + e.n, 0);
                  return [{ name: "Last 7 days", color: "#eaaa00", values: gameOuts.map((o) => roll(o.date, 7)) }, { name: "Last 28 days", color: "#ef8a5a", values: gameOuts.map((o) => roll(o.date, 28)) }];
                })()} fmt={(v) => v.toFixed(0)} zero legend outs={gameOuts} axis={axis} pins={pins} selPin={selPin} onPin={common.onPin} />
              </div>
            </section>
            <section className="card tr-sec"><div className="sec-title">Results <span className="ars-sub">games only</span></div>
              <div className="tr-grid">
                <TrendChart title="Strike %" series={one("Strike %", "#66bb6a", gameOuts.map((o) => o.strike))} fmt={pct} {...common} outs={gameOuts} />
                <TrendChart title="Whiff %" series={one("Whiff %", "#ef5350", gameOuts.map((o) => o.whiff))} fmt={pct} {...common} outs={gameOuts} />
                <TrendChart title="Chase %" series={one("Chase %", "#ab47bc", gameOuts.map((o) => o.chase))} fmt={pct} {...common} outs={gameOuts} />
                <TrendChart title="Hard-hit %" unit="(95+ mph, balls in play)" series={one("Hard-hit %", "#ffa726", gameOuts.map((o) => o.hard))} fmt={pct} {...common} outs={gameOuts} />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/** Click a pin: his numbers before vs after it for each pitch, and the same pitch on video from each side of it. */
function BeforeAfter({ rows, pin, types, team, onClose }: { rows: PitchRow[]; pin: { id: string; date: string; kind: string; pitch?: string; note?: string }; types: string[]; team?: string; onClose: () => void }) {
  const before = rows.filter((r) => r.date < pin.date), after = rows.filter((r) => r.date >= pin.date);
  const list = pin.pitch ? [pin.pitch] : types;
  const stats = (rs: PitchRow[]) => {
    const rel = rs.map(releaseOf), t = tally(rs);
    return { n: rs.length, velo: avg(rs.map((r) => r.velo)), ivb: avg(rs.map((r) => r.ivb)), hb: avg(rs.map((r) => r.hb)), spin: avg(rs.filter((r) => r.spin != null).map((r) => r.spin!)),
      relH: avg(rel.map((x) => x.height)), ext: avg(rel.map((x) => x.extension)), whiff: t.swings ? t.whiffs / t.swings : null };
  };
  const COLS: [string, string, (v: number) => string, number][] = [["velo", "Velo", (v) => v.toFixed(1), 1], ["ivb", "IVB", (v) => v.toFixed(1), 1], ["hb", "HB", (v) => v.toFixed(1), 1], ["spin", "Spin", (v) => v.toFixed(0), 0], ["relH", "Rel ht", (v) => v.toFixed(2), 2], ["ext", "Ext", (v) => v.toFixed(2), 2], ["whiff", "Whiff%", (v) => `${(v * 100).toFixed(0)}%`, 0]];
  const [vt, setVt] = useState(list[0] ?? "");
  const [cam, setCam] = useState("Center field");
  const [speed, setSpeed] = useState(0.5);
  const hasVid = (r: PitchRow) => !!r.utc && atWvuPark(r, team);
  const vb = [...before].reverse().find((r) => r.type === vt && hasVid(r)), va = after.find((r) => r.type === vt && hasVid(r));
  return (
    <section className="card tr-ba" style={{ borderTop: `3px solid ${pinColor(pin.kind)}` }}>
      <div className="tr-ba-head">
        <div className="sec-title">{pinLabel(pin.kind)} · {pin.date}{pin.pitch && ` · ${pin.pitch}`}<span className="ars-sub">{pin.note}</span></div>
        <span className="hint">{before.length} pitches before · {after.length} on/after (in these filters)</span>
        <button type="button" className="ghost zd-clear" onClick={onClose}>Close</button>
      </div>
      <div className="ars-table-wrap">
        <table className="ars-table tr-ba-table">
          <thead><tr><th>Pitch</th><th>n before → after</th>{COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
          <tbody>
            {list.map((t) => {
              const b = stats(before.filter((r) => r.type === t)), a = stats(after.filter((r) => r.type === t));
              return (
                <tr key={t}>
                  <th scope="row"><i style={{ background: pitchColor(t) }} />{t}</th>
                  <td>{b.n} → {a.n}</td>
                  {COLS.map(([k, , f, d]) => {
                    const x = b[k as keyof typeof b] as number | null, y = a[k as keyof typeof a] as number | null;
                    return <td key={k}>{x == null || y == null ? "—" : <>{f(y)} <small className="tr-d">{k === "whiff" ? `${sg((y - x) * 100, 0)}` : sg(y - x, d)}</small></>}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Each cell = after, with the change from before in small type.</p>
      <div className="tr-ba-vid-head">
        <div className="sec-title">Same pitch, before vs after</div>
        <div className="segmented" role="radiogroup" aria-label="Pitch">
          {list.map((t) => <button key={t} type="button" role="radio" aria-checked={vt === t} className={vt === t ? "is-on" : ""} onClick={() => setVt(t)}>{t}</button>)}
        </div>
      </div>
      <div className="tr-ba-vids">
        <div><div className="hint">Last before{vb && `: ${vb.date} vs ${vb.opponent}`}</div>{vb ? <PitchClip key={vb.id} row={vb} camPref={cam} onCam={setCam} speed={speed} onSpeed={setSpeed} /> : <p className="hint">No {vt} with video before this pin (video is home games only).</p>}</div>
        <div><div className="hint">First after{va && `: ${va.date} vs ${va.opponent}`}</div>{va ? <PitchClip key={va.id} row={va} camPref={cam} onCam={setCam} speed={speed} onSpeed={setSpeed} /> : <p className="hint">No {vt} with video after this pin yet.</p>}</div>
      </div>
    </section>
  );
}
