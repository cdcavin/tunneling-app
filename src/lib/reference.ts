/** P4 / Big 12 separation reference, built in Colab from real back-to-back pairs (see /data/reference.json). */

export type BinCounts = Record<string, number>;   // n, swings, whiffs, contacts, outOfZone, chases, takes, calledStrikes, evN, evSum, hard, pa, ab, hits, tb, k, bb, hbp
export interface ComboRef { n: number; pct: number[]; bins: Record<string, BinCounts> }
export interface Reference {
  generated: string;
  minPlateIn: number;
  decisionFt: number;
  pools: Record<string, Record<string, ComboRef>>;
}

/** Separation bands shown in the table, inches at 23.8 ft. The last band is open-ended. */
export const BANDS: { lo: number; hi: number; label: string }[] = [
  { lo: 0, hi: 2, label: "0–2 in" }, { lo: 2, hi: 4, label: "2–4 in" }, { lo: 4, hi: 6, label: "4–6 in" },
  { lo: 6, hi: 8, label: "6–8 in" }, { lo: 8, hi: 11, label: "8–11 in" }, { lo: 11, hi: 15, label: "11–15 in" },
  { lo: 15, hi: Infinity, label: "15+ in" },
];
export const bandOf = (sep: number) => BANDS.findIndex((b) => sep >= b.lo && sep < b.hi);

/** WVU's operator tags use a couple of names the D1 classifier doesn't; the reference uses the classifier's. */
const FAM: Record<string, string> = { Fastball: "Four-Seam", Sweeper: "Slider" };
export const comboKey = (a: string, b: string) => `${FAM[a] ?? a}>${FAM[b] ?? b}`;

/** Sum the 1-inch bins that fall in each band. */
export function bandTotals(c: ComboRef): BinCounts[] {
  return BANDS.map((band) => {
    const s: BinCounts = {};
    for (const [k, v] of Object.entries(c.bins)) {
      const b = Number(k);
      if (b < band.lo || b >= band.hi) continue;
      for (const [f, x] of Object.entries(v)) s[f] = (s[f] ?? 0) + x;
    }
    return s;
  });
}

/** Share of P4 pairs that were LESS tight than `sep` (so 95 = tighter than 95% of pairs). */
export function tighterThan(c: ComboRef, sep: number): number {
  const p = c.pct; // separation at the 5th, 10th, ..., 95th percentiles
  if (sep <= p[0]) return 95 + Math.min(4, (1 - sep / Math.max(p[0], 1e-6)) * 5);
  if (sep >= p[p.length - 1]) return 5 - Math.min(4, (sep - p[p.length - 1]) / Math.max(p[p.length - 1], 1e-6) * 5);
  for (let i = 1; i < p.length; i++) {
    if (sep <= p[i]) {
      const f = (sep - p[i - 1]) / Math.max(p[i] - p[i - 1], 1e-9);
      const pctile = 5 * i + 5 * f;            // percentile of sep among P4 pairs
      return 100 - pctile;
    }
  }
  return 50;
}

let cache: Promise<Reference | null> | null = null;
export function loadReference(): Promise<Reference | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/reference.json`).then((r) => (r.ok ? (r.json() as Promise<Reference>) : null)).catch(() => null);
  return cache;
}
