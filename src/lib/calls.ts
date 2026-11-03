import { useEffect, useState } from "react";
import type { PitchRow } from "./types";
import { ZONE } from "./grid";

/**
 * Pitch calls from the paper charts, matched to Trackman pitches by pipeline/calls_match.py (served as /data/calls.json).
 *
 * Location codes (relative to the hitter: "in" = his side of the plate, mirrored for a lefty):
 *   top half of the zone, split in thirds:     4 (away) · M / MK (middle) · 1 (in)
 *   bottom half of the zone, split in thirds:  3 (away) · G / GL (middle) · 2 (in)
 *   off the zone, within 6 in of the edge:     7 above · 6 below · 5 off the away edge
 * Suffixes (C, D) and "?" are ignored for now. Miss distance = inches from where the ball crossed (its center) to
 * the nearest point of the target box; 0 = it hit the box.
 */
export interface Call {
  call: string; loc: string; type: string; result: string; chart: string; date: string;
  typeOk: boolean; resultOk: boolean; nameDiffers?: boolean;
}

let cache: Promise<Record<string, Call>> | null = null;
export function loadCalls(): Promise<Record<string, Call>> {
  if (!cache) cache = fetch("/data/calls.json").then((r) => (r.ok ? r.json() : { calls: {} })).then((d) => d.calls ?? {}).catch(() => ({}));
  return cache;
}
export function useCalls() {
  const [calls, setCalls] = useState<Record<string, Call>>({});
  useEffect(() => { let alive = true; loadCalls().then((c) => { if (alive) setCalls(c); }); return () => { alive = false; }; }, []);
  return calls;
}

const OFF = 0.5;   // 6 in, ft
export interface Box { x0: number; x1: number; y0: number; y1: number }   // PlateLocSide / height, ft

/** Target box in plate coordinates (side positive = third-base side), or null if the code or hitter side is unknown. */
export function targetBox(loc: string, batterSide?: string): Box | null {
  const code = loc.toUpperCase().replace(/[CD?]+$/, "").trim();
  const s = batterSide === "Right" ? 1 : batterSide === "Left" ? -1 : 0;   // a righty stands on the third-base side
  if (!code || !s) return null;
  const hw = ZONE.halfWidth, w = (2 * hw) / 3, mid = (ZONE.top + ZONE.bottom) / 2;
  // u = across the plate toward the hitter (+) / away from him (−)
  const cols: Record<string, [number, number]> = { away: [-hw, -hw + w], mid: [-w / 2, w / 2], in: [hw - w, hw], all: [-hw, hw], off: [-hw - OFF, -hw] };
  const spec: Record<string, [keyof typeof cols, number, number]> = {
    "4": ["away", mid, ZONE.top], M: ["mid", mid, ZONE.top], MK: ["mid", mid, ZONE.top], "1": ["in", mid, ZONE.top],
    "3": ["away", ZONE.bottom, mid], G: ["mid", ZONE.bottom, mid], GL: ["mid", ZONE.bottom, mid], "2": ["in", ZONE.bottom, mid],
    "7": ["all", ZONE.top, ZONE.top + OFF], "6": ["all", ZONE.bottom - OFF, ZONE.bottom], "5": ["off", ZONE.bottom, ZONE.top],
  };
  const sp = spec[code];
  if (!sp) return null;
  const [u0, u1] = cols[sp[0]];
  const a = u0 * s, b = u1 * s;
  return { x0: Math.min(a, b), x1: Math.max(a, b), y0: sp[1], y1: sp[2] };
}

/** Inches from the pitch to its target box (0 = in it), or null when it can't be worked out. */
export function missInches(r: PitchRow, c: Call | undefined): number | null {
  if (!c) return null;
  const box = targetBox(c.loc, r.batterSide);
  if (!box || r.side == null || r.height == null) return null;
  const dx = Math.max(box.x0 - r.side, 0, r.side - box.x1), dy = Math.max(box.y0 - r.height, 0, r.height - box.y1);
  return Math.hypot(dx, dy) * 12;
}

/** "SL GL" from "SLGL": type and location, spaced. */
export const callLabel = (c: Call) => `${c.type} ${c.loc}`.trim();
