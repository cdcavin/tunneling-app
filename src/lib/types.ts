import type { Coeffs } from "./physics";

/** One tracked pitch. */
export interface PitchRow {
  id: string;            // Trackman PitchUID
  date: string;          // YYYY-MM-DD
  game: string;          // GameID
  opponent: string;      // opponent team name
  type: string;          // pitch type (home operator tag, or matched to it for away games)
  velo: number;          // mph, release
  ivb: number;           // in, induced vertical break
  hb: number;            // in, horizontal break (Trackman sign: + = third-base side)
  spin: number | null;   // rpm
  side: number;          // ft, PlateLocSide
  height: number;        // ft, PlateLocHeight
  call: string;          // Trackman PitchCall
  coeffs: Coeffs;        // 9-parameter trajectory fit
}

export interface Pitcher {
  id: string;
  name: string;
  throws: "Right" | "Left";
  season: string;
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

export interface DataFile {
  generated: string;     // ISO date the file was built
  dataThrough: string;   // last game date in the data
  sample: boolean;       // true = made-up pitchers, safe to show publicly
  pitchers: Pitcher[];
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
