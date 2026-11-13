import { useEffect } from "react";
import Hls from "hls.js";

/*
 * Single-clip video helpers for the pitch popup. Same rules as VideoOverlay (kept separate so the tunneling
 * overlay stays untouched): Safari plays HLS natively, everything else via hls.js; the clip's wall clock comes
 * from its EXT-X-PROGRAM-DATE-TIME tag; Trackman's UTC stamp lands ~0.8 s after release.
 */
export const IS_SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
const TRACKMAN_UTC_LAG = 0.8;

async function playlistStart(url: string): Promise<number | null> {
  const text = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
  let body = await text(url);
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

export function useHls(ref: React.RefObject<HTMLVideoElement | null>, url: string | null, onError: (msg: string) => void, onStart: (ms: number | null) => void) {
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
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    return () => { alive = false; hls.destroy(); };
  }, [ref, url, onError, onStart]);
}

/** Release inside a clip, seconds from its start, from Trackman's UTC release time and the stream's wall clock. */
export function releaseFromUtc(utc: string | undefined, startMs: number | null): number | null {
  if (!utc || startMs == null) return null;
  const iso = utc.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  if (Number.isNaN(t)) return null;
  const s = (t - startMs) / 1000 - TRACKMAN_UTC_LAG;
  return s >= 0 && s <= 120 ? s : null;
}

/** Where a clip's timeline starts (clips cut from a continuous recording don't start at 0). */
export const clipT0 = (v: HTMLVideoElement) => (v.seekable.length ? v.seekable.start(0) : 0);
