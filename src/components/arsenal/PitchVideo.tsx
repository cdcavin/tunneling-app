import { useCallback, useEffect, useRef, useState } from "react";
import { lookupClips, streamUrl, type AwreClip } from "../../lib/pairs";
import { clipT0, releaseFromUtc, useHls } from "../../lib/hlsClip";
import type { PitchRow } from "../../lib/types";
import { pitchColor } from "../../lib/pitchColors";

const CAM_ORDER = [/center ?field/i, /right handed pitcher/i, /left handed pitcher/i, /home ?plate/i, /hitter/i];
const camRank = (n: string) => { const i = CAM_ORDER.findIndex((re) => re.test(n)); return i < 0 ? 99 : i; };
const camShort = (n: string) => (/center ?field/i.test(n) ? "Center field" : /pitcher/i.test(n) ? "Side" : /home ?plate/i.test(n) ? "Behind home" : n);
const SPEEDS = [0.25, 0.5, 1];
const LEAD = 2.0;   // start this many seconds before release

const TAIL = 2.0;   // a pitch counts as "watched" this many seconds after release

/**
 * One pitch's AWRE clip, cued a couple of seconds before release. Used by the popup and by the outing replay.
 * `camPref` is the camera to prefer ("Center field", "Side"…) so a replay keeps the same angle pitch to pitch.
 * `onDone` fires once per pitch when the clip passes release + 2 s (or ends, or has no video).
 */
export function PitchClip({ row, camPref, onCam, speed, onSpeed, onDone }: {
  row: PitchRow; camPref?: string; onCam?: (c: string) => void; speed: number; onSpeed: (s: number) => void; onDone?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [clips, setClips] = useState<AwreClip[] | null>(null);
  const [cam, setCam] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const done = useRef(false);
  const doneCb = useRef(onDone);
  doneCb.current = onDone;
  const finish = useCallback(() => { if (!done.current) { done.current = true; doneCb.current?.(); } }, []);

  useEffect(() => {
    let alive = true;
    done.current = false;
    setClips(null); setErr(null);
    lookupClips(row.id).then((r) => {
      if (!alive) return;
      const cs = r.clips.filter((c) => !/^all$/i.test(c.perspective)).sort((a, b) => camRank(a.perspective) - camRank(b.perspective));
      setClips(cs);
      if (!cs.length) { setErr(r.error ? `No video found (${r.error}).` : "No video for this pitch."); return; }
      setCam((cs.find((c) => camShort(c.perspective) === camPref) ?? cs[0]).perspective);
    }).catch((e: Error) => { if (alive) setErr(`Video lookup failed (${e.message}).`); });
    return () => { alive = false; };
  }, [row.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const clip = clips?.find((c) => c.perspective === cam) ?? null;
  const onError = useCallback((m: string) => setErr(m), []);
  const onStart = useCallback((ms: number | null) => setStart(ms), []);
  useHls(ref, clip ? streamUrl(clip.video_url) : null, onError, onStart);
  const release = releaseFromUtc(row.utc, start);

  const cue = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    v.playbackRate = speed;
    if (release != null) v.currentTime = clipT0(v) + Math.max(0, release - LEAD);
    void v.play().catch(() => undefined);
  }, [release, speed]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.readyState >= 1) cue();
    v.addEventListener("loadedmetadata", cue);
    return () => v.removeEventListener("loadedmetadata", cue);
  }, [cue]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tick = () => { if (release != null && v.currentTime >= clipT0(v) + release + TAIL) finish(); };
    v.addEventListener("timeupdate", tick); v.addEventListener("ended", finish);
    return () => { v.removeEventListener("timeupdate", tick); v.removeEventListener("ended", finish); };
  }, [release, finish, clip]);
  // No video: let a replay move on after a short pause.
  useEffect(() => { if (!err) return; const t = setTimeout(finish, 1500); return () => clearTimeout(t); }, [err, finish]);

  return (
    <div className="pv-clip">
      {clips && clips.length > 0 && (
        <div className="segmented" role="radiogroup" aria-label="Camera">
          {clips.map((c) => (
            <button key={c.perspective} type="button" role="radio" aria-checked={c.perspective === cam} className={c.perspective === cam ? "is-on" : ""}
              onClick={() => { setCam(c.perspective); onCam?.(camShort(c.perspective)); }}>
              {camShort(c.perspective)}
            </button>
          ))}
        </div>
      )}
      <div className="pv-stage">
        {clip && <video ref={ref} className="pv-video" controls playsInline muted />}
        {!clip && !err && <p className="hint">Finding video…</p>}
        {err && <p className="hint">{err}</p>}
      </div>
      {clip && (
        <div className="pv-controls">
          <button type="button" className="secondary" onClick={() => { done.current = false; cue(); }}>Replay from release − 2 s</button>
          <div className="segmented" role="radiogroup" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={s === speed} className={s === speed ? "is-on" : ""} onClick={() => onSpeed(s)}>{s}×</button>
            ))}
          </div>
          {release == null && start != null && <span className="hint">Release time unknown for this clip; playing from the start.</span>}
        </div>
      )}
    </div>
  );
}

/** Popup: one pitch's clip. */
export default function PitchVideo({ row, onClose }: { row: PitchRow; onClose: () => void }) {
  const [speed, setSpeed] = useState(0.5);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="lb-back" role="dialog" aria-modal="true" aria-label="Pitch video" onClick={onClose}>
      <div className="lb pv-card" onClick={(e) => e.stopPropagation()}>
        <div className="lb-head">
          <div>
            <div className="lb-title"><i className="pv-chip" style={{ background: pitchColor(row.type) }} />{row.type} · {row.velo.toFixed(1)} mph</div>
            <div className="hint">
              {row.date} vs {row.opponent}{row.inning != null && ` · ${row.half === "Bottom" ? "B" : "T"}${row.inning}`}{row.count && ` · ${row.count}`}
              {row.batterSide && ` · ${row.batterSide === "Left" ? "LHH" : "RHH"}`} · {row.ivb.toFixed(1)} IVB, {row.hb.toFixed(1)} HB · {row.call}
            </div>
          </div>
          <button type="button" className="ghost lb-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <PitchClip row={row} speed={speed} onSpeed={setSpeed} />
      </div>
    </div>
  );
}
