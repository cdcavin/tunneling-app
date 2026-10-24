/**
 * Body tracking for the video overlay, run in the browser.
 *
 * Model: ViTPose (base, "simple"), via Transformers.js. Given a box around one person it returns 17 body points
 * (COCO order: nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles) with a confidence for each.
 * The model files are served from this site (/models/…, copied into R2 by the "models" workflow), so nothing is
 * fetched from Hugging Face; the library itself comes from jsDelivr. Both load only when Align is pressed, and the
 * browser keeps them for next time.
 */

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
const MODEL = "onnx-community/vitpose-base-simple";

export interface Kp { x: number; y: number; s: number }          // full-frame pixels, confidence 0..1
export type Box = [number, number, number, number];               // x1, y1, x2, y2 in full-frame pixels

// COCO keypoint indices
export const K = { nose: 0, lSho: 5, rSho: 6, lElb: 7, rElb: 8, lWri: 9, rWri: 10, lHip: 11, rHip: 12, lKne: 13, rKne: 14, lAnk: 15, rAnk: 16 };

export interface PoseModel { estimate(frame: HTMLCanvasElement, box: Box): Promise<Kp[]>; device: string }

let loading: Promise<PoseModel> | null = null;

/** Load the library and model once per page (later calls reuse it). */
export function loadPose(onProgress?: (msg: string) => void): Promise<PoseModel> {
  if (loading) return loading;
  loading = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const T: any = await import(/* @vite-ignore */ LIB);
    T.env.allowLocalModels = false;
    T.env.remoteHost = `${location.origin}/models/`;
    T.env.remotePathTemplate = "{model}/";
    let device = "wasm";
    try { if ("gpu" in navigator && (await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter())) device = "webgpu"; } catch { /* no GPU */ }
    const files: Record<string, [number, number]> = {};
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file || !p.total) return;
      files[p.file] = [p.loaded ?? 0, p.total];
      const [l, t] = Object.values(files).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
      onProgress?.(`Loading body tracking (first time only, ${Math.round(t / 1e6)} MB)… ${Math.round((100 * l) / t)}%`);
    };
    const model = await T.AutoModel.from_pretrained(MODEL, { dtype: device === "webgpu" ? "fp16" : "int8", device, progress_callback });
    const proc = await T.AutoImageProcessor.from_pretrained(MODEL);
    const crop = document.createElement("canvas");
    return {
      device,
      async estimate(frame, box) {
        const [x1, y1, x2, y2] = clampBox(box, frame.width, frame.height);
        crop.width = Math.max(8, Math.round(x2 - x1)); crop.height = Math.max(8, Math.round(y2 - y1));
        crop.getContext("2d")!.drawImage(frame, x1, y1, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const { heatmaps } = await model(await proc(T.RawImage.fromCanvas(crop)));
        const r = proc.post_process_pose_estimation(heatmaps, [[[0, 0, crop.width, crop.height]]])[0][0];
        const sc: number[] = Array.from(r.scores as ArrayLike<number>);
        return (r.keypoints as number[][]).map(([x, y], i) => ({ x: x1 + x, y: y1 + y, s: sc[i] }));
      },
    };
  })();
  loading.catch(() => { loading = null; });   // let a later press retry after a failed load
  return loading;
}

export function clampBox([x1, y1, x2, y2]: Box, w: number, h: number): Box {
  return [Math.max(0, x1), Math.max(0, y1), Math.min(w, x2), Math.min(h, y2)];
}

/** Box around the confident points, padded, shaped 3:4 (what ViTPose expects). */
export function boxAround(kp: Kp[], pad = 0.3, minScore = 0.3): Box | null {
  const pts = kp.filter((p) => p.s >= minScore);
  if (pts.length < 6) return null;
  let x1 = Math.min(...pts.map((p) => p.x)), x2 = Math.max(...pts.map((p) => p.x));
  let y1 = Math.min(...pts.map((p) => p.y)), y2 = Math.max(...pts.map((p) => p.y));
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  let w = (x2 - x1) * (1 + 2 * pad), h = (y2 - y1) * (1 + 2 * pad);
  if (w / h < 0.75) w = 0.75 * h; else h = w / 0.75;
  x1 = cx - w / 2; x2 = cx + w / 2; y1 = cy - h / 2; y2 = cy + h / 2;
  return [x1, y1, x2, y2];
}

/** Mean confidence of the trunk (nose, shoulders, hips): is this a clearly seen person? */
export const trunkScore = (kp: Kp[]) => [K.nose, K.lSho, K.rSho, K.lHip, K.rHip].reduce((s, i) => s + kp[i].s, 0) / 5;

/** Standing upright (not a crouched catcher): tall box, ankles well below hips. */
export function standing(kp: Kp[]): boolean {
  const hipY = (kp[K.lHip].y + kp[K.rHip].y) / 2, ankY = (kp[K.lAnk].y + kp[K.rAnk].y) / 2, shoY = (kp[K.lSho].y + kp[K.rSho].y) / 2;
  return ankY - hipY > 0.8 * (hipY - shoY);
}

/**
 * Zoom s and shift t (no rotation) that best put points b on points a, weighted least squares, with points
 * measured from the frame centre c: a - c ≈ s (b - c) + t. Returns the fit and the weighted RMS error (px).
 */
export function fitZoomShift(a: { x: number; y: number }[], b: { x: number; y: number }[], w: number[], c: { x: number; y: number }) {
  let W = 0, max = 0, may = 0, mbx = 0, mby = 0;
  for (let i = 0; i < a.length; i++) { W += w[i]; max += w[i] * (a[i].x - c.x); may += w[i] * (a[i].y - c.y); mbx += w[i] * (b[i].x - c.x); mby += w[i] * (b[i].y - c.y); }
  max /= W; may /= W; mbx /= W; mby /= W;
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) {
    const ax = a[i].x - c.x - max, ay = a[i].y - c.y - may, bx = b[i].x - c.x - mbx, by = b[i].y - c.y - mby;
    num += w[i] * (ax * bx + ay * by); den += w[i] * (bx * bx + by * by);
  }
  const s = den > 0 ? num / den : 1;
  const tx = max - s * mbx, ty = may - s * mby;
  let e = 0;
  for (let i = 0; i < a.length; i++) {
    const px = s * (b[i].x - c.x) + tx + c.x, py = s * (b[i].y - c.y) + ty + c.y;
    e += w[i] * ((px - a[i].x) ** 2 + (py - a[i].y) ** 2);
  }
  return { s, tx, ty, rms: Math.sqrt(e / W) };
}

/** Throwing-arm points for a right- or left-hander (COCO left/right are the person's own). */
export const armOf = (throws: string) => (throws === "Left" ? { sho: K.lSho, elb: K.lElb, wri: K.lWri } : { sho: K.rSho, elb: K.rElb, wri: K.rWri });

/** Arm described relative to the body: elbow and wrist from the shoulder, in torso lengths (so camera zoom drops out). */
export function armShape(kp: Kp[], throws: string): number[] {
  const arm = armOf(throws);
  const sx = (kp[K.lSho].x + kp[K.rSho].x) / 2, sy = (kp[K.lSho].y + kp[K.rSho].y) / 2;
  const hx = (kp[K.lHip].x + kp[K.rHip].x) / 2, hy = (kp[K.lHip].y + kp[K.rHip].y) / 2;
  const torso = Math.hypot(sx - hx, sy - hy) || 1;
  const o = kp[arm.sho];
  return [(kp[arm.elb].x - o.x) / torso, (kp[arm.elb].y - o.y) / torso, (kp[arm.wri].x - o.x) / torso, (kp[arm.wri].y - o.y) / torso];
}

/** Angle (degrees) of the shoulder-to-wrist line of the throwing arm. */
export function armAngle(kp: Kp[], throws: string): number {
  const a = armOf(throws);
  return (Math.atan2(kp[a.wri].y - kp[a.sho].y, kp[a.wri].x - kp[a.sho].x) * 180) / Math.PI;
}

/**
 * Pick the frame in each clip where the arms match best, staying near Trackman's release:
 * cost = arm-shape distance + a small penalty per frame away from release in either clip.
 */
export function bestArmPair(aShapes: (number[] | null)[], bShapes: (number[] | null)[], aOff: number[], bOff: number[], perFrame = 0.04) {
  let best = { i: -1, j: -1, cost: Infinity };
  for (let i = 0; i < aShapes.length; i++) for (let j = 0; j < bShapes.length; j++) {
    const A = aShapes[i], B = bShapes[j];
    if (!A || !B) continue;
    const d = Math.hypot(...A.map((v, k) => v - B[k])) + perFrame * (Math.abs(aOff[i]) + Math.abs(bOff[j]));
    if (d < best.cost) best = { i, j, cost: d };
  }
  return best;
}

/** Shift only (zoom s given): weighted mean of a - c - s (b - c). Returns the shift and the weighted RMS error (px). */
export function fitShift(a: { x: number; y: number }[], b: { x: number; y: number }[], w: number[], c: { x: number; y: number }, s: number) {
  let W = 0, tx = 0, ty = 0;
  for (let i = 0; i < a.length; i++) { W += w[i]; tx += w[i] * (a[i].x - c.x - s * (b[i].x - c.x)); ty += w[i] * (a[i].y - c.y - s * (b[i].y - c.y)); }
  tx /= W; ty /= W;
  let e = 0;
  for (let i = 0; i < a.length; i++) e += w[i] * ((s * (b[i].x - c.x) + tx + c.x - a[i].x) ** 2 + (s * (b[i].y - c.y) + ty + c.y - a[i].y) ** 2);
  return { s, tx, ty, rms: Math.sqrt(e / W) };
}
