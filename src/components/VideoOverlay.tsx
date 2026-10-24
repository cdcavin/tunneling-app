import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { atWvuPark, lookupClips, streamUrl, type AwreClip, type RealPair } from "../lib/pairs";
import PitchPicker from "./PitchPicker";
import type { PitchRow } from "../lib/types";
import { pitchColorOnDark } from "../lib/pitchColors";
import { alignFrames, toGray } from "../lib/align";
import { armAngle, armShape, bestArmPair, boxAround, fitShift, K, loadPose, standing, trunkScore, type Box, type Kp, type PoseModel } from "../lib/pose";

interface Props {
  pairs: RealPair[];
  rows: PitchRow[];
  /** The pitcher's team code, to tell home from away for video. */
  pitcherTeam?: string;
  selected: RealPair | null;
  onSelect: (p: RealPair | null) => void;
  anchorType: string;
  nextType: string;
  /** Called with seconds since release while linked to the 3D view, or null when unlinked. */
  onFlightTime: (t: number | null) => void;
  /** Whether the 3D view is showing this real pair (so the video may drive its clock). */
  drivesScene: boolean;
  /** The pitcher's throwing hand ("Right" / "Left"), to know which arm to match. */
  throws?: string;
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

export default function VideoOverlay({ pairs, rows, pitcherTeam, selected, onSelect, anchorType, nextType, onFlightTime, drivesScene, throws = "Right" }: Props) {
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
    const away = [["A", selected.anchor], ["B", selected.next]].filter(([, p]) => !atWvuPark(p as PitchRow, pitcherTeam)).map(([k]) => k);
    if (away.length) {
      setClipsA([]); setClipsB([]);
      setStatus(`No video available: pitch ${away.join(" and ")} ${away.length === 1 ? "wasn't" : "weren't"} thrown at WVU. Video exists only for home games.`);
      return;
    }
    let cancelled = false;
    setStatus("Looking up video…");
    setManualA(null); setManualB(null); setNudgeMs(0);
    Promise.all([lookupClips(selected.anchor.id), lookupClips(selected.next.id)]).then(([a, b]) => {
      if (cancelled) return;
      setClipsA(a.clips); setClipsB(b.clips);
      const missing = [["A", a], ["B", b]].filter(([, r]) => !(r as { clips: AwreClip[] }).clips.length).map(([k]) => k);
      const err = a.error ?? b.error;
      setStatus(missing.length
        ? `No AWRE video for pitch ${missing.join(" and ")} (${missing.length === 1 ? "it" : "they"} may not have been filmed or synced). Pick another.`
        : err ?? null);
      const names = a.clips.map((c) => c.perspective).filter((p) => b.clips.some((c) => c.perspective === p));
      setPerspective((cur) => (names.includes(cur) ? cur : names.find((n) => /center ?field/i.test(n)) ?? names.find((n) => /home ?plate/i.test(n)) ?? names[0] ?? ""));
    });
    return () => { cancelled = true; };
  }, [selected, pitcherTeam]);

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
  const playedAt = useRef(0);   // when play() was last called; drift seeks are held off right after it
  const sync = useCallback((tolerance = 0.02) => {
    const a = vA.current, b = vB.current; if (!a || !b || !locked) return;
    const rel = tIn(a) - (releaseA ?? 0);
    const want = t0(b) + Math.max(0, (releaseB ?? 0) + rel + nudgeMs / 1000);
    if (Math.abs(b.currentTime - want) > tolerance) b.currentTime = want;
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
      // While playing, keep B locked to A by steering its playback rate (no seeks, so nothing stutters or
      // aborts). Only a big drift, e.g. after a stall, gets a hard seek.
      if (b && !a.paused && !b.paused && locked) {
        const want = t0(b) + Math.max(0, (releaseB ?? 0) + rel + nudgeMs / 1000);
        const drift = b.currentTime - want;            // + = B is ahead
        if (Math.abs(drift) > 0.4 && performance.now() - playedAt.current > 600) b.currentTime = want;
        else b.playbackRate = rate * Math.max(0.5, Math.min(1.5, 1 - drift * 2.5));
      } else if (b && b.playbackRate !== rate) b.playbackRate = rate;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); onFlightTime(null); };
  }, [linked, drivesScene, releaseA, releaseB, nudgeMs, locked, rate, urlA, onFlightTime]);

  useEffect(() => {
    const a = vA.current; if (!a) return;
    const done = () => setPlaying(false);
    a.addEventListener("ended", done); a.addEventListener("pause", done);
    return () => { a.removeEventListener("ended", done); a.removeEventListener("pause", done); };
  }, [urlA]);

  // Once both releases are known, park the clips just before release.
  useEffect(() => { if (aligned) seekRel(-0.6); }, [aligned, seekRel]);

  const pauseBoth = () => {
    vA.current?.pause(); vB.current?.pause(); setPlaying(false);
    if (vB.current) vB.current.playbackRate = rate;
    sync();   // the two pause a frame or two apart; park B exactly on A's frame
  };
  const toggle = () => {
    const a = vA.current, b = vB.current; if (!a || !b) return;
    if (playing) { pauseBoth(); return; }
    sync();
    // Safari's native HLS seeks can take a moment; a play() issued mid-seek is aborted. Let any seek settle first.
    const settled = (v: HTMLVideoElement) => new Promise<void>((res) => {
      if (!v.seeking) return res();
      const done = () => { v.removeEventListener("seeked", done); res(); };
      v.addEventListener("seeked", done);
      setTimeout(done, 1500);
    });
    const start = () => Promise.all([a.play(), b.play()]);
    Promise.all([settled(a), settled(b)]).then(() => { playedAt.current = performance.now(); return start(); })
      .then(() => setPlaying(true))
      .catch((e: Error) => {
        if (e.name === "AbortError") {
          setTimeout(() => Promise.all([settled(a), settled(b)]).then(() => { playedAt.current = performance.now(); return start(); })
            .then(() => setPlaying(true)).catch((e2: Error) => setStatus(`Play was blocked: ${e2.name}: ${e2.message}`)), 250);
          return;
        }
        setStatus(`Play was blocked: ${e.name}: ${e.message}`);
      });
  };
  const step = (ms: number) => { pauseBoth(); seekRel(pos + ms / 1000); };
  const scrubA = (t: number) => { const a = vA.current; if (!a) return; pauseBoth(); a.currentTime = t0(a) + t; sync(); };
  // Scrubbing B while locked re-aligns it: wherever B is parked now is taken as the frame that matches A's current frame.
  const scrubB = (t: number) => {
    const a = vA.current, b = vB.current; if (!b) return; pauseBoth();
    b.currentTime = t0(b) + t;
    if (locked && a && releaseA != null) { setNudgeMs(0); setManualB(t - (tIn(a) - releaseA)); }
  };
  // Resync: drop any hand marks, nudge and drift, re-lock B to A, and park both at the same moment
  // relative to their own (UTC-derived) releases. The seek waits for the release values to settle.
  const pendingResync = useRef<number | null>(null);
  const resync = () => {
    pauseBoth();
    pendingResync.current = Number.isFinite(pos) ? pos : -0.6;
    setManualA(null); setManualB(null); setNudgeMs(0); setLocked(true);
    if (vB.current) vB.current.playbackRate = rate;
    setResyncN((n) => n + 1);
  };
  const [resyncN, setResyncN] = useState(0);
  useEffect(() => {
    if (pendingResync.current == null) return;
    const rel = pendingResync.current; pendingResync.current = null;
    seekRel(rel);
  }, [resyncN, seekRel]);
  // Align: stack the pitcher (and the hitter where possible) by body tracking, and re-sync both clips on the
  // frames where the throwing arms match best. Falls back to matching the ballpark when no body is found.
  const [xf, setXf] = useState<{ s: number; tx: number; ty: number } | null>(null);
  const [alignMsg, setAlignMsg] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);
  const beforeAlign = useRef<{ manualA: number | null; manualB: number | null; nudgeMs: number } | null>(null);
  useEffect(() => { setXf(null); setAlignMsg(null); beforeAlign.current = null; }, [urlA, urlB]);

  const frameOf = (v: HTMLVideoElement, w = v.videoWidth, h = v.videoHeight) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true })!.drawImage(v, 0, 0, w, h);
    return c;
  };
  const seekClip = (v: HTMLVideoElement, tClip: number) => new Promise<void>((res) => {
    let finished = false;
    const finish = () => { if (finished) return; finished = true; v.removeEventListener("seeked", onSeeked); res(); };
    const onSeeked = () => {
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }).requestVideoFrameCallback;
      if (rvfc) rvfc.call(v, finish); setTimeout(finish, 250);
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = t0(v) + Math.max(0, tClip);
    setTimeout(finish, 3000);
  });
  /** Css percent for a shift in video pixels (the clip is drawn "contain" in a 16:9 box). */
  const toXf = (v: HTMLVideoElement, s: number, txPx: number, tyPx: number) => {
    const ar = v.videoWidth / v.videoHeight || 16 / 9;
    const rw = Math.min(1, ar / (16 / 9)), rh = Math.min(1, (16 / 9) / ar);
    return { s, tx: (txPx / v.videoWidth) * 100 * rw, ty: (tyPx / v.videoHeight) * 100 * rh };
  };

  const backgroundAlign = (why: string) => {
    const a = vA.current!, b = vB.current!;
    const g = (v: HTMLVideoElement) => toGray(frameOf(v, 256, 144).getContext("2d")!.getImageData(0, 0, 256, 144).data, 256, 144);
    const r = alignFrames(g(a), g(b));
    if (r.verdict === "apply") { setXf(toXf(b, r.scale, r.dx * b.videoWidth, r.dy * b.videoHeight)); setAlignMsg(`${why} Lined up the ballpark instead.`); }
    else setAlignMsg(`${why} ${r.verdict === "already" ? "The ballpark already lines up." : "Couldn't line up the ballpark either."}`);
  };

  /** The pitcher in a frame: a wide box around the mound first, then a tight box around what it found. */
  const findPitcher = async (m: PoseModel, f: HTMLCanvasElement, near?: Box) => {
    const W = f.width, H = f.height;
    let kp = await m.estimate(f, near ?? [0.12 * W, 0.22 * H, 0.62 * W, H]);
    const box = boxAround(kp);
    if (box) kp = await m.estimate(f, box);
    return trunkScore(kp) >= 0.5 ? kp : null;
  };
  /** The hitter: standing person in the plate area who isn't the pitcher. Best effort. */
  const findHitter = async (m: PoseModel, f: HTMLCanvasElement, pitcher: Kp[]) => {
    const W = f.width, H = f.height;
    const pBox = boxAround(pitcher, 0.1)!;
    const overlaps = (k: Kp[]) => { const c = boxAround(k, 0); if (!c) return true; const ix = Math.max(0, Math.min(c[2], pBox[2]) - Math.max(c[0], pBox[0])), iy = Math.max(0, Math.min(c[3], pBox[3]) - Math.max(c[1], pBox[1])); return ix * iy > 0.3 * (c[2] - c[0]) * (c[3] - c[1]); };
    let best: Kp[] | null = null, bestScore = 0;
    for (const box of [[0.36 * W, 0.12 * H, 0.6 * W, 0.75 * H], [0.55 * W, 0.12 * H, 0.82 * W, 0.75 * H], [0.36 * W, 0.12 * H, 0.82 * W, 0.75 * H]] as Box[]) {
      let kp = await m.estimate(f, box);
      const tight = boxAround(kp); if (tight) kp = await m.estimate(f, tight);
      const sc = trunkScore(kp);
      if (sc >= 0.5 && standing(kp) && !overlaps(kp) && sc > bestScore) { best = kp; bestScore = sc; }
    }
    return best;
  };

  const autoAlign = async () => {
    const a = vA.current, b = vB.current;
    if (!a || !b || a.readyState < 2 || b.readyState < 2) { setAlignMsg("Clips still loading."); return; }
    pauseBoth(); setAligning(true);
    const prev = { manualA, manualB, nudgeMs };
    try {
      if (releaseA == null || releaseB == null) { backgroundAlign("Release not found, so the pitcher can't be matched."); return; }
      setAlignMsg("Loading body tracking…");
      let m: PoseModel;
      try { m = await loadPose(setAlignMsg); } catch { backgroundAlign("Body tracking didn't load."); return; }
      setAlignMsg("Finding the pitcher…");
      const FPS = 30, OFFS = m.device === "webgpu" ? [-3, -2, -1, 0, 1, 2, 3] : [-1, 0, 1];
      const scan = async (v: HTMLVideoElement, rel: number) => {
        await seekClip(v, rel);
        const base = await findPitcher(m, frameOf(v));
        if (!base) return null;
        const near = boxAround(base, 0.45)!;
        const frames: { t: number; kp: Kp[] | null }[] = [];
        for (const k of OFFS) {
          const t = rel + k / FPS;
          await seekClip(v, t);
          frames.push({ t, kp: await findPitcher(m, frameOf(v), near) });
        }
        return frames;
      };
      const fa = await scan(a, releaseA), fb = await scan(b, releaseB);
      if (!fa || !fb) { backgroundAlign(`Couldn't find the pitcher in clip ${!fa ? "A" : "B"}.`); return; }
      const pick = bestArmPair(fa.map((f) => (f.kp ? armShape(f.kp, throws) : null)), fb.map((f) => (f.kp ? armShape(f.kp, throws) : null)), OFFS, OFFS);
      if (pick.i < 0) { backgroundAlign("Couldn't see the pitcher's arm at release."); return; }
      const A = fa[pick.i], B = fb[pick.j];

      setAlignMsg("Finding the hitter…");
      await seekClip(a, A.t); const fA = frameOf(a);
      await seekClip(b, B.t); const fB = frameOf(b);
      const hA = await findHitter(m, fA, A.kp!), hB = await findHitter(m, fB, B.kp!);

      // Zoom from the ballpark (it doesn't change shape between pitches; a body does), capped at +-10%.
      const g = (f: HTMLCanvasElement) => { const t = document.createElement("canvas"); t.width = 256; t.height = 144; t.getContext("2d")!.drawImage(f, 0, 0, 256, 144); return toGray(t.getContext("2d")!.getImageData(0, 0, 256, 144).data, 256, 144); };
      const bg = alignFrames(g(fA), g(fB));
      const zoom = bg.verdict === "unsure" ? 1 : Math.min(1.1, Math.max(0.9, bg.scale));
      // Shift from the pitcher's trunk (head, shoulders, hips); legs count less since stride changes them. The arm is
      // what we compare, not what we fit, and the hitter is only measured.
      const P = [K.nose, K.lSho, K.rSho, K.lHip, K.rHip], LEGS = [K.lKne, K.rKne, K.lAnk, K.rAnk];
      const H = [K.nose, K.lSho, K.rSho, K.lHip, K.rHip, K.lAnk, K.rAnk];
      const pa: Kp[] = [], pb: Kp[] = [], w: number[] = [];
      for (const i of [...P, ...LEGS]) if (A.kp![i].s > 0.3 && B.kp![i].s > 0.3) { pa.push(A.kp![i]); pb.push(B.kp![i]); w.push(P.includes(i) ? 1 : 0.25); }
      const withHitter = !!(hA && hB);
      const c = { x: b.videoWidth / 2, y: b.videoHeight / 2 };
      const fit = fitShift(pa, pb, w, c, zoom);
      const err = (kA: Kp[], kB: Kp[], idx: number[]) => {
        const d = idx.filter((i) => kA[i].s > 0.3 && kB[i].s > 0.3).map((i) => Math.hypot(fit.s * (kB[i].x - c.x) + fit.tx + c.x - kA[i].x, fit.s * (kB[i].y - c.y) + fit.ty + c.y - kA[i].y));
        return d.length ? d.reduce((x, y) => x + y, 0) / d.length : NaN;
      };
      const pitcherErr = err(A.kp!, B.kp!, P), hitterErr = withHitter ? err(hA!, hB!, H) : NaN;
      const armDiff = Math.abs(((armAngle(A.kp!, throws) - armAngle(B.kp!, throws) + 540) % 360) - 180);

      beforeAlign.current = prev;
      setXf(toXf(b, fit.s, fit.tx, fit.ty));
      setManualA(A.t); setManualB(B.t); setNudgeMs(0); setLocked(true);
      pendingResync.current = 0; setResyncN((n) => n + 1);   // park both on the matched release frames
      setAlignMsg(`Pitcher stacked (within ${Math.round(pitcherErr)} px) · arm ${Math.round(armDiff)}° apart` +
        (withHitter ? ` · hitter within ${Math.round(hitterErr)} px` : " · hitter not found") + ` · zoom ${Math.round(fit.s * 100)}%`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAlignMsg(/security|tainted|cross-origin/i.test(msg) ? "This browser won't let the page read the video frames." : `Align failed: ${msg.slice(0, 120)}`);
    } finally { setAligning(false); }
  };
  const undoAlign = () => {
    setXf(null); setAlignMsg(null);
    const p = beforeAlign.current; beforeAlign.current = null;
    if (p) { setManualA(p.manualA); setManualB(p.manualB); setNudgeMs(p.nudgeMs); }
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
            <video ref={vA} muted playsInline preload="auto" crossOrigin="anonymous" />
            <video ref={vB} muted playsInline preload="auto" crossOrigin="anonymous"
              style={{ opacity, transformOrigin: "50% 50%", transform: xf ? `translate(${xf.tx}%, ${xf.ty}%) scale(${xf.s})` : undefined }} />
            <div className="overlay-tags">
              <span><i style={{ background: pitchColorOnDark(anchorType) }} />{anchorType}</span>
              <span><i style={{ background: pitchColorOnDark(nextType) }} />{nextType}</span>
              <span className={aligned ? "tag-ok" : "tag-warn"}>{aligned ? "Releases aligned" : "Release not found: mark it"}</span>
            </div>
          </>
        ) : (
          (() => {
            const noVideo = !status && !selected && !rows.some((r) => atWvuPark(r, pitcherTeam));
            const title = status ? "Video" : selected ? "Loading clips" : noVideo ? "No video for these pitches" : "No pair loaded";
            const body = status ?? (selected ? "Fetching both angles from AWRE." : noVideo
              ? "Video exists only for pitches thrown at WVU's park."
              : "Pick pitch A and pitch B above, or use Find pitches, to stack their clips.");
            return (
              <div className="video-empty">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" />{noVideo && <path d="M3 3l18 18" />}
                </svg>
                <b>{title}</b>
                <p>{body}</p>
              </div>
            );
          })()
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
            <button type="button" className="ghost" onClick={resync} title="Put both clips back on the same release-aligned frame (clears marks and nudge)">Resync</button>
            <button type="button" className="ghost" onClick={autoAlign} disabled={aligning}
              title="Stack the pitcher (and the hitter where possible) and re-sync on the frames where the throwing arms match. First use downloads the body-tracking model.">{aligning ? "Aligning…" : "Align"}</button>
            {(xf || beforeAlign.current) && <button type="button" className="ghost" onClick={undoAlign}>Undo align</button>}
          </div>
          {alignMsg && <p className="align-msg">{alignMsg}</p>}
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
