/**
 * Auto-align two video frames that show the same scene from a camera that moved or zoomed a little.
 *
 * Finds the zoom s and shift t that best map frame B onto frame A:  A(s * p + t) ≈ B(p), with p measured from
 * the frame centre. That is exactly the CSS `translate(t) scale(s)` (origin: centre) to put on B.
 *
 * How: both frames are reduced to edge maps (so lighting and colour differences matter less), then for a range
 * of zooms B is rescaled and *phase correlation* (an FFT trick that finds the best shift in one step) gives the
 * shift and how strong the match is. The best zoom wins, refined in a second, finer pass.
 * Guard rails: a result is only "confident" when the match is clearly better than leaving B where it is.
 */

export interface Gray { w: number; h: number; data: Float32Array }

export interface AlignResult {
  scale: number;      // zoom to apply to B (1 = none)
  dx: number;         // shift to apply to B, as a fraction of the frame width (+ = right)
  dy: number;         // ... of the frame height (+ = down)
  peak: number;       // phase-correlation peak (match strength)
  before: number;     // edge-map correlation with no change
  after: number;      // edge-map correlation after the change
  verdict: "apply" | "already" | "unsure";
}

const N = 256;   // FFT size (frames are padded into N x N)

/** RGBA pixels -> gray 0..1 */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return { w, h, data };
}

/** Gradient magnitude (Sobel). */
function edges(g: Gray): Gray {
  const { w, h, data } = g, out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
    const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
    out[i] = Math.hypot(gx, gy);
  }
  return { w, h, data: out };
}

/** B zoomed by s about the centre: out(q) = B(c + (q - c) / s), bilinear, 0 outside. */
function zoom(g: Gray, s: number, dx = 0, dy = 0): Gray {
  const { w, h, data } = g, out = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = cx + (x - dx - cx) / s, sy = cy + (y - dy - cy) / s;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
    const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * w + x] = data[i] * (1 - fx) * (1 - fy) + data[i + 1] * fx * (1 - fy) + data[i + w] * (1 - fx) * fy + data[i + w + 1] * fx * fy;
  }
  return { w, h, data: out };
}

/** Mean-removed, Hann-windowed, zero-padded into N x N (real part). */
function prep(g: Gray): Float64Array {
  const { w, h, data } = g;
  let m = 0; for (let i = 0; i < w * h; i++) m += data[i]; m /= w * h;
  const re = new Float64Array(N * N);
  for (let y = 0; y < h; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (h - 1));
    for (let x = 0; x < w; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (w - 1));
      re[y * N + x] = (data[y * w + x] - m) * wx * wy;
    }
  }
  return re;
}

/** In-place radix-2 FFT on rows then columns. */
function fft2(re: Float64Array, im: Float64Array, inverse: boolean) {
  const row = (off: number, stride: number) => {
    // bit reversal
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        const a = off + i * stride, b = off + j * stride;
        [re[a], re[b]] = [re[b], re[a]]; [im[a], im[b]] = [im[b], im[a]];
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = off + (i + k) * stride, b = off + (i + k + len / 2) * stride;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  };
  for (let y = 0; y < N; y++) row(y * N, 1);
  for (let x = 0; x < N; x++) row(x, N);
  if (inverse) for (let i = 0; i < N * N; i++) { re[i] /= N * N; im[i] /= N * N; }
}

function spectrum(g: Gray) {
  const re = prep(g), im = new Float64Array(N * N);
  fft2(re, im, false);
  return { re, im };
}

/** Phase correlation: the shift d with A(x) ≈ B(x - d), sub-pixel, and the peak height. */
function phaseCorr(A: { re: Float64Array; im: Float64Array }, B: { re: Float64Array; im: Float64Array }) {
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const r = A.re[i] * B.re[i] + A.im[i] * B.im[i], q = A.im[i] * B.re[i] - A.re[i] * B.im[i];
    const m = Math.hypot(r, q) + 1e-12;
    re[i] = r / m; im[i] = q / m;
  }
  fft2(re, im, true);
  let best = 0, bi = 0;
  for (let i = 0; i < N * N; i++) if (re[i] > best) { best = re[i]; bi = i; }
  const px = bi % N, py = Math.floor(bi / N);
  const at = (x: number, y: number) => re[((y + N) % N) * N + ((x + N) % N)];
  const sub = (l: number, c: number, r: number) => { const d = l - 2 * c + r; return Math.abs(d) < 1e-12 ? 0 : (0.5 * (l - r)) / d; };
  let dx = px + sub(at(px - 1, py), best, at(px + 1, py)), dy = py + sub(at(px, py - 1), best, at(px, py + 1));
  if (dx > N / 2) dx -= N; if (dy > N / 2) dy -= N;
  return { dx, dy, peak: best };
}

/** Normalised correlation of two edge maps over pixels where both have content (overlap). */
function ncc(a: Gray, b: Gray): number {
  let n = 0, sa = 0, sb = 0;
  const m = (i: number) => b.data[i] !== 0 || a.data[i] === 0;
  for (let i = 0; i < a.data.length; i++) if (m(i)) { sa += a.data[i]; sb += b.data[i]; n++; }
  if (n < 50) return 0;
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.data.length; i++) if (m(i)) {
    const x = a.data[i] - ma, y = b.data[i] - mb; num += x * y; da += x * x; db += y * y;
  }
  return num / (Math.sqrt(da * db) + 1e-12);
}

/** Find the zoom + shift that maps frame B onto frame A. Frames must be the same size, at most N x N. */
export function alignFrames(a: Gray, b: Gray, opts: { minScale?: number; maxScale?: number } = {}): AlignResult {
  const ea = edges(a), eb = edges(b);
  const A = spectrum(ea);
  const lo = opts.minScale ?? 0.9, hi = opts.maxScale ?? 1.1;
  const tryScale = (s: number) => ({ s, ...phaseCorr(A, spectrum(zoom(eb, s))) });
  let best = tryScale(1);
  for (let s = lo; s <= hi + 1e-9; s += 0.01) { const r = tryScale(s); if (r.peak > best.peak) best = r; }
  for (let s = best.s - 0.009; s <= best.s + 0.009 + 1e-9; s += 0.002) { const r = tryScale(s); if (r.peak > best.peak) best = r; }

  const before = ncc(ea, eb);
  const after = ncc(ea, zoom(eb, best.s, best.dx, best.dy));
  const tiny = Math.abs(best.dx) < 1.5 && Math.abs(best.dy) < 1.5 && Math.abs(best.s - 1) < 0.006;
  const verdict = tiny ? "already" : after - before > 0.05 && after > 0.2 ? "apply" : "unsure";
  return { scale: best.s, dx: best.dx / a.w, dy: best.dy / a.h, peak: best.peak, before, after, verdict };
}

export { zoom as _zoom, edges as _edges };
