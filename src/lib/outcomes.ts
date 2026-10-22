import { ZONE } from "./grid";
import type { PitchRow } from "./types";

/** Counted results for a set of pitches. Rates are null when the denominator is zero. */
export interface Outcomes {
  pitches: number;
  swings: number; whiffs: number; contacts: number;
  outOfZone: number; chases: number; takes: number; calledStrikes: number;
  bip: number; evSum: number; evN: number; hardHit: number;
  pa: number; ab: number; hits: number; tb: number; k: number; bb: number; hbp: number;
  whiffPct: number | null; chasePct: number | null; contactPct: number | null; calledStrikePct: number | null;
  ev: number | null; hardHitPct: number | null;
  avg: number | null; obp: number | null; slg: number | null; kPct: number | null; bbPct: number | null;
}

const norm = (c: string | null | undefined) => (c ?? "").toLowerCase().replace(/\s+/g, "");
const isWhiff = (c: string) => c === "strikeswinging";
const isFoul = (c: string) => c.startsWith("foulball") || c === "foul";
const isInPlay = (c: string) => c === "inplay";
const isSwing = (c: string) => isWhiff(c) || isFoul(c) || isInPlay(c);
export const inZone = (p: PitchRow) => Math.abs(p.side) <= ZONE.halfWidth && p.height >= ZONE.bottom && p.height <= ZONE.top;
const TB: Record<string, number> = { Single: 1, Double: 2, Triple: 3, HomeRun: 4 };
const div = (a: number, b: number) => (b > 0 ? a / b : null);

/** Count real outcomes on these pitches. Hard hit = exit velo of 95 mph or more. IBB is left out of PA. */
export function countOutcomes(rows: PitchRow[]): Outcomes {
  const o = { pitches: rows.length, swings: 0, whiffs: 0, contacts: 0, outOfZone: 0, chases: 0, takes: 0, calledStrikes: 0,
    bip: 0, evSum: 0, evN: 0, hardHit: 0, pa: 0, ab: 0, hits: 0, tb: 0, k: 0, bb: 0, hbp: 0 };
  for (const p of rows) {
    const c = norm(p.call);
    const sw = isSwing(c);
    if (sw) { o.swings++; if (isWhiff(c)) o.whiffs++; else o.contacts++; }
    else { o.takes++; if (c === "strikecalled") o.calledStrikes++; }
    if (!inZone(p)) { o.outOfZone++; if (sw) o.chases++; }
    if (isInPlay(c)) {
      o.bip++;
      if (p.ev != null) { o.evSum += p.ev; o.evN++; if (p.ev >= 95) o.hardHit++; }
    }
    const r = p.result;
    if (r && r !== "IBB") {
      o.pa++;
      if (r === "BB") o.bb++;
      else if (r === "HBP") o.hbp++;
      else {
        o.ab++;
        if (r === "K") o.k++;
        if (r in TB) { o.hits++; o.tb += TB[r]; }
      }
    }
  }
  return {
    ...o,
    whiffPct: div(o.whiffs, o.swings), chasePct: div(o.chases, o.outOfZone), contactPct: div(o.contacts, o.swings),
    calledStrikePct: div(o.calledStrikes, o.takes),
    ev: div(o.evSum, o.evN), hardHitPct: div(o.hardHit, o.evN),
    avg: div(o.hits, o.ab), obp: div(o.hits + o.bb + o.hbp, o.pa), slg: div(o.tb, o.ab),
    kPct: div(o.k, o.pa), bbPct: div(o.bb, o.pa),
  };
}
