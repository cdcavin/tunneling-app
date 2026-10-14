import type { PitchRow } from "./types";

export interface Range { min: number; max: number }

export interface Filters {
  games: string[];       // empty = all outings
  opponents: string[];   // empty = all
  types: string[];       // empty = all
  velo: Range | null;
  ivb: Range | null;
  hb: Range | null;
}

export const NO_FILTERS: Filters = { games: [], opponents: [], types: [], velo: null, ivb: null, hb: null };

export const isActive = (f: Filters) =>
  f.games.length > 0 || f.opponents.length > 0 || f.types.length > 0 || !!f.velo || !!f.ivb || !!f.hb;

const inRange = (v: number, r: Range | null) => !r || (v >= r.min && v <= r.max);

export function applyFilters(rows: PitchRow[], f: Filters): PitchRow[] {
  return rows.filter((p) =>
    (f.games.length === 0 || f.games.includes(p.game)) &&
    (f.opponents.length === 0 || f.opponents.includes(p.opponent)) &&
    (f.types.length === 0 || f.types.includes(p.type)) &&
    inRange(p.velo, f.velo) && inRange(p.ivb, f.ivb) && inRange(p.hb, f.hb));
}

export interface Outing { game: string; date: string; opponent: string; n: number }

export function outings(rows: PitchRow[]): Outing[] {
  const m = new Map<string, Outing>();
  for (const p of rows) {
    const o = m.get(p.game);
    if (o) o.n++; else m.set(p.game, { game: p.game, date: p.date, opponent: p.opponent, n: 1 });
  }
  return [...m.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function extent(rows: PitchRow[], key: "velo" | "ivb" | "hb"): Range {
  let min = Infinity, max = -Infinity;
  for (const p of rows) { min = Math.min(min, p[key]); max = Math.max(max, p[key]); }
  return { min: Math.floor(min), max: Math.ceil(max) };
}
