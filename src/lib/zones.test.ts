import { describe, expect, it } from "vitest";
import { zoneOf } from "./zones";

describe("zoneOf", () => {
  it("splits the zone in thirds, catcher's view (+ side = third-base side = left)", () => {
    expect(zoneOf(0, 2.5)).toBe(5);
    expect(zoneOf(0.6, 3.3)).toBe(1);
    expect(zoneOf(-0.6, 3.3)).toBe(3);
    expect(zoneOf(0.6, 1.6)).toBe(7);
    expect(zoneOf(-0.6, 1.6)).toBe(9);
    expect(zoneOf(0, 1.7)).toBe(8);
  });
  it("puts misses in the outer quadrants", () => {
    expect(zoneOf(1.2, 3.0)).toBe(11);
    expect(zoneOf(-1.2, 3.0)).toBe(12);
    expect(zoneOf(0.2, 0.8)).toBe(13);
    expect(zoneOf(-0.2, 0.8)).toBe(14);
    expect(zoneOf(-0.1, 4.2)).toBe(12);
  });
});
