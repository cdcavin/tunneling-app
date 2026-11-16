import { useCallback, useEffect, useState } from "react";
import type { PitchRow } from "./types";
import { releaseOf } from "./arsenalStats";
import { tally } from "./sequencing";

/** One outing: its date, opponent, pitch count, and per-pitch-type averages. */
export interface Outing {
  game: string; date: string; opp: string; n: number; rest: number | null; roll7: number; roll28: number; pen: boolean;
  byType: Record<string, { n: number; velo: number; ivb: number; hb: number; spin: number | null; relH: number; relS: number; ext: number }>;
  strike: number | null; whiff: number | null; chase: number | null; hard: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const DAY = 86400000;
const isStrike = (c: string) => /^(strikecalled|strikeswinging|foul|foulball|foulballnotfieldable|foulballfieldable|inplay)$/.test(c);

export function outings(rows: PitchRow[]): Outing[] {
  const g = new Map<string, PitchRow[]>();
  for (const r of rows) { const k = r.pen ? r.game : `${r.date}|${r.opponent}`; const a = g.get(k); if (a) a.push(r); else g.set(k, [r]); }
  const list = [...g.entries()].map(([game, rs]) => {
    const byType: Outing["byType"] = {};
    const types = new Map<string, PitchRow[]>();
    for (const r of rs) { const a = types.get(r.type); if (a) a.push(r); else types.set(r.type, [r]); }
    for (const [t, ts] of types) {
      const rel = ts.map(releaseOf);
      const sp = ts.filter((r) => r.spin != null).map((r) => r.spin!);
      byType[t] = { n: ts.length, velo: mean(ts.map((r) => r.velo)), ivb: mean(ts.map((r) => r.ivb)), hb: mean(ts.map((r) => r.hb)), spin: sp.length ? mean(sp) : null,
        relH: mean(rel.map((x) => x.height)), relS: mean(rel.map((x) => x.side)), ext: mean(rel.map((x) => x.extension)) };
    }
    const t = tally(rs);
    const strikes = rs.filter((r) => isStrike((r.call ?? "").toLowerCase().replace(/\s+/g, ""))).length;
    const pen = !!rs[0].pen;
    return {
      game, date: rs[0].date, opp: rs[0].opponent, n: rs.length, rest: null as number | null, roll7: 0, roll28: 0, byType, pen,
      strike: !pen && rs.length ? strikes / rs.length : null, whiff: !pen && t.swings ? t.whiffs / t.swings : null,
      chase: !pen && t.ooz ? t.chases / t.ooz : null, hard: !pen && t.evN ? t.hard / t.evN : null,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.game.localeCompare(b.game));
  list.forEach((o, i) => {
    const d = Date.parse(o.date);
    if (i > 0) o.rest = Math.round((d - Date.parse(list[i - 1].date)) / DAY);
    for (const p of list) {
      const dd = (d - Date.parse(p.date)) / DAY;
      if (dd >= 0 && dd < 7) o.roll7 += p.n;
      if (dd >= 0 && dd < 28) o.roll28 += p.n;
    }
  });
  return list;
}

/** A change pin on the timeline. Stored per pitcher by the worker (/api/pins). */
export interface Pin { id: string; date: string; kind: string; note?: string; pitch?: string; added?: string }
export const PIN_KINDS: [string, string, string][] = [["grip", "Grip change", "#eaaa00"], ["mechanics", "Mechanics change", "#4fc3f7"], ["health", "Health", "#ef5350"], ["other", "Other", "#b39ddb"]];
export const pinColor = (k: string) => PIN_KINDS.find(([x]) => x === k)?.[2] ?? "#b39ddb";
export const pinLabel = (k: string) => PIN_KINDS.find(([x]) => x === k)?.[1] ?? k;

export function usePins(pitcherId: string) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; setPins([]); setErr(null);
    if (!pitcherId) return;
    fetch(`/api/pins?pitcher=${encodeURIComponent(pitcherId)}`).then(async (r) => {
      if (!alive) return;
      if (!r.ok) { setErr(`Couldn't load pins (HTTP ${r.status}).`); return; }
      setPins(((await r.json()) as { pins: Pin[] }).pins ?? []);
    }).catch((e: Error) => alive && setErr(`Couldn't load pins (${e.message}).`));
    return () => { alive = false; };
  }, [pitcherId]);
  const save = useCallback(async (pin: Partial<Pin>) => {
    const r = await fetch("/api/pins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pitcher: pitcherId, pin }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setPins(((await r.json()) as { pins: Pin[] }).pins);
  }, [pitcherId]);
  const remove = useCallback(async (id: string) => {
    const r = await fetch(`/api/pins?pitcher=${encodeURIComponent(pitcherId)}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setPins(((await r.json()) as { pins: Pin[] }).pins);
  }, [pitcherId]);
  return { pins, err, save, remove };
}

/** Workload events on the calendar: game outings (start / relief / scrimmage) and bullpens. */
export interface WorkEvent { date: string; kind: "start" | "relief" | "scrimmage" | "pen"; n: number; label: string; intent?: number | null; opp?: string }
export function workEvents(games: PitchRow[], pens: { id: string; date: string; n: number; intent: number | null }[]): WorkEvent[] {
  // One bar per day and opponent: a game Trackman split into two files (or a restart) is still one outing.
  const g = new Map<string, PitchRow[]>();
  for (const r of games) { const k = `${r.date}|${r.opponent}`; const a = g.get(k); if (a) a.push(r); else g.set(k, [r]); }
  const ev: WorkEvent[] = [...g.values()].map((rs) => {
    const first = rs.reduce((a, b) => ((a.inning ?? 99) * 1000 + (a.pa ?? 99) * 10 + (a.pitchNo ?? 9) <= (b.inning ?? 99) * 1000 + (b.pa ?? 99) * 10 + (b.pitchNo ?? 9) ? a : b));
    const kind = rs.some((r) => r.scrimmage) ? "scrimmage" : first.inning === 1 && first.pa === 1 ? "start" : "relief";
    return { date: rs[0].date, kind, n: rs.length, label: String(rs.length), opp: rs[0].opponent };
  });
  for (const p of pens) ev.push({ date: p.date, kind: "pen", n: p.n, intent: p.intent, label: p.intent ? `${p.n} · ${Math.round(p.intent * 100)}%` : String(p.n) });
  return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "pen" ? 1 : -1));
}

/**
 * One calendar axis shared by every Trends chart, so the same date sits at the same spot on all of them.
 * Real day spacing, except gaps over 21 days (off-season) are squeezed to 7 days and marked with a break.
 * pos(date) is 0..1; ticks are evenly spaced (every 7, 14 or 28 days) inside each stretch, all labeled "Mon D".
 */
export interface Axis { pos: (d: string) => number; ticks: { d: string; label: string }[]; breaks: number[] }
const GAP = 21, SQUEEZE = 7;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
export function makeAxis(dates: string[], widthPx = 900): Axis {
  const u = [...new Set(dates)].sort();
  if (!u.length) return { pos: () => 0.5, ticks: [], breaks: [] };
  const day = (d: string) => Date.parse(d) / DAY;
  const anchors: [number, number][] = [[day(u[0]), 0]];   // (real day, squeezed day)
  const breaks: number[] = [];
  for (let i = 1; i < u.length; i++) {
    const gap = day(u[i]) - day(u[i - 1]);
    const prev = anchors[anchors.length - 1];
    const at = prev[1] + (day(u[i - 1]) - prev[0]);
    if (gap > GAP) { anchors.push([day(u[i]), at + SQUEEZE]); breaks.push(at + SQUEEZE / 2); }
  }
  const sq = (d: string) => { const t = day(d); let a = anchors[0]; for (const x of anchors) if (x[0] <= t) a = x; return a[1] + (t - a[0]); };
  const total = Math.max(1, sq(u[u.length - 1]));
  const pos = (d: string) => (u.length === 1 ? 0.5 : sq(d) / total);
  const segs = anchors.map((a, k) => [a[0], k + 1 < anchors.length ? Math.max(...u.filter((d) => day(d) < anchors[k + 1][0]).map(day)) : day(u[u.length - 1])]);
  const pxPerDay = widthPx / total;
  const step = [7, 14, 28, 56].find((s) => s * pxPerDay >= 60) ?? 56;
  const ticks: Axis["ticks"] = [];
  for (const [a, b] of segs) {
    const first = a + ((((4 - a) % 7) + 7) % 7);   // first Monday on or after the stretch starts (epoch day 4 was a Monday)
    for (let t = first; t <= b; t += step) {
      const d = new Date(t * DAY).toISOString().slice(0, 10);
      ticks.push({ d, label: shortDate(d) });
    }
  }
  return { pos, ticks, breaks: breaks.map((b) => b / total) };
}
