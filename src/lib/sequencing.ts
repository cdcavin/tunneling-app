import { useEffect, useState } from "react";
import { inZone } from "./outcomes";
import type { PitchRow } from "./types";

/** The 12 counts as a plinko board: one row per pitch of the at-bat, balls drift left, strikes right. */
export const COUNTS = ["0-0", "1-0", "0-1", "2-0", "1-1", "0-2", "3-0", "2-1", "1-2", "3-1", "2-2", "3-2"] as const;
export type Count = (typeof COUNTS)[number];
export const ballsStrikes = (k: string) => k.split("-").map(Number) as [number, number];
/** Arrows: a ball moves b+1, a strike s+1 (fouls with 2 strikes stay put and aren't drawn). */
export const EDGES: [Count, Count][] = COUNTS.flatMap((k) => {
  const [b, s] = ballsStrikes(k);
  const out: [Count, Count][] = [];
  if (b < 3) out.push([k, `${b + 1}-${s}` as Count]);
  if (s < 2) out.push([k, `${b}-${s + 1}` as Count]);
  return out;
});

/** Raw tallies (same definitions as the D1 script, pipeline/colab/build_count_norms.py). */
export interface Tally { n: number; swings: number; whiffs: number; called: number; zone: number; ooz: number; chases: number; evN: number; hard: number }
const call = (p: PitchRow) => (p.call ?? "").toLowerCase().replace(/\s+/g, "");
export function tally(rows: PitchRow[]): Tally {
  const t: Tally = { n: 0, swings: 0, whiffs: 0, called: 0, zone: 0, ooz: 0, chases: 0, evN: 0, hard: 0 };
  for (const p of rows) {
    const c = call(p);
    const whiff = c === "strikeswinging", inplay = c === "inplay";
    const swing = whiff || inplay || c.startsWith("foulball") || c === "foul";
    t.n++;
    if (swing) t.swings++;
    if (whiff) t.whiffs++;
    if (c === "strikecalled") t.called++;
    if (inZone(p)) t.zone++; else { t.ooz++; if (swing) t.chases++; }
    if (inplay && p.ev != null) { t.evN++; if (p.ev >= 95) t.hard++; }
  }
  return t;
}

const rate = (a: number, b: number) => (b > 0 ? a / b : null);
/** Table metrics. `good`: which direction is better for the pitcher; `span`: the gap (rate points) that gets full color. */
export const METRICS: { key: string; label: string; title: string; of: (t: Tally) => number | null; good: 1 | -1 | 0; span: number }[] = [
  { key: "whiff", label: "Whiff%", title: "Misses ÷ swings", of: (t) => rate(t.whiffs, t.swings), good: 1, span: 0.15 },
  { key: "csw", label: "CSW%", title: "Called strikes + whiffs ÷ pitches", of: (t) => rate(t.called + t.whiffs, t.n), good: 1, span: 0.08 },
  { key: "chase", label: "Chase%", title: "Swings out of the zone ÷ pitches out of the zone", of: (t) => rate(t.chases, t.ooz), good: 1, span: 0.12 },
  { key: "zone", label: "Zone%", title: "Share of pitches in the strike zone", of: (t) => rate(t.zone, t.n), good: 1, span: 0.12 },
  { key: "hard", label: "Hard-hit%", title: "Balls in play hit 95+ mph ÷ balls in play with an exit velo", of: (t) => rate(t.hard, t.evN), good: -1, span: 0.15 },
];

/** WVU tags → the D1 classifier's names (same mapping as build_reference.py). */
const NORM_TYPE: Record<string, string> = { Fastball: "Four-Seam", Sweeper: "Slider" };
export const normType = (t: string) => NORM_TYPE[t] ?? t;

export type Hand = "all" | "Left" | "Right";
export interface CountNorms { generated: string; pitches: number; hands: Record<Hand, Record<string, Record<string, Tally>>> }
let cache: Promise<CountNorms | null> | null = null;
export function useCountNorms() {
  const [norms, setNorms] = useState<CountNorms | null>(null);
  useEffect(() => {
    let alive = true;
    cache ??= fetch(`${import.meta.env.BASE_URL}data/count_norms.json`).then((r) => (r.ok ? (r.json() as Promise<CountNorms>) : null)).catch(() => null);
    cache.then((n) => { if (alive) setNorms(n); });
    return () => { alive = false; };
  }, []);
  return norms;
}

/** D1 tallies for one pitch type in one count (or all counts), for one hitter side. */
export function d1Tally(norms: CountNorms | null, hand: Hand, count: string, type: string): Tally | null {
  if (!norms) return null;
  const byCount = norms.hands[hand];
  const t = normType(type);
  if (count !== "all") return byCount?.[count]?.[t] ?? null;
  const sum: Tally = { n: 0, swings: 0, whiffs: 0, called: 0, zone: 0, ooz: 0, chases: 0, evN: 0, hard: 0 };
  let any = false;
  for (const k of Object.keys(byCount ?? {})) {
    const x = byCount[k][t];
    if (!x) continue;
    any = true;
    for (const f of Object.keys(sum) as (keyof Tally)[]) sum[f] += x[f];
  }
  return any ? sum : null;
}

/** Red (better than D1) → blue (worse), on the dark panel. null = no color. */
export function goodBad(diff: number | null, good: 1 | -1 | 0, span: number): string | undefined {
  if (diff == null || good === 0) return undefined;
  const z = Math.max(-1, Math.min(1, (diff * good) / span));
  if (Math.abs(z) < 0.08) return undefined;
  const a = (0.12 + 0.55 * Math.abs(z)).toFixed(2);
  return z > 0 ? `rgba(217, 68, 63, ${a})` : `rgba(58, 120, 220, ${a})`;
}
