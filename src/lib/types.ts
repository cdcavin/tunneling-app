import type { Coeffs } from "./physics";

/** One tracked pitch. */
export interface PitchRow {
  id: string;            // Trackman PitchUID
  date: string;          // YYYY-MM-DD
  game: string;          // GameID
  opponent: string;      // opponent team name
  season: string;        // e.g. "Spring 2026"
  utc?: string;          // release time, ISO UTC with milliseconds (Trackman UTCDateTime); aligns video
  home?: boolean;        // tracked at WVU's park, where the tags are the staff's own
  inning?: number | null; half?: string | null; pa?: number | null; pitchNo?: number | null;   // at-bat sequence, for finding real pairs
  batter?: string; batterSide?: string; count?: string;   // who was up and the count, when the data carries them
  type: string;          // pitch type (home operator tag, or matched to it for away games)
  velo: number;          // mph, release
  ivb: number;           // in, induced vertical break
  hb: number;            // in, horizontal break (Trackman sign: + = third-base side)
  spin: number | null;   // rpm
  side: number;          // ft, PlateLocSide
  height: number;        // ft, PlateLocHeight
  call: string;          // Trackman PitchCall
  result?: string | null; // PA result when this pitch ended it: Single/Double/Triple/HomeRun/Out/K/BB/HBP/IBB
  ev?: number | null;     // exit velo, mph, balls in play
  coeffs: Coeffs;        // 9-parameter trajectory fit
}

export interface Pitcher {
  id: string;
  name: string;
  throws: "Right" | "Left";
  season: string;
  team?: string;
  conf?: string;
  pitches: PitchRow[];
}

/** A pitch type's average version over a selection of pitches. */
export interface ArsenalPitch {
  type: string;
  n: number;
  velo: number;
  ivb: number;
  hb: number;
  spin: number | null;
  coeffs: Coeffs;
}

export interface PitcherSummary {
  id: string; name: string; throws: "Right" | "Left"; season: string; n: number;
  team?: string; conf?: string; year?: number; fall?: boolean; first?: string; last?: string; games?: number;
  seasons?: string[];     // every season he has data for, newest first (one entry per pitcher)
  years?: number[];
}

/** /data/index.json: who is available, without pitch rows. */
export interface DataIndex {
  generated: string;     // ISO date the data was built
  dataThrough: string;   // last game date in the data
  sample: boolean;       // true = made-up pitchers, safe to show publicly
  teams?: string[];
  confs?: string[];
  pitchers: PitcherSummary[];
}

export type IndexFile = DataIndex;

/** The bundled sample file and the Colab export share this shape. */
export interface DataFile extends Omit<DataIndex, "pitchers"> { pitchers: Pitcher[] }

/** Seasons in the data, newest first ("Fall 2026" before "Spring 2026"). */
export function seasonsOf(rows: PitchRow[]): string[] {
  const rank = (s: string) => Number(s.slice(-4)) * 2 + (s.startsWith("Fall") ? 1 : 0);
  return [...new Set(rows.map((r) => r.season))].sort((a, b) => rank(b) - rank(a));
}

const KEYS = ["Xc0", "Xc1", "Xc2", "Yc0", "Yc1", "Yc2", "Zc0", "Zc1", "Zc2"] as const;

/** Average each pitch type over the given pitches. Types with fewer than `min` pitches are dropped. */
export function buildArsenal(rows: PitchRow[], min = 3): ArsenalPitch[] {
  const byType = new Map<string, PitchRow[]>();
  for (const r of rows) (byType.get(r.type) ?? byType.set(r.type, []).get(r.type)!).push(r);
  const out: ArsenalPitch[] = [];
  for (const [type, ps] of byType) {
    if (ps.length < min) continue;
    const mean = (f: (p: PitchRow) => number) => ps.reduce((s, p) => s + f(p), 0) / ps.length;
    const spins = ps.filter((p) => p.spin != null);
    const coeffs = {} as Coeffs;
    for (const k of KEYS) coeffs[k] = mean((p) => p.coeffs[k]);
    out.push({ type, n: ps.length, velo: mean((p) => p.velo), ivb: mean((p) => p.ivb), hb: mean((p) => p.hb),
      spin: spins.length ? spins.reduce((s, p) => s + p.spin!, 0) / spins.length : null, coeffs });
  }
  return out.sort((a, b) => b.n - a.n);
}
