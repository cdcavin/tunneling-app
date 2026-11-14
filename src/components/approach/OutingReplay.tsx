import { useEffect, useMemo, useState } from "react";
import type { PitchRow } from "../../lib/types";
import { pitchAbbr, pitchColor } from "../../lib/pitchColors";
import { ZONE } from "../../lib/grid";
import { callLabel, missInches, targetBox, type Call } from "../../lib/calls";
import { PitchClip } from "../arsenal/PitchVideo";

const order = (a: PitchRow, b: PitchRow) =>
  (a.inning ?? 0) - (b.inning ?? 0) || (a.pa ?? 0) - (b.pa ?? 0) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0);
const abKey = (r: PitchRow) => `${r.inning}|${r.half}|${r.pa}`;
const inn = (r: PitchRow) => `${r.half === "Bottom" ? "B" : "T"}${r.inning ?? "?"}`;

/** Catcher's view: the called box for this pitch, where it went, and the miss between them. Earlier pitches in the at-bat faded. */
function CallZone({ list, i, calls }: { list: PitchRow[]; i: number; calls: Record<string, Call> }) {
  const W = 240, PX = W / 4, H = 4.2 * PX;
  const x = (side: number) => (2 - side) * PX, y = (h: number) => (4.6 - h) * PX;
  const cx = (v: number) => Math.max(6, Math.min(W - 6, v)), cy = (v: number) => Math.max(6, Math.min(H - 6, v));
  const r = list[i];
  const c = r ? calls[r.id] : undefined;
  const box = c ? targetBox(c.loc, r.batterSide) : null;
  const ab = r ? list.filter((p, j) => j < i && abKey(p) === abKey(r)) : [];
  const zx = x(ZONE.halfWidth), zw = x(-ZONE.halfWidth) - zx, zy = y(ZONE.top), zh = y(ZONE.bottom) - zy;
  let near: [number, number] | null = null;
  if (box && r) near = [Math.max(box.x0, Math.min(box.x1, r.side)), Math.max(box.y0, Math.min(box.y1, r.height))];
  return (
    <svg className="or-zone" viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Called spot and where the pitch went, catcher's view">
      <rect className="ars-zone-bg" width={W} height={H} rx={4} />
      {box && <rect className="or-box" x={x(box.x1)} y={y(box.y1)} width={x(box.x0) - x(box.x1)} height={y(box.y0) - y(box.y1)} />}
      <rect className="ars-zone-box" x={zx} y={zy} width={zw} height={zh} />
      {[1, 2].map((k) => <line key={`v${k}`} className="ars-zone-third" x1={zx + (zw * k) / 3} x2={zx + (zw * k) / 3} y1={zy} y2={zy + zh} />)}
      <line className="ars-zone-third" x1={zx} x2={zx + zw} y1={zy + zh / 2} y2={zy + zh / 2} />
      <path className="ars-plate" d={`M${zx},${H + 3} L${zx + zw},${H + 3} L${zx + zw},${H + 7} L${zx + zw / 2},${H + 13} L${zx},${H + 7} Z`} />
      {ab.map((p, k) => <g key={p.id}><circle cx={cx(x(p.side))} cy={cy(y(p.height))} r={7} className="or-prev" /><text className="or-prev-n" x={cx(x(p.side))} y={cy(y(p.height)) + 3.5} textAnchor="middle">{(p.pitchNo ?? k + 1)}</text></g>)}
      {r && near && missInches(r, c)! > 0 && <line className="or-miss" x1={x(near[0])} y1={y(near[1])} x2={cx(x(r.side))} y2={cy(y(r.height))} />}
      {r && <circle cx={cx(x(r.side))} cy={cy(y(r.height))} r={9} fill={pitchColor(r.type)} className="or-cur" />}
    </svg>
  );
}

/** Pick an outing and step through it pitch by pitch: video, called spot vs where it went, and the miss. */
export default function OutingReplay({ rows, calls }: { rows: PitchRow[]; calls: Record<string, Call> }) {
  const games = useMemo(() => {
    const m = new Map<string, { game: string; date: string; opp: string; n: number; charted: number }>();
    for (const r of rows) {
      const g = m.get(r.game) ?? { game: r.game, date: r.date, opp: r.opponent, n: 0, charted: 0 };
      g.n++; if (calls[r.id]) g.charted++;
      m.set(r.game, g);
    }
    return [...m.values()].filter((g) => g.charted > 0).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, calls]);
  const [game, setGame] = useState("");
  useEffect(() => { if (!games.some((g) => g.game === game)) setGame(games[0]?.game ?? ""); }, [games, game]);
  const list = useMemo(() => rows.filter((r) => r.game === game).sort(order), [rows, game]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cam, setCam] = useState("Center field");
  const [speed, setSpeed] = useState(0.5);
  useEffect(() => { setI(0); setPlaying(false); }, [game]);
  const cur = list[i];
  const c = cur ? calls[cur.id] : undefined;
  const miss = cur ? missInches(cur, c) : null;
  const next = () => setI((k) => { if (k + 1 >= list.length) { setPlaying(false); return k; } return k + 1; });
  // A clip reports when it's been watched; while playing, that moves on (also if Play is pressed after it finished).
  const [doneId, setDoneId] = useState<string | null>(null);
  useEffect(() => { if (playing && cur && doneId === cur.id) next(); }, [playing, doneId, cur?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!games.length) return null;
  return (
    <div className="card or">
      <div className="or-head">
        <div className="sec-title">Watch an outing back</div>
        <select className="or-pick" value={game} onChange={(e) => setGame(e.target.value)} aria-label="Outing">
          {games.map((g) => <option key={g.game} value={g.game}>{g.date} vs {g.opp} · {g.n} pitches · {g.charted} charted</option>)}
        </select>
        <div className="or-ctl">
          <button type="button" className="secondary" onClick={() => { setPlaying(false); setI((k) => Math.max(0, k - 1)); }} disabled={i === 0} aria-label="Previous pitch">◀</button>
          <button type="button" className="or-play" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play outing"}</button>
          <button type="button" className="secondary" onClick={() => { setPlaying(false); next(); }} disabled={i >= list.length - 1} aria-label="Next pitch">▶</button>
          <span className="hint">{list.length ? `${i + 1} / ${list.length}` : ""}</span>
        </div>
      </div>
      {cur && (
        <div className="or-body">
          <div className="or-left">
            <CallZone list={list} i={i} calls={calls} />
            <div className="or-facts">
              <div><span>Pitch</span><b><i style={{ background: pitchColor(cur.type) }} />{cur.type} · {cur.velo.toFixed(1)}</b></div>
              <div><span>{inn(cur)} · count</span><b>{cur.count ?? "—"} {cur.batterSide && `· ${cur.batterSide === "Left" ? "LHH" : "RHH"}`}</b></div>
              <div><span>Called</span><b>{c ? callLabel(c) : "not charted"}</b></div>
              <div><span>Missed by</span><b className={miss === 0 ? "or-hit" : ""}>{miss == null ? "—" : miss === 0 ? "Hit the spot" : `${miss.toFixed(1)}″`}</b></div>
              <div><span>Result</span><b>{cur.call}{cur.result && cur.result !== "Undefined" ? ` · ${cur.result}` : ""}</b></div>
            </div>
          </div>
          <div className="or-video">
            <PitchClip key={cur.id} row={cur} camPref={cam} onCam={setCam} speed={speed} onSpeed={setSpeed} onDone={() => setDoneId(cur.id)} />
          </div>
          <ol className="or-list">
            {list.map((r, j) => {
              const cc = calls[r.id], m = missInches(r, cc);
              const first = j === 0 || abKey(list[j - 1]) !== abKey(r);
              return (
                <li key={r.id} className={`${j === i ? "is-on" : ""}${first ? " ab-first" : ""}`}>
                  {first && <div className="or-ab">{inn(r)} · at-bat {r.pa ?? "?"} · {r.batterSide === "Left" ? "LHH" : r.batterSide === "Right" ? "RHH" : ""}</div>}
                  <button type="button" onClick={() => { setPlaying(false); setI(j); }}>
                    <span className="or-cnt">{r.count ?? ""}</span>
                    <span className="or-pt"><i style={{ background: pitchColor(r.type) }} />{pitchAbbr(r.type)}</span>
                    <span className="or-called">{cc ? callLabel(cc) : "—"}</span>
                    <span className={`or-m${m === 0 ? " or-hit" : ""}`}>{m == null ? "" : m === 0 ? "hit" : `${m.toFixed(0)}″`}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
