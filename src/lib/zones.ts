import { ZONE } from "./grid";

/**
 * The 13 location zones used on broadcasts and Baseball Savant, from the catcher's view:
 *
 *    11 |  1  2  3 | 12        1-9: the strike zone in thirds (1 = up and toward third, 9 = down and toward first)
 *       |  4  5  6 |           11-14: outside the zone, by quadrant (11 up/3B side, 12 up/1B side,
 *    13 |  7  8  9 | 14                                            13 down/3B side, 14 down/1B side)
 *
 * Side follows the rest of the app: + side = third-base side = catcher's left. The zone is the app's ZONE
 * (plate plus a ball on each edge, 1.5 to 3.5 ft).
 */
export type Zone = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 11 | 12 | 13 | 14;
export const IN_ZONES: Zone[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const OUT_ZONES: Zone[] = [11, 12, 13, 14];

export function zoneOf(side: number, height: number): Zone {
  const { halfWidth: w, bottom, top } = ZONE;
  const mid = (bottom + top) / 2;
  if (Math.abs(side) > w || height > top || height < bottom) {
    const left = side > 0, up = height > mid;
    return up ? (left ? 11 : 12) : left ? 13 : 14;
  }
  const third = (2 * w) / 3, row = (top - bottom) / 3;
  const col = side > w - third ? 0 : side < -w + third ? 2 : 1;
  const r = height > top - row ? 0 : height < bottom + row ? 2 : 1;
  return (r * 3 + col + 1) as Zone;
}
