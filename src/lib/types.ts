import type { Coeffs } from "./physics";

/** One pitch type in a pitcher's arsenal: his average version of it. */
export interface ArsenalPitch {
  type: string;          // e.g. "Sinker"
  n: number;             // pitches behind the average
  velo: number;          // mph, release
  ivb: number;           // in, induced vertical break
  hb: number;            // in, horizontal break (Trackman sign: + = third-base side)
  spin: number | null;   // rpm
  coeffs: Coeffs;        // average 9-parameter trajectory fit
}

export interface Pitcher {
  id: string;
  name: string;
  throws: "Right" | "Left";
  season: string;
  pitches: ArsenalPitch[];
}

export interface DataFile {
  generated: string;     // ISO date the file was built
  dataThrough: string;   // last game date in the data
  sample: boolean;       // true = made-up pitchers, safe to show publicly
  pitchers: Pitcher[];
}
