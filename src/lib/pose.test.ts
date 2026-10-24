import { describe, expect, it } from "vitest";
import { armShape, bestArmPair, boxAround, fitZoomShift, type Kp } from "./pose";

const c = { x: 640, y: 360 };
// a fake standing person (17 COCO points) at (x0, y0) with height h
function person(x0: number, y0: number, h: number, wrist: [number, number] = [0.25, -0.1]): Kp[] {
  const P: [number, number][] = [[0, 0], [-0.02, -0.02], [0.02, -0.02], [-0.05, 0], [0.05, 0], [-0.1, 0.15], [0.1, 0.15], [-0.15, 0.3], [0.2, 0.05],
    [-0.15, 0.45], wrist, [-0.08, 0.5], [0.08, 0.5], [-0.1, 0.75], [0.1, 0.75], [-0.1, 1], [0.1, 1]];
  return P.map(([x, y]) => ({ x: x0 + x * h, y: y0 + y * h, s: 0.9 }));
}

describe("fitZoomShift", () => {
  it("recovers zoom and shift exactly", () => {
    const a = person(500, 300, 200);
    // b = the same person seen by a camera that's moved and zoomed: a - c = s (b - c) + t  =>  b = c + (a - c - t) / s
    const s = 1.05, t = { x: 30, y: -12 };
    const b = a.map((p) => ({ x: c.x + (p.x - c.x - t.x) / s, y: c.y + (p.y - c.y - t.y) / s, s: 0.9 }));
    const f = fitZoomShift(a, b, a.map(() => 1), c);
    expect(f.s).toBeCloseTo(1.05, 6); expect(f.tx).toBeCloseTo(30, 4); expect(f.ty).toBeCloseTo(-12, 4); expect(f.rms).toBeLessThan(1e-6);
  });
});

describe("armShape / bestArmPair", () => {
  it("is the same for the same pose at any size or place", () => {
    const a = armShape(person(500, 300, 200), "Right"), b = armShape(person(100, 50, 120), "Right");
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  });
  it("picks the frames whose arms match", () => {
    const A = [[0.15, 0.25], [0.25, -0.1], [0.3, -0.3]].map((w) => armShape(person(0, 0, 100, w as [number, number]), "Right"));
    const B = [[0.1, 0.3], [0.2, 0.1], [0.25, -0.1]].map((w) => armShape(person(0, 0, 100, w as [number, number]), "Right"));
    const r = bestArmPair(A, B, [-1, 0, 1], [-1, 0, 1]);
    expect([r.i, r.j]).toEqual([1, 2]);
  });
});

describe("boxAround", () => {
  it("pads to a 3:4 box around the person", () => {
    const [x1, y1, x2, y2] = boxAround(person(500, 300, 200))!;
    expect((x2 - x1) / (y2 - y1)).toBeCloseTo(0.75, 6);
    expect(x1).toBeLessThan(470); expect(y2).toBeGreaterThan(500);
  });
});

import { fitShift } from "./pose";
describe("fitShift", () => {
  it("recovers the shift for a known zoom", () => {
    const a = person(500, 300, 200), s = 1.02, t = { x: -40, y: 9 };
    const b = a.map((p) => ({ x: c.x + (p.x - c.x - t.x) / s, y: c.y + (p.y - c.y - t.y) / s, s: 0.9 }));
    const f = fitShift(a, b, a.map(() => 1), c, s);
    expect(f.tx).toBeCloseTo(-40, 6); expect(f.ty).toBeCloseTo(9, 6); expect(f.rms).toBeLessThan(1e-6);
  });
});
