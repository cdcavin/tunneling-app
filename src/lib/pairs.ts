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
