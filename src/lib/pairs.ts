import type { PitchRow } from "./types";

/** Two consecutive pitches to the same hitter: the anchor, then the tunnel pitch. */
export interface RealPair { anchor: PitchRow; next: PitchRow }

/**
 * Real back-to-back pairs of the given types from the selected pitches: same game,
 * inning, half and at-bat, pitch numbers one apart. Newest first.
 */
export function realPairs(rows: PitchRow[], anchorType: string, nextType: string, limit = 40): RealPair[] {
  const byAtBat = new Map<string, PitchRow[]>();
  for (const r of rows) {
    if (r.pa == null || r.pitchNo == null) continue;
    const k = `${r.game}|${r.inning}|${r.half}|${r.pa}`;
    (byAtBat.get(k) ?? byAtBat.set(k, []).get(k)!).push(r);
  }
  const out: RealPair[] = [];
  for (const ab of byAtBat.values()) {
    ab.sort((a, b) => (a.pitchNo ?? 0) - (b.pitchNo ?? 0));
    for (let i = 1; i < ab.length; i++) {
      const a = ab[i - 1], b = ab[i];
      if ((b.pitchNo ?? 0) - (a.pitchNo ?? 0) !== 1) continue;
      if (a.type === anchorType && b.type === nextType) out.push({ anchor: a, next: b });
    }
  }
  out.sort((x, y) => (x.next.date < y.next.date ? 1 : x.next.date > y.next.date ? -1 : 0));
  return out.slice(0, limit);
}

export interface AwreClip { perspective: string; video_url: string; thumbnail_url?: string; video_id?: string }
export interface AwreLookup { pitch?: Record<string, unknown>; clips: AwreClip[]; error?: string }

export async function lookupClips(pitchUID: string): Promise<AwreLookup> {
  const r = await fetch(`${import.meta.env.BASE_URL}api/awre/pitch/${encodeURIComponent(pitchUID)}`);
  const body = (await r.json()) as AwreLookup;
  if (!r.ok) return { clips: [], error: body.error ?? `HTTP ${r.status}` };
  return body;
}

/**
 * Guess where release sits inside a clip, in seconds from the clip's start.
 * AWRE clip URLs carry the clip's start time (e.g. "...=2025-02-27T00:37:06.568000^15"),
 * and the pitch record carries a timestamp for the pitch. Returns null if either is missing.
 */
export function guessRelease(clip: AwreClip | null, pitch: Record<string, unknown> | undefined): number | null {
  if (!clip || !pitch) return null;
  const m = clip.video_url.match(/=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  const ts = pitch.timestamp;
  if (!m || typeof ts !== "number") return null;
  const start = Date.parse(m[1] + "Z") / 1000;
  const t = ts > 1e11 ? ts / 1000 : ts;   // milliseconds vs seconds
  const off = t - start;
  return Number.isFinite(off) && off >= 0 && off <= 60 ? off : null;
}
