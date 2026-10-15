import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { guessRelease, lookupClips, type AwreClip, type RealPair } from "../lib/pairs";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  pairs: RealPair[];
  selected: RealPair | null;
  onSelect: (p: RealPair | null) => void;
  anchorType: string;
  nextType: string;
  /** Called with seconds since release while linked to the 3D view, or null when unlinked. */
  onFlightTime: (t: number | null) => void;
}

/** Attach an HLS stream to a video element (native on Safari, hls.js elsewhere). */
function useHls(ref: React.RefObject<HTMLVideoElement | null>, url: string | null, onError: (msg: string) => void) {
  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = url; return () => { v.removeAttribute("src"); v.load(); }; }
    if (!Hls.isSupported()) { onError("This browser can't play HLS video."); return; }
    const hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, (_e, d) => {
      const code = (d.response as { code?: number } | undefined)?.code;
      if (d.fatal) onError(`Video failed to load (${d.type}: ${d.details}${code ? `, HTTP ${code}` : ""}).`);
      else if (d.details === "manifestLoadError" || d.details === "fragLoadError") onError(`Video server refused a piece of the clip (${d.details}${code ? `, HTTP ${code}` : ""}).`);
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    return () => hls.destroy();
  }, [ref, url, onError]);
}

/** Where a clip's timeline starts. Clips cut from a continuous recording don't start at 0. */
const t0 = (v: HTMLVideoElement) => (v.seekable.length ? v.seekable.start(0) : 0);
/** Seconds into the clip, from its own start. */
const tIn = (v: HTMLVideoElement) => v.currentTime - t0(v);

const pick = (clips: AwreClip[], want: string) =>
  clips.find((c) => c.perspective === want) ?? clips.find((c) => /home ?plate|center ?field/i.test(c.perspective)) ?? clips[0] ?? null;

const VIDEO_SPEEDS = [0.1, 0.25, 0.5, 1];

export default function VideoOverlay({ pairs, selected, onSelect, anchorType, nextType, onFlightTime }: Props) {
  const [clipsA, setClipsA] = useState<AwreClip[]>([]);
  const [clipsB, setClipsB] = useState<AwreClip[]>([]);
  const [pitchA, setPitchA] = useState<Record<string, unknown> | undefined>();
  const [linked, setLinked] = useState(true);
  const [release, setRelease] = useState<number | null>(null);   // seconds into clip A where the ball leaves the hand
  const [rate, setRate] = useState(1);
  const [perspective, setPerspective] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [offsetMs, setOffsetMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const vA = useRef<HTMLVideoElement>(null), vB = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!selected) { setClipsA([]); setClipsB([]); setStatus(null); return; }
    let cancelled = false;
    setStatus("Looking up video…");
    setRelease(null);
    Promise.all([lookupClips(selected.anchor.id), lookupClips(selected.next.id)]).then(([a, b]) => {
      if (cancelled) return;
      setClipsA(a.clips); setClipsB(b.clips); setPitchA(a.pitch);
      const err = a.error ?? b.error;
      setStatus(err ?? (a.clips.length && b.clips.length ? null : "AWRE has no clip for one of these pitches."));
      const names = a.clips.map((c) => c.perspective).filter((p) => b.clips.some((c) => c.perspective === p));
      setPerspective((cur) => (names.includes(cur) ? cur : names[0] ?? ""));
    });
    return () => { cancelled = true; };
  }, [selected]);

  const clipA = pick(clipsA, perspective);
  const urlA = clipA?.video_url ?? null;
  const urlB = pick(clipsB, perspective)?.video_url ?? null;
  // Default release mark from AWRE's timestamps, until the user marks it by hand.
  useEffect(() => { if (release == null) { const g = guessRelease(clipA, pitchA); if (g != null) setRelease(g); } }, [clipA, pitchA, release]);
  // Playback rate on both players.
  useEffect(() => { for (const v of [vA.current, vB.current]) if (v) v.playbackRate = rate; }, [rate, urlA, urlB]);
  // Drive the 3D flight clock from the anchor clip while linked.
  useEffect(() => {
    const a = vA.current;
    if (!linked || !a || release == null || !urlA) { onFlightTime(null); return; }
    let raf = 0;
    const tick = () => { onFlightTime(Math.max(0, tIn(a) - release)); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); onFlightTime(null); };
  }, [linked, release, urlA, onFlightTime]);
  // Stable handler: the players are only rebuilt when a clip URL changes, not on every render.
  const onError = useCallback((m: string) => setStatus(m), []);
  useHls(vA, urlA, onError);
  useHls(vB, urlB, onError);
  // When both clips end, show the play button again.
  useEffect(() => {
    const a = vA.current; if (!a) return;
    const done = () => setPlaying(false);
    a.addEventListener("ended", done); a.addEventListener("pause", done);
    return () => { a.removeEventListener("ended", done); a.removeEventListener("pause", done); };
  }, [urlA]);

  // Keep B offset from A by offsetMs, and play/pause both together.
  const sync = () => {
    const a = vA.current, b = vB.current; if (!a || !b) return;
    const want = t0(b) + Math.max(0, tIn(a) + offsetMs / 1000);
    if (Math.abs(b.currentTime - want) > 0.02) b.currentTime = want;   // only seek when actually out of step
  };
  const toggle = () => {
    const a = vA.current, b = vB.current; if (!a || !b) return;
    if (playing) { a.pause(); b.pause(); setPlaying(false); return; }
    sync();
    Promise.all([a.play(), b.play()]).then(() => setPlaying(true)).catch((e: Error) => setStatus(`Play was blocked: ${e.name}: ${e.message}`));
  };
  const restart = () => { const a = vA.current, b = vB.current; if (!a || !b) return; a.currentTime = t0(a) + (release != null ? Math.max(0, release - 0.5) : 0); sync(); };
  const markRelease = () => { const a = vA.current; if (a) setRelease(tIn(a)); };
  const step = (ms: number) => { const a = vA.current; if (!a) return; a.pause(); vB.current?.pause(); setPlaying(false); a.currentTime = Math.max(0, a.currentTime + ms / 1000); sync(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(sync, [offsetMs]);

  const perspectives = clipsA.map((c) => c.perspective).filter((p) => clipsB.some((c) => c.perspective === p));

  return (
    <div className="overlay">
      <div className="overlay-head">
        <div className="sec-title">Video overlay</div>
        <select aria-label="Real pair to watch" value={selected ? `${selected.anchor.id}|${selected.next.id}` : ""}
          onChange={(e) => onSelect(pairs.find((p) => `${p.anchor.id}|${p.next.id}` === e.target.value) ?? null)}>
          <option value="">{pairs.length ? `Pick a real ${anchorType} → ${nextType} pair (${pairs.length})` : `No ${anchorType} → ${nextType} pairs in the selected pitches`}</option>
          {pairs.map((p) => (
            <option key={`${p.anchor.id}|${p.next.id}`} value={`${p.anchor.id}|${p.next.id}`}>
              {p.next.date} vs {p.next.opponent}, inn {p.next.inning}: {p.anchor.velo.toFixed(0)} {anchorType} → {p.next.velo.toFixed(0)} {nextType} ({p.next.call})
            </option>
          ))}
        </select>
      </div>

      <div className="overlay-stage">
        {selected && urlA && urlB ? (
          <>
            <video ref={vA} muted playsInline preload="auto" />
            <video ref={vB} muted playsInline preload="auto" style={{ opacity }} />
            <div className="overlay-tags">
              <span><i style={{ background: pitchColorOnDark(anchorType) }} />{anchorType}</span>
              <span><i style={{ background: pitchColorOnDark(nextType) }} />{nextType}</span>
            </div>
          </>
        ) : (
          <div className="video-empty"><p>{status ?? (selected ? "Loading…" : "Pick a real pair to stack the two clips.")}</p></div>
        )}
      </div>

      {selected && urlA && urlB && (
        <div className="overlay-controls">
          <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play both"}>{playing ? "❚❚" : "▶"}</button>
          <button type="button" className="ghost" onClick={restart}>Restart</button>
          <button type="button" className="ghost" onClick={() => step(-33)} aria-label="Back one frame">−1f</button>
          <button type="button" className="ghost" onClick={() => step(33)} aria-label="Forward one frame">+1f</button>
          <label className="mini"><span>Blend</span><input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Blend between the two clips" /></label>
          <label className="mini"><span>Offset {offsetMs >= 0 ? "+" : ""}{offsetMs} ms</span><input type="range" min={-1500} max={1500} step={10} value={offsetMs} onChange={(e) => setOffsetMs(Number(e.target.value))} aria-label="Time offset of the second clip" /></label>
          <select className="speed" aria-label="Video speed" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {VIDEO_SPEEDS.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
          {perspectives.length > 1 && (
            <select aria-label="Camera" value={perspective} onChange={(e) => setPerspective(e.target.value)}>
              {perspectives.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <span className="hud-sep" />
          <button type="button" className="ghost" onClick={markRelease} title="Scrub to the frame the ball leaves the hand, then click">Mark release</button>
          <label className="hud-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Link to 3D</label>
          <span className="hint">{release == null ? "Mark release to link the 3D flight to the clip." : `Release at ${release.toFixed(2)} s`}</span>
          {status && <span className="hint">{status}</span>}
          <a className="hint" href={urlA} target="_blank" rel="noreferrer">Open anchor clip in a new tab</a>
        </div>
      )}
    </div>
  );
}
