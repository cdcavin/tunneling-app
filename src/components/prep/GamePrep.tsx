import { useEffect, useMemo, useState } from "react";
import PitcherFinder, { teamLabel } from "../PitcherFinder";
import FilterPanel from "../FilterPanel";
import { applyFilters, type Filters } from "../../lib/filters";
import { arsenalLines, avgCoeffs } from "../../lib/arsenalStats";
import { flyBallFt, flyPitch } from "../../lib/airsim";
import { HOME_KEY, LAB_AIR, PARKS } from "../../lib/parks";
import { STANDARD_AIR } from "../../lib/spin";
import { pitchColor } from "../../lib/pitchColors";
import { compass, type Weather } from "../SpinCard";
import type { IndexFile, Pitcher } from "../../lib/types";

/** Typical game-time air by month at each Big 12 park (pipeline/park_climate.py, served at /data/parks_climate.json). */
interface ClimMonth { tempF: number; rh: number; hPa: number; windMph: number; rho: number }
interface Climate { parks: Record<string, { team: string; elevationM?: number; months: Record<string, ClimMonth> }> }
let climP: Promise<Climate> | null = null;
function useClimate() {
  const [c, setC] = useState<Climate | null>(null);
  useEffect(() => {
    climP ??= fetch("/data/parks_climate.json").then((r) => (r.ok ? r.json() : { parks: {} })).catch(() => ({ parks: {} }));
    let alive = true; climP.then((d) => { if (alive) setC(d); }); return () => { alive = false; };
  }, []);
  return c;
}

/** Eastern-time date + "HH:MM" → ISO UTC, using the real New York offset on that date (handles daylight time). */
function easternToUtc(date: string, time: string): string | null {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  const asNy = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess + (guess - asNy)).toISOString();
}

const PARK_LIST = Object.entries(PARKS).filter(([k]) => k !== "monogaliacounty").sort((a, b) => a[1].name.localeCompare(b[1].name));
const sg = (v: number, d = 1) => (Number.isFinite(v) ? `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}` : "—");
const today = () => new Date().toISOString().slice(0, 10);

interface Props { data: IndexFile; pitcherId: string; onPitcher: (id: string) => void; pitcher: Pitcher | null; loading: boolean; filters: Filters; onFilters: (f: Filters) => void }

export default function GamePrep({ data, pitcherId, onPitcher, pitcher, loading, filters, onFilters }: Props) {
  const [park, setPark] = useState(HOME_KEY);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("18:30");
  const [wx, setWx] = useState<Weather | null>(null);
  const [wxErr, setWxErr] = useState<string | null>(null);
  const clim = useClimate();
  const rows = useMemo(() => (pitcher ? applyFilters(pitcher.pitches, filters) : []), [pitcher, filters]);
  const lines = useMemo(() => arsenalLines(rows), [rows]);
  const month = String(Number(date.slice(5, 7)));

  useEffect(() => {
    const utc = easternToUtc(date, time);
    setWx(null); setWxErr(null);
    if (!utc) return;
    let alive = true;
    fetch(`/api/weather?t=${encodeURIComponent(utc)}&park=${park}`)
      .then(async (r) => { const j = await r.json(); if (!alive) return; if (r.ok) setWx(j as Weather); else setWxErr(j.error ?? `HTTP ${r.status}`); })
      .catch((e: Error) => alive && setWxErr(e.message));
    return () => { alive = false; };
  }, [park, date, time]);

  // Forecast when there is one; otherwise the park's typical air for that month (Big 12 parks only).
  const typical = clim?.parks[park]?.months[month];
  const homeTypical = clim?.parks[HOME_KEY]?.months[month];
  const air = wx?.airDensity ?? typical?.rho ?? null;
  const baseAir = homeTypical?.rho ?? LAB_AIR;
  const baseLabel = homeTypical ? `a typical ${new Date(2026, Number(month) - 1, 1).toLocaleString("en-US", { month: "long" })} game at Kendrick` : "indoors in the lab";

  const effects = useMemo(() => {
    if (air == null) return [];
    return lines.map((l) => {
      const c = avgCoeffs(rows.filter((r) => r.type === l.type));
      if (!c) return { l, e: null };
      const base = flyPitch(c, STANDARD_AIR, baseAir), here = flyPitch(c, STANDARD_AIR, air);
      if (!base || !here) return { l, e: null };
      return { l, e: { velo: here.plateMph - base.plateMph, vert: (here.ivbIn - base.ivbIn) * Math.sign(l.ivb || 1), horz: (here.hbIn - base.hbIn) * Math.sign(l.hb || 1), flight: (here.flightS - base.flightS) * 1000 } };
    });
  }, [lines, rows, air, baseAir]);
  const fly = air != null ? 400 * (flyBallFt(air) / flyBallFt(baseAir) - 1) : null;

  return (
    <div className="layout ars-layout">
      <aside className="panel left" aria-label="Pitcher">
        <section>
          <div className="sec-title">Pitcher</div>
          <PitcherFinder pitchers={data.pitchers} value={pitcherId} onChange={onPitcher} />
          {loading && <p className="hint">Loading pitches…</p>}
          {pitcher && <p className="hint ars-who">{pitcher.throws === "Left" ? "LHP" : "RHP"} · {teamLabel(pitcher.team ?? "")}</p>}
        </section>
        {pitcher && <section className="dfilter-sec"><FilterPanel all={pitcher.pitches} selected={rows.length} filters={filters} onChange={onFilters} /></section>}
        <section>
          <div className="sec-title">Game</div>
          <label className="gp-field"><span>Park</span>
            <select value={park} onChange={(e) => setPark(e.target.value)}>
              {PARK_LIST.map(([k, p]) => <option key={k} value={k}>{p.name} · {p.city}</option>)}
            </select>
          </label>
          <label className="gp-field"><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="gp-field"><span>First pitch (Eastern)</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <p className="hint">Forecasts go about 2 weeks out. Further out, Big 12 parks use their typical weather for that month.</p>
        </section>
      </aside>
      <main className="ars-main gp-main">
        <section className="card gp-wx">
          <div className="sec-title">Weather &amp; park <span className="ars-sub">{PARKS[park]?.name}, {PARKS[park]?.city}{PARKS[park]?.roof && " · retractable roof (assumes open)"}</span></div>
          {wx ? (
            <div className="gp-wx-row">
              <div><b>{Math.round(wx.tempF)}°F</b><span>{wx.desc}</span></div>
              <div><b>{Math.round(wx.rh)}%</b><span>humidity</span></div>
              <div><b>{Math.round(wx.pressureHpa)} hPa</b><span>pressure</span></div>
              <div><b>{Math.round(wx.windMph)} mph {compass(wx.windFromDeg)}</b><span>wind (from)</span></div>
              <div><b>{wx.elevationM != null ? `${Math.round(wx.elevationM * 3.281).toLocaleString()} ft` : "—"}</b><span>elevation</span></div>
              <div><b>{sg((wx.airDensity / baseAir - 1) * 100)}%</b><span>air density vs {baseLabel}</span></div>
            </div>
          ) : typical ? (
            <p className="hint">No forecast for that hour ({wxErr ?? "loading"}). Using {PARKS[park]?.name}'s typical game-time air for this month: {Math.round(typical.tempF)}°F, {Math.round(typical.rh)}% humidity, air {sg((typical.rho / baseAir - 1) * 100)}% vs {baseLabel}.</p>
          ) : <p className="hint">{wxErr ? `No forecast for that hour (${wxErr}), and no typical weather on file for this park.` : "Loading the forecast…"}</p>}
        </section>

        {pitcher && air != null && (
          <section className="card">
            <div className="sec-title">What the air does to his pitches <span className="ars-sub">his average pitch of each type, flown in this air vs {baseLabel}</span></div>
            <div className="ars-table-wrap">
              <table className="ars-table">
                <thead><tr>
                  <th>Pitch</th>
                  <th title="Change in speed when it reaches the plate (thinner air = less drag = more velo)">Plate velo</th>
                  <th title="Change in vertical break, in. + = more of the break this pitch already has (more ride on a fastball, more drop on a curveball)">Vert break</th>
                  <th title="Change in horizontal break, in. + = more of the break this pitch already has">Horz break</th>
                  <th title="Change in time from release to the plate, milliseconds">Flight time</th>
                </tr></thead>
                <tbody>
                  {effects.map(({ l, e }) => (
                    <tr key={l.type}>
                      <th scope="row"><i style={{ background: pitchColor(l.type) }} />{l.type}</th>
                      <td>{e ? `${sg(e.velo)} mph` : "—"}</td>
                      <td>{e ? `${sg(e.vert)}″` : "—"}</td>
                      <td>{e ? `${sg(e.horz)}″` : "—"}</td>
                      <td>{e ? `${sg(e.flight, 0)} ms` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fly != null && <p className="gp-fly">A fly ball that goes 400 ft in {baseLabel} goes about <b>{Math.round(400 + fly)} ft</b> here ({sg(fly, 0)} ft), from the air alone.</p>}
            <p className="hint">Air only: thinner air (heat, humidity, altitude, low pressure) means less drag and less spin-driven break; thicker air the opposite. Spin rate and axis don't change with the weather, only how much movement the spin produces. Wind isn't included in the pitch numbers.</p>
          </section>
        )}
        <section className="card gp-soon"><div className="sec-title">Hitter scouting</div><p className="hint">Opponent hitter cards come next.</p></section>
      </main>
    </div>
  );
}
