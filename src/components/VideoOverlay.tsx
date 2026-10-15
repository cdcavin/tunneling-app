import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { lookupClips, streamUrl, type AwreClip, type RealPair } from "../lib/pairs";
import PitchPicker from "./PitchPicker";
import type { PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";

interface Props {
  pairs: RealPair[];
  rows: PitchRow[];
  selected: RealPair | null;
  onSelect: (p: RealPair | null) => void;
  anchorType: string;
  nextType: string;
  /** Called with seconds since release while linked to the 3D view, or null when unlinked. */
  onFlightTime: (t: number | null) => void;
  /** Whether the 3D view is showing this real pair (so the video may drive its clock). */
  drivesScene: boolean;
}

// Safari plays HLS natively; every other browser answers "maybe" to canPlayType and then can't, so go by the browser.
const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const VIDEO_SPEEDS = [0.1, 0.25, 0.5, 1];
/** How much of the clip the scrubber covers around release (seconds before, seconds after). */

/**
 * Attach an HLS stream to a video element (native on Safari, hls.js elsewhere) and report
 * the wall-clock time (ms since epoch) of media time 0, from the stream's PROGRAM-DATE-TIME tags.
 */
/**
 * Wall-clock time (ms since epoch) of a clip's media time 0, read from the first
 * EXT-X-PROGRAM-DATE-TIME tag of its variant playlist. Browser-independent: Safari's
 * getStartDate() is often an Invalid Date, hls.js only knows it after a level loads.
 */
async function playlistStart(url: string): Promise<number | null> {
  const text = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
  let body = await text(url);
  // Master playlist: follow the first variant.
  if (/#EXT-X-STREAM-INF/.test(body)) {
    const lines = body.split(/\r?\n/);
    const i = lines.findIndex((l) => l.startsWith("#EXT-X-STREAM-INF"));
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
    if (!uri) return null;
    body = await text(new URL(uri, window.location.href).toString());
  }
  const m = body.match(/#EXT-X-PROGRAM-DATE-TIME:(\S+)/);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : t;
}

function useHls(ref: React.RefObject<HTMLVideoElement | null>, url: string | null, onError: (msg: string) => void, onStart: (ms: number | null) => void) {
  useEffect(() => {
    const v = ref.current;
    onStart(null);
    if (!v || !url) return;
    let alive = true;
    playlistStart(url).then((ms) => { if (alive && ms != null) onStart(ms); })
      .catch((e: Error) => { if (alive) onError(`Could not read the clip's clock (${e.message}).`); });
    if (IS_SAFARI) {
      v.src = url;
      return () => { alive = false; v.removeAttribute("src"); v.load(); };
    }
    if (!Hls.isSupported()) { onError("This browser can't play HLS video."); return; }
    const hls = new Hls({ enableWorker: true });
    hls.on(Hls.Events.ERROR, (_e, d) => {
      const code = (d.response as { code?: number } | undefined)?.code;
      if (d.fatal) onError(`Video failed to load (${d.type}: ${d.details}${code ? `, HTTP ${code}` : ""}).`);
      else if (d.details === "manifestLoadError" || d.details === "fragLoadError") onError(`Video server refused a piece of the clip (${d.details}${code ? `, HTTP ${code}` : ""}).`);
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    return () => { alive = false; hls.destroy(); };
  }, [ref, url, onError, onStart]);
}

const pick = (clips: AwreClip[], want: string) =>
  clips.find((c) => c.perspective === want) ?? clips.find((c) => /home ?plate|center ?field/i.test(c.perspective)) ?? clips[0] ?? null;

/** Where a clip's timeline starts. Clips cut from a continuous recording don't start at 0. */
const t0 = (v: HTMLVideoElement) => (v.seekable.length ? v.seekable.start(0) : 0);
/** Seconds into the clip, from its own start. */
const tIn = (v: HTMLVideoElement) => v.currentTime - t0(v);

/**
 * Trackman stamps UTCDateTime about 0.8 s after the ball leaves the hand (checked frame by frame
 * against AWRE's clock on the center-field and home-plate cameras). Release = UTCDateTime − this.
 */
const TRACKMAN_UTC_LAG = 0.8;

/** Release inside a clip, seconds from its start: Trackman's UTC release time against the stream's wall clock. */
function releaseFromUtc(utc: string | undefined, startMs: number | null): number | null {
  if (!utc || startMs == null) return null;
  // Trackman writes "2026-03-01 17:23:21.781043" (UTC, no zone marker). Normalise to ISO so it is never read as local time.
  const iso = utc.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  if (Number.isNaN(t)) return null;
  const s = (t - startMs) / 1000 - TRACKMAN_UTC_LAG;
  return s >= 0 && s <= 120 ? s : null;
}

export default function VideoOverlay({ pairs, rows, selected, onSelect, anchorType, nextType, onFlightTime, drivesScene }: Props) {
  const [clipsA, setClipsA] = useState<AwreClip[]>([]);
  const [clipsB, setClipsB] = useState<AwreClip[]>([]);
  const [linked, setLinked] = useState(true);
  const [rate, setRate] = useState(0.25);
  const [perspective, setPerspective] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [nudgeMs, setNudgeMs] = useState(0);                   // fine adjustment of B relative to A
  const [playing, setPlaying] = useState(false);
  const [startA, setStartA] = useState<number | null>(null);   // wall clock of media time 0, clip A
  const [startB, setStartB] = useState<number | null>(null);
  const [manualA, setManualA] = useState<number | null>(null); // hand-marked release, seconds into clip A
  const [manualB, setManualB] = useState<number | null>(null);
  const [pos, setPos] = useState(0);                           // A's time relative to its release
  const [posA, setPosA] = useState(0);                         // seconds into clip A / clip B
  const [posB, setPosB] = useState(0);
  const [durA, setDurA] = useState(10);
  const [durB, setDurB] = useState(10);
  const [locked, setLocked] = useState(true);                  // B follows A
  const vA = useRef<HTMLVideoElement>(null), vB = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!selected || selected.anchor.id === selected.next.id) { setClipsA([]); setClipsB([]); setStatus(selected ? "Now pick pitch B." : null); return; }
    let cancelled = false;
    setStatus("Looking up video…");
    setManualA(null); setManualB(null); setNudgeMs(0);
    Promise.all([lookupClips(selected.anchor.id), lookupClips(selected.next.id)]).then(([a, b]) => {
      if (cancelled) return;
      setClipsA(a.clips); setClipsB(b.clips);
      const err = a.error ?? b.error;
      setStatus(err ?? (a.clips.length && b.clips.length ? null : "AWRE has no clip for one of these pitches."));
      const names = a.clips.map((c) => c.perspective).filter((p) => b.clips.some((c) => c.perspective === p));
      setPerspective((cur) => (names.includes(cur) ? cur : names.find((n) => /center ?field/i.test(n)) ?? names.find((n) => /home ?plate/i.test(n)) ?? names[0] ?? ""));
    });
    return () => { cancelled = true; };
  }, [selected]);

  const clipA = pick(clipsA, perspective), clipB = pick(clipsB, perspective);
  const urlA = clipA ? streamUrl(clipA.video_url) : null;
  const urlB = clipB ? streamUrl(clipB.video_url) : null;

  const releaseA = manualA ?? releaseFromUtc(selected?.anchor.utc, startA);
  const releaseB = manualB ?? releaseFromUtc(selected?.next.utc, startB);
  const aligned = releaseA != null && releaseB != null;

  const onError = useCallback((m: string) => setStatus(m), []);
  const onStartA = useCallback((ms: number | null) => setStartA(ms), []);
  const onStartB = useCallback((ms: number | null) => setStartB(ms), []);
  useHls(vA, urlA, onError, onStartA);
  useHls(vB, urlB, onError, onStartB);

  useEffect(() => { for (const v of [vA.current, vB.current]) if (v) v.playbackRate = rate; }, [rate, urlA, urlB]);

  // B follows A so both sit at the same time relative to their own release (plus the nudge).
  const sync = useCallback(() => {
    const a = vA.current, b = vB.current; if (!a || !b || !locked) return;
    const rel = tIn(a) - (releaseA ?? 0);
    const want = t0(b) + Math.max(0, (releaseB ?? 0) + rel + nudgeMs / 1000);
    if (Math.abs(b.currentTime - want) > 0.02) b.currentTime = want;
  }, [releaseA, releaseB, nudgeMs, locked]);
  useEffect(sync, [sync]);

  const seekRel = useCallback((rel: number) => {
    const a = vA.current; if (!a) return;
    a.currentTime = t0(a) + Math.max(0, (releaseA ?? 0) + rel);
    sync();
  }, [releaseA, sync]);

  // Scrubber position, the 3D flight clock, and keeping B in step while playing.
  useEffect(() => {
    const a = vA.current;
    if (!a || !urlA) { onFlightTime(null); return; }
    let raf = 0;
    const tick = () => {
      const rel = tIn(a) - (releaseA ?? 0);
      setPos(rel);
      setPosA(tIn(a));
      const b = vB.current;
      if (b) setPosB(tIn(b));
      const clipLen = (v: HTMLVideoElement) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration - t0(v) : 10);
      setDurA(clipLen(a));
      if (b) setDurB(clipLen(b));
      // Drive the 3D clock only while the video is playing or sits after release; a clip parked
      // before release leaves the 3D showing the full paths instead of two balls in the hand.
      const drive = linked && drivesScene && releaseA != null && (!a.paused || rel > 0);
      onFlightTime(drive ? Math.max(0, rel) : null);
      if (!a.paused) sync();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); onFlightTime(null); };
  }, [linked, drivesScene, releaseA, urlA, onFlightTime, sync]);

  useEffect(() => {
    const a = vA.current; if (!a) return;
    const done = () => setPlaying(false);
    a.addEventListener("ended", done); a.addEventListener("pause", done);
    return () => { a.removeEventListener("ended", done); a.removeEventListener("pause", done); };
  }, [urlA]);

  // Once both releases are known, park the clips just before release.
  useEffect(() => { if (aligned) seekRel(-0.6); }, [aligned, seekRel]);

  const pauseBoth = () => { vA.current?.pause(); vB.current?.pause(); setPlaying(false); };
  const toggle = () => {
    const a = vA.current, b = vB.current; if (!a || !b) return;
    if (playing) { pauseBoth(); return; }
    sync();
    Promise.all([a.play(), b.play()]).then(() => setPlaying(true)).catch((e: Error) => setStatus(`Play was blocked: ${e.name}: ${e.message}`));
  };
  const step = (ms: number) => { pauseBoth(); seekRel(pos + ms / 1000); };
  const scrubA = (t: number) => { const a = vA.current; if (!a) return; pauseBoth(); a.currentTime = t0(a) + t; sync(); };
  // Scrubbing B while locked re-aligns it: wherever B is parked now is taken as the frame that matches A's current frame.
  const scrubB = (t: number) => {
    const a = vA.current, b = vB.current; if (!b) return; pauseBoth();
    b.currentTime = t0(b) + t;
    if (locked && a && releaseA != null) { setNudgeMs(0); setManualB(t - (tIn(a) - releaseA)); }
  };
  const markA = () => { const a = vA.current; if (a) setManualA(tIn(a)); };
  const markB = () => { const b = vB.current; if (b) setManualB(tIn(b)); };

  const perspectives = clipsA.map((c) => c.perspective).filter((p) => clipsB.some((c) => c.perspective === p));
  const fmt = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(s * 1000).toFixed(0)} ms`;

  return (
    <div className="overlay">
      <div className="overlay-head">
        <div className="sec-title">Video overlay</div>
        <PitchPicker rows={rows} pairs={pairs} selected={selected} onSelect={onSelect} />
      </div>

      <div className="overlay-stage">
        {selected && selected.anchor.id !== selected.next.id && urlA && urlB ? (
          <>
            <video ref={vA} muted playsInline preload="auto" />
            <video ref={vB} muted playsInline preload="auto" style={{ opacity }} />
            <div className="overlay-tags">
              <span><i style={{ background: pitchColorOnDark(anchorType) }} />{anchorType}</span>
              <span><i style={{ background: pitchColorOnDark(nextType) }} />{nextType}</span>
              <span className={aligned ? "tag-ok" : "tag-warn"}>{aligned ? "Releases aligned" : "Release not found: mark it"}</span>
            </div>
          </>
        ) : (
          <div className="video-empty"><p>{status ?? (selected ? "Loading…" : "Pick any two pitches to stack their clips.")}</p></div>
        )}
      </div>

      {selected && selected.anchor.id !== selected.next.id && urlA && urlB && (
        <>
          <div className="scrub-row">
            <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play both"}>{playing ? "❚❚" : "▶"}</button>
            <button type="button" className="ghost" onClick={() => step(-33)} aria-label="Back one frame">−1f</button>
            <button type="button" className="ghost" onClick={() => step(33)} aria-label="Forward one frame">+1f</button>
            <span className="clock" title="Time relative to the first pitch's release">{fmt(pos)}</span>
            <select className="speed" aria-label="Video speed" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {VIDEO_SPEEDS.map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            <label className="hud-check" title="Scrubbing the first clip moves both. Scrubbing the second re-aligns it."><input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />Locked</label>
          </div>
          {[
            { key: "A", type: anchorType, pos: posA, dur: durA, rel: releaseA, onScrub: scrubA },
            { key: "B", type: nextType, pos: posB, dur: durB, rel: releaseB, onScrub: scrubB },
          ].map((bar) => (
            <div className="scrub-row clip-scrub" key={bar.key}>
              <span className="clip-label"><i style={{ background: pitchColorOnDark(bar.type) }} />{bar.type}</span>
              <div className="scrub-wrap">
                <input type="range" className="scrub" min={0} max={bar.dur} step={0.001} value={Math.min(bar.dur, Math.max(0, bar.pos))}
                  onChange={(e) => bar.onScrub(Number(e.target.value))} aria-label={`${bar.type} clip time`} />
                {bar.rel != null && <i className="release-tick" style={{ left: `${(bar.rel / bar.dur) * 100}%` }} aria-hidden="true" title="Release" />}
              </div>
              <span className="clock">{bar.pos.toFixed(2)} s</span>
            </div>
          ))}
          <div className="overlay-controls">
            <label className="mini"><span>Blend</span><input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Blend between the two clips" /></label>
            <label className="mini"><span>Nudge {nudgeMs >= 0 ? "+" : ""}{nudgeMs} ms</span><input type="range" min={-500} max={500} step={10} value={nudgeMs} onChange={(e) => setNudgeMs(Number(e.target.value))} aria-label="Fine time adjustment of the second clip" /></label>
            {perspectives.length > 1 && (
              <select aria-label="Camera" value={perspective} onChange={(e) => setPerspective(e.target.value)}>
                {perspectives.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <span className="hud-sep" />
            <button type="button" className="ghost" onClick={markA} title={`Scrub to the frame the ${anchorType} leaves the hand, then click`}>Mark {anchorType} release</button>
            <button type="button" className="ghost" onClick={markB} title={`Scrub to the frame the ${nextType} leaves the hand, then click`}>Mark {nextType} release</button>
            <label className="hud-check"><input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />Link to 3D</label>
            {status && <span className="hint">{status}</span>}
          </div>
        </>
      )}
    </div>
  );
}
