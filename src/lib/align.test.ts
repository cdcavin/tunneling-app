import { describe, expect, it } from "vitest";
import { alignFrames, type Gray } from "./align";

const W = 256, H = 144;
// A synthetic "ballpark": rows of seats, a wall line, a logo-ish blob, field lines. f(x, y) in frame pixels.
function scene(seed: number) {
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const rects = Array.from({ length: 40 }, () => ({ x: r() * W, y: r() * H * 0.6, w: 4 + r() * 20, h: 3 + r() * 8, v: r() }));
  return (x: number, y: number) => {
    let v = 0.3 + 0.1 * Math.sin(x / 9) * Math.sin(y / 7);
    for (const q of rects) if (x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h) v = q.v;
    if (Math.abs(y - 0.62 * H) < 2) v = 0.95;                       // wall
    if ((x - 0.4 * W) ** 2 / 300 + (y - 0.55 * H) ** 2 / 80 < 1) v = 0.8; // logo
    if (Math.abs((y - 0.85 * H) - 0.3 * (x - W / 2)) < 1.5) v = 1;   // foul line
    return v;
  };
}
function render(f: (x: number, y: number) => number, s = 1, tx = 0, ty = 0, occlude = false): Gray {
  // B(p) = A(s * (p - c) + c + t): what the moved/zoomed camera sees
  const data = new Float32Array(W * H), cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = f(s * (x - cx) + cx + tx, s * (y - cy) + cy + ty);
    if (occlude && (x - 140) ** 2 + (y - 90) ** 2 < 220) v = 0.1;   // a "player" in a different spot
    data[y * W + x] = v;
  }
  return { w: W, h: H, data };
}

describe("alignFrames", () => {
  const f = scene(7);
  const A = render(f);

  it("recovers a shift and zoom (camera moved and zoomed)", () => {
    const B = render(f, 1.04, 12, -5, true);
    const r = alignFrames(A, B);
    expect(r.verdict).toBe("apply");
    expect(r.scale).toBeCloseTo(1.04, 2);
    expect(r.dx * W).toBeCloseTo(12, 0);
    expect(r.dy * H).toBeCloseTo(-5, 0);
    expect(r.after).toBeGreaterThan(r.before);
  });

  it("recovers a pure sideways shift", () => {
    const r = alignFrames(A, render(f, 1, -20, 0));
    expect(r.verdict).toBe("apply");
    expect(r.scale).toBeCloseTo(1, 2);
    expect(r.dx * W).toBeCloseTo(-20, 0);
  });

  it("leaves clips that already line up alone", () => {
    expect(alignFrames(A, render(f, 1, 0, 0, true)).verdict).toBe("already");
  });

  it("won't apply anything for a different scene", () => {
    expect(alignFrames(A, render(scene(99))).verdict).not.toBe("apply");
  });
});
