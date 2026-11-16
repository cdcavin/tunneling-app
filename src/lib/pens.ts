import { useEffect, useState } from "react";
import type { PitchRow } from "./types";

/** One bullpen session (Trackman practice mode), as built by pipeline/pens.py. intent = pen FB velo / game FB velo. */
export interface PenSession { id: string; date: string; time: string; n: number; types: Record<string, number>; velo: number; veloMax: number; fbVelo: number | null; intent: number | null }
export interface Pens { sessions: PenSession[]; pitches: PitchRow[] }
export type Source = "games" | "pens" | "both";

const EMPTY: Pens = { sessions: [], pitches: [] };
const cache = new Map<string, Promise<Pens>>();
export function usePens(pitcherId: string): Pens {
  const [p, setP] = useState<Pens>(EMPTY);
  useEffect(() => {
    let alive = true; setP(EMPTY);
    if (!pitcherId) return;
    if (!cache.has(pitcherId)) cache.set(pitcherId, fetch(`${import.meta.env.BASE_URL}data/pens/${encodeURIComponent(pitcherId)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Pens>) : EMPTY)).catch(() => EMPTY));
    cache.get(pitcherId)!.then((d) => { if (alive) setP({ sessions: d.sessions ?? [], pitches: (d.pitches ?? []).map((x) => ({ ...x, pen: true })) }); });
    return () => { alive = false; };
  }, [pitcherId]);
  return p;
}
