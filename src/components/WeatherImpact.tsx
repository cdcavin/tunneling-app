import { useMemo, useState } from "react";
import type { Coeffs } from "../lib/physics";
import type { PitchRow } from "../lib/types";
import { flyBallFt, flyPitch } from "../lib/airsim";
import { HOME_KEY, LAB_AIR, LAB_RH, LAB_TEMP_F, PARKS, parkKey } from "../lib/parks";
import { STANDARD_AIR } from "../lib/spin";
import { pitchColorOnDark } from "../lib/pitchColors";
import { compass, hourOf, useWeather, type Weather } from "./SpinCard";

/**
 * How the air at each of his outings changed his stuff, against the lab (lib/parks.ts: indoors in Morgantown, fixed
 * temperature, humidity and pressure, no wind). Fly ball: against Kendrick Family Ballpark at the same date and hour.
 *   Expected = physics: his own average pitch of each type re-flown in that game's air (lib/airsim.ts).
 *   Measured = what Trackman saw that day minus his average for the type (weather + everything else: fatigue, grip,
 *   how he felt). Both are in "movement" terms: + = more break in the direction the pitch already breaks.
 */
interface Outing { game: string; date: string; park: string; key: string; homeKey: string; utc: string; rows: PitchRow[] }
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const COEF_KEYS = ["Xc0", "Xc1", "Xc2", "Yc0", "Yc1", "Yc2", "Zc0", "Zc1", "Zc2"] as const;
const avgCoeffs = (rs: PitchRow[]): Coeffs | null => {
  const cs = rs.map((r) => r.coeffs).filter((c): c is Coeffs => !!c);
  if (!cs.length) return null;
  return Object.fromEntries(COEF_KEYS.map((k) => [k, mean(cs.map((c) => c[k]))])) as unknown as Coeffs;
};
const sg = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}` : "—");
const MIN_DAY = 3;      // pitches of a type in an outing before we show his measured numbers for it
const MIN_TYPE = 15;    // pitches of a type overall before it gets a tab

export default function WeatherImpact({ rows, focusType }: { rows: PitchRow[]; focusType: string }) {
  const { outings, offFile } = useMemo(() => {
    const g = new Map<string, PitchRow[]>();
    for (const r of rows) { if (!r.game) continue; const l = g.get(r.game) ?? []; l.push(r); g.set(r.game, l); }
    const out: Outing[] = []; let off = 0;
    for (const [game, rs] of g) {
      const pk = parkKey(game); const us = rs.map((r) => r.utc).filter((u): u is string => !!u).sort();
      const utc = us[Math.floor(us.length / 2)]; const h = hourOf(utc);
      if (!pk || !PARKS[pk] || !h) { off++; continue; }
      out.push({ game, date: rs[0].date, park: pk, key: `${pk}|${h}`, homeKey: `${HOME_KEY}|${h}`, utc, rows: rs });
    }
    out.sort((a, b) => a.date.localeCompare(b.date));
    return { outings: out, offFile: off };
  }, [rows]);
  const wx = useWeather(outings.flatMap((o) => [o.key, o.homeKey]));

  const types = useMemo(() => {
    const n = new Map<string, number>();
    rows.forEach((r) => n.set(r.type, (n.get(r.type) ?? 0) + 1));
    return [...n].filter(([, c]) => c >= MIN_TYPE).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [rows]);
  const [type, setType] = useState(types.includes(focusType) ? focusType : types[0] ?? "");
  const [sortBy, setSortBy] = useState<"air" | "date">("air");

  const loaded = outings.filter((o) => wx[o.key]);
  const pending = outings.length - Object.keys(wx).filter((k) => outings.some((o) => o.key === k)).length;

  // His average pitch of each type, and the air it was thrown in on average (for re-flying it).
  const model = useMemo(() => {
    const m: Record<string, { c: Coeffs; rho0: number; ivb: number; hb: number; velo: number; spin: number; n: number }> = {};
    for (const t of types) {
      const rs = rows.filter((r) => r.type === t); const c = avgCoeffs(rs); if (!c) continue;
      const rhos = rs.map((r) => { const o = outings.find((x) => x.game === r.game); return o ? wx[o.key]?.airDensity : undefined; }).filter((x): x is number => x != null);
      m[t] = { c, rho0: rhos.length > rs.length / 2 ? mean(rhos) : STANDARD_AIR, ivb: mean(rs.map((r) => r.ivb)), hb: mean(rs.map((r) => r.hb)),
        velo: mean(rs.map((r) => r.velo)), spin: mean(rs.map((r) => r.spin).filter((x): x is number => x != null)), n: rs.length };
    }
    return m;
  }, [types, rows, outings, wx]);

  const base = useMemo(() => {
    const b: Record<string, ReturnType<typeof flyPitch>> = {};
    for (const [t, m] of Object.entries(model)) b[t] = flyPitch(m.c, m.rho0, LAB_AIR);
    return b;
  }, [model]);

  // Expected change vs the lab for a type in air rho, as movement gained (+ = more break the way it already breaks).
  const expected = (t: string, rho: number) => {
    const m = model[t], b0 = base[t]; if (!m || !b0) return null;
    const p = flyPitch(m.c, m.rho0, rho); if (!p) return null;
    return { vert: (p.ivbIn - b0.ivbIn) * Math.sign(m.ivb || 1), horz: (p.hbIn - b0.hbIn) * Math.sign(m.hb || 1), velo: p.plateMph - b0.plateMph };
  };
  const per1 = useMemo(() => Object.fromEntries(types.map((t) => [t, expected(t, LAB_AIR * 0.99)])), [types, model, base]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Fly ball: a 400-ft fly ball at Kendrick Family Ballpark at that same date and hour, hit in this park's air instead. 0 at home.
  const flyVsHome = (o: Outing, w: Weather) => {
    if (PARKS[o.park] === PARKS[HOME_KEY]) return 0;
    const h = wx[o.homeKey]; if (!h) return NaN;
    return 400 * (flyBallFt(w.airDensity) / flyBallFt(h.airDensity) - 1);
  };
  const tableRows = useMemo(() => {
    const list = loaded.map((o) => {
      const w = wx[o.key] as Weather; const rs = o.rows.filter((r) => r.type === type); const m = model[type];
      const e = expected(type, w.airDensity);
      const meas = m && rs.length >= MIN_DAY ? {
        vert: (mean(rs.map((r) => r.ivb)) - m.ivb) * Math.sign(m.ivb || 1), horz: (mean(rs.map((r) => r.hb)) - m.hb) * Math.sign(m.hb || 1),
        velo: mean(rs.map((r) => r.velo)) - m.velo, spin: mean(rs.map((r) => r.spin).filter((x): x is number => x != null)) - m.spin, n: rs.length,
      } : null;
      return { o, w, air: w.airDensity / LAB_AIR - 1, e, meas, fly: flyVsHome(o, w), n: rs.length };
    });
    return sortBy === "air" ? list.sort((a, b) => b.air - a.air) : list;
  }, [loaded, wx, type, model, sortBy]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Did his measured movement follow the air? Least-squares slope of measured vert/horz on air (% vs the lab).
  const fit = useMemo(() => {
    const pts = tableRows.filter((r) => r.meas).map((r) => ({ x: r.air * 100, v: r.meas!.vert, h: r.meas!.horz, e: r.e }));
    if (pts.length < 5) return { n: pts.length, v: NaN, h: NaN };
    const mx = mean(pts.map((p) => p.x)), sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    if (sxx < 1e-6) return { n: pts.length, v: NaN, h: NaN };
    const sl = (k: "v" | "h") => { const my = mean(pts.map((p) => p[k])); return pts.reduce((s, p) => s + (p.x - mx) * (p[k] - my), 0) / sxx; };
    return { n: pts.length, v: sl("v"), h: sl("h") };
  }, [tableRows]);

  if (!types.length) return <div className="wxi"><p className="hint">Not enough pitches in this selection.</p></div>;
  const p1 = per1[type];
  const best = [...tableRows].sort((a, b) => b.air - a.air);
  const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
  const fmtTime = (u: string) => { const iso = u.trim().replace(" ", "T"); const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z"); return Number.isNaN(ms) ? "" : new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }); };

  return (
    <div className="wxi">
      <div className="wxi-head">
        <div>
          <b>How the air changed his stuff</b>
          <span>Movement and velo vs the lab (indoors in Morgantown: {LAB_TEMP_F}°F, {LAB_RH}% humidity, average pressure, no wind). Fly ball vs Kendrick Family Ballpark at the same date and time. Denser air = more break, a bit more velo lost by the plate, shorter fly balls.</span>
        </div>
        <div className="wxi-sort" role="group" aria-label="Sort outings">
          <button type="button" className={`type-chip${sortBy === "air" ? " is-on" : ""}`} onClick={() => setSortBy("air")}>Densest air first</button>
          <button type="button" className={`type-chip${sortBy === "date" ? " is-on" : ""}`} onClick={() => setSortBy("date")}>By date</button>
        </div>
      </div>

      <div className="wxi-types" role="group" aria-label="Pitch type">
        {types.map((t) => {
          const s = per1[t];
          return (
            <button key={t} type="button" className={`wxi-type${t === type ? " is-on" : ""}`} onClick={() => setType(t)} aria-pressed={t === type}>
              <span><i style={{ background: pitchColorOnDark(t) }} />{t}</span>
              {s && <small>1% thinner air: {sg(s.vert, 2)} vert · {sg(s.horz, 2)} horz in</small>}
            </button>
          );
        })}
      </div>

      {p1 && (
        <p className="wxi-sum">
          His {type.toLowerCase()} loses <b>{Math.abs(p1.vert).toFixed(2)} in</b> of {model[type].ivb >= 0 ? "ride" : "drop"} and <b>{Math.abs(p1.horz).toFixed(2)} in</b> of horizontal break for every 1% thinner air, and gets to the plate <b>{Math.abs(p1.velo).toFixed(2)} mph</b> faster.
          {best.length >= 2 && <> Most break of his outings: the dense air in {PARKS[best[0].o.park].city} ({fmtDate(best[0].o.date)}, {sg(best[0].air * 100)}%) · least: {PARKS[best[best.length - 1].o.park].city} ({fmtDate(best[best.length - 1].o.date)}, {sg(best[best.length - 1].air * 100)}%).</>}
          {fit.n >= 5 && Number.isFinite(fit.v) && <> Measured across {fit.n} outings, his {model[type].ivb >= 0 ? "ride" : "drop"} moved {sg(fit.v, 2)} in per 1% denser air (physics says {sg(-p1.vert, 2)}); the rest of the day-to-day swing is him, not the weather.</>}
          {fit.n < 5 && <> Too few outings with {MIN_DAY}+ of this pitch to check the physics against his own numbers.</>}
        </p>
      )}

      <div className="wxi-scroll">
        <table className="wxi-table">
          <thead>
            <tr><th rowSpan={2}>Date</th><th rowSpan={2}>Park</th><th rowSpan={2}>Conditions</th><th rowSpan={2}>Elev</th><th rowSpan={2}>Air vs<br />lab</th>
              <th colSpan={3} className="grp">Weather did (physics)</th><th colSpan={4} className="grp">Measured vs his average</th><th rowSpan={2} title="A ball that went 400 ft at Kendrick Family Ballpark at that same date and hour: how much farther or shorter it went in this park's air (air only, no wind)">Fly ball vs<br />Kendrick then</th></tr>
            <tr><th>Vert</th><th>Horz</th><th>Plate velo</th><th>Vert</th><th>Horz</th><th>Velo</th><th>Spin</th></tr>
          </thead>
          <tbody>
            {tableRows.map(({ o, w, air, e, meas, fly, n }) => {
              const park = PARKS[o.park];
              return (
                <tr key={o.game}>
                  <td>{fmtDate(o.date)}<small>{fmtTime(o.utc)}</small></td>
                  <td title={park.approx ? `Location: ${park.approx}` : undefined}>{park.city}<small>{park.name}{park.roof ? " · roof" : ""}</small></td>
                  <td>{Math.round(w.tempF)}°F · {Math.round(w.rh)}%<small>{Math.round(w.pressureHpa)} hPa · wind {Math.round(w.windMph)} {compass(w.windFromDeg)}</small></td>
                  <td>{w.elevationM != null ? `${Math.round(w.elevationM * 3.28084).toLocaleString()} ft` : "—"}</td>
                  <td className={air >= 0 ? "pos" : "neg"}>{sg(air * 100)}%</td>
                  <td className="num">{e ? sg(e.vert) : "—"}</td><td className="num">{e ? sg(e.horz) : "—"}</td><td className="num">{e ? sg(e.velo) : "—"}</td>
                  {meas ? <><td className="num">{sg(meas.vert)}</td><td className="num">{sg(meas.horz)}</td><td className="num">{sg(meas.velo)}</td><td className="num">{sg(meas.spin, 0)}</td></>
                    : <td colSpan={4} className="dim">{n ? `${n} thrown` : "none thrown"}</td>}
                  <td className="num">{PARKS[o.park] === PARKS[HOME_KEY] ? <span className="dim">home</span> : Number.isFinite(fly) ? `${sg(fly, 0)} ft` : "…"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint wxi-foot">
        {pending > 0 ? `Loading weather for ${pending} more outing${pending > 1 ? "s" : ""}… ` : ""}
        Break in inches, + = more break the way the pitch already moves. Weather doesn't change spin rate or axis; measured spin is shown so you can see that.
        Wind isn't in the numbers: it needs each park's field direction, which isn't on file.
        {offFile > 0 && ` ${offFile} outing${offFile > 1 ? "s" : ""} at parks not on file left out.`}
      </p>
    </div>
  );
}
