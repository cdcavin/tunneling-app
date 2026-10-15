import type { ArsenalPitch } from "../lib/types";
import type { Loc } from "../lib/grid";
import { pitchColorOnDark } from "../lib/pitchColors";
import { tunnelGrade } from "../lib/arsenal";

export interface ArsenalRow {
  pitch: ArsenalPitch;
  on: boolean;            // drawn in the 3D
  isAnchor: boolean;
  isActive: boolean;      // the one the zone click / sliders move, and the movement plot highlights
  loc: Loc;
  moved: boolean;         // away from its real average location
  decisionSep: number | null;   // inches from the anchor at 23.8 ft (null for the anchor itself)
  plateSep: number | null;
}

interface Props {
  rows: ArsenalRow[];
  onToggle: (type: string, on: boolean) => void;
  onAnchor: (type: string) => void;
  onActivate: (type: string) => void;
  onMove: (type: string, loc: Loc) => void;
  onResetOne: (type: string) => void;
  onOptimizeAll: () => void;
  onResetAll: () => void;
  canOptimize: boolean;
}

export default function ArsenalPanel({ rows, onToggle, onAnchor, onActivate, onMove, onResetOne, onOptimizeAll, onResetAll, canOptimize }: Props) {
  return (
    <section className="arsenal">
      <div className="sec-title arsenal-head">
        <span>Arsenal</span>
        <span className="arsenal-actions">
          <button type="button" className="primary" onClick={onOptimizeAll} disabled={!canOptimize} title="Move every other pitch to where it tunnels tightest off the anchor">Optimize tunnels</button>
          <button type="button" className="secondary" onClick={onResetAll} title="Put every pitch back at its real average location">Reset</button>
        </span>
      </div>
      {rows.map(({ pitch, on, isAnchor, isActive, loc, moved, decisionSep, plateSep }) => {
        const color = pitchColorOnDark(pitch.type);
        const g = tunnelGrade(decisionSep);
        return (
          <div key={pitch.type} className={`arsenal-row${isAnchor ? " is-anchor" : ""}${isActive ? " is-active" : ""}${on ? "" : " is-off"}`} style={{ ["--accent" as string]: color }}>
            <div className="arsenal-row-hdr" onClick={() => onActivate(pitch.type)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(pitch.type); } }}
              aria-label={`${pitch.type}: show its movement and place it`}>
              <input type="checkbox" checked={on} onClick={(e) => e.stopPropagation()} onChange={(e) => onToggle(pitch.type, e.target.checked)} aria-label={`Draw ${pitch.type}`} />
              <i className="arsenal-dot" style={{ background: color }} />
              <span className="arsenal-name">{pitch.type} <small>{pitch.velo.toFixed(0)} · {pitch.n}</small></span>
              <button type="button" className={`anchor-tag${isAnchor ? " is-anchor" : ""}`} onClick={(e) => { e.stopPropagation(); onAnchor(pitch.type); }}
                title={isAnchor ? "This is the anchor" : "Make this the anchor"}>{isAnchor ? "Anchor" : "Set anchor"}</button>
            </div>
            <div className="arsenal-sliders">
              <label className="arsl"><span>H</span>
                <input type="range" min={0.5} max={5} step={0.05} value={loc.height} onChange={(e) => onMove(pitch.type, { ...loc, height: Number(e.target.value) })} aria-label={`${pitch.type} height, feet`} />
                <b>{loc.height.toFixed(2)}</b></label>
              <label className="arsl"><span>S</span>
                <input type="range" min={-2} max={2} step={0.05} value={loc.side} onChange={(e) => onMove(pitch.type, { ...loc, side: Number(e.target.value) })} aria-label={`${pitch.type} side, feet (plus is toward third)`} />
                <b>{loc.side.toFixed(2)}</b></label>
              <div className="arsl-foot">
                <button type="button" className="link" onClick={() => onResetOne(pitch.type)} disabled={!moved}>reset</button>
                {isAnchor ? <span className="gold-note">target location</span>
                  : g && decisionSep != null ? <span className={`grade ${g.cls}`} title={`${plateSep?.toFixed(0) ?? "—"} in apart at the plate`}>{decisionSep.toFixed(1)} in · {g.label}</span>
                  : <span />}
              </div>
            </div>
          </div>
        );
      })}
      <p className="hint">Click a pitch to make it the one the zone and sliders move. Every pitch starts at its real average location.</p>
    </section>
  );
}
