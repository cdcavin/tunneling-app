import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DECISION_X, PLATE_X, posAtDist, posAtTime, timeAtDist, type Coeffs, type Point } from "../lib/physics";
import { ZONE, type Cell, type Loc } from "../lib/grid";

// Scene axes: x = side (PlateLocSide sign), y = height, z = distance from the back tip of the plate.
// From behind the plate looking out at the mound (+z), +x (third-base side) is on the left,
// which is the catcher's view of PlateLocSide.
const toVec = (p: Point) => new THREE.Vector3(p.side, p.height, p.dist);

export type CameraPreset = "catcher" | "pitcher" | "rhh" | "lhh" | "side" | "overhead";

export const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  catcher: { label: "Catcher", pos: [0, 3.6, -11], target: [0, 2.9, 30] },
  rhh: { label: "RHH", pos: [3.4, 5.4, -2.5], target: [0, 2.8, 22] },
  lhh: { label: "LHH", pos: [-3.4, 5.4, -2.5], target: [0, 2.8, 22] },
  pitcher: { label: "Pitcher", pos: [0, 7.2, 68], target: [0, 2.8, 0] },
  side: { label: "Side", pos: [-78, 5, 30], target: [0, 3.5, 30] },
  overhead: { label: "Overhead", pos: [0, 48, 29.9], target: [0, 0, 30] },
};

export interface SceneTrack { coeffs: Coeffs; color: string; dashed?: boolean }

export interface HeatLayer {
  cells: Cell[];
  value: (c: Cell) => number;
  better: "low" | "high";
}

interface Props {
  last: SceneTrack | null;
  next: SceneTrack | null;
  aim: Point | null;
  aimColor: string;
  camera: CameraPreset;
  heat: HeatLayer | null;
  selected: Loc | null;
  anchorLoc: Loc | null;
  anchorColor: string;
  best: Loc | null;
  onPick: (loc: Loc) => void;
  /** Flight clock: null = show full paths; a number = seconds since release, balls in flight. */
  flightTime: number | null;
}

const SKY = 0x0a1322;
const GOLD = 0xeaaa00;
// Sequential blue ramp from the validated palette, light (worse) to dark (better).
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#184f95", "#104281"].map((c) => new THREE.Color(c));

function buildField(scene: THREE.Scene) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 70, 160);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a2a12, 0.9));
  const key = new THREE.DirectionalLight(0xfff2d6, 1.1);
  key.position.set(-18, 40, -14);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db6ff, 0.35);
  fill.position.set(20, 12, 50);
  scene.add(fill);

  // Grass, then the dirt around the plate and the mound.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: 0x173a22, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.02, 40);
  scene.add(grass);
  const dirt = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 });
  const plateDirt = new THREE.Mesh(new THREE.CircleGeometry(13, 64), dirt);
  plateDirt.rotation.x = -Math.PI / 2;
  plateDirt.position.set(0, -0.01, 0.5);
  scene.add(plateDirt);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.83, 64), dirt);
  mound.position.set(0, 0.41, 60.5);
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.5), new THREE.MeshStandardMaterial({ color: 0xf4f6fa }));
  rubber.position.set(0, 0.86, 60.5);
  scene.add(rubber);
  // Batter's boxes.
  const chalk = new THREE.LineBasicMaterial({ color: 0xdfe6f0, transparent: true, opacity: 0.6 });
  for (const sx of [1, -1]) {
    const box = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(sx * 1.2, 0.005, -2.5), new THREE.Vector3(sx * 5.2, 0.005, -2.5),
      new THREE.Vector3(sx * 5.2, 0.005, 3.5), new THREE.Vector3(sx * 1.2, 0.005, 3.5), new THREE.Vector3(sx * 1.2, 0.005, -2.5),
    ]);
    scene.add(new THREE.Line(box, chalk));
  }

  // Home plate: front edge at PLATE_X, point at the back tip (z = 0).
  const hw = 8.5 / 12;
  const plate = new THREE.Shape();
  plate.moveTo(-hw, PLATE_X); plate.lineTo(hw, PLATE_X); plate.lineTo(hw, 8.5 / 12); plate.lineTo(0, 0); plate.lineTo(-hw, 8.5 / 12); plate.closePath();
  const plateMesh = new THREE.Mesh(new THREE.ShapeGeometry(plate), new THREE.MeshStandardMaterial({ color: 0xf4f6fa, side: THREE.DoubleSide }));
  plateMesh.rotation.x = Math.PI / 2;
  plateMesh.position.y = 0.012;
  scene.add(plateMesh);

  // Strike zone at the plate's front edge, with thirds.
  const zw = ZONE.halfWidth * 2, zh = ZONE.top - ZONE.bottom, zy = (ZONE.top + ZONE.bottom) / 2;
  const zone = new THREE.Group();
  zone.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(zw, zh)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })));
  const thirds = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
  for (let i = 1; i < 3; i++) {
    const x = -zw / 2 + (i * zw) / 3, y = -zh / 2 + (i * zh) / 3;
    zone.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -zh / 2, 0), new THREE.Vector3(x, zh / 2, 0)]), thirds));
    zone.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-zw / 2, y, 0), new THREE.Vector3(zw / 2, y, 0)]), thirds));
  }
  zone.position.set(0, zy, PLATE_X);
  scene.add(zone);

  // Decision plane at 23.8 ft.
  const plane = new THREE.Group();
  plane.add(new THREE.Mesh(new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false })));
  plane.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(7, 7)),
    new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6 })));
  plane.position.set(0, 3.5, DECISION_X);
  scene.add(plane);
}

function ballMesh(color: THREE.Color, r = 0.121) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.35 }));
}

function trackGroup(t: SceneTrack, flightTime: number | null): THREE.Group {
  const g = new THREE.Group();
  const color = new THREE.Color(t.color);
  const tEnd = timeAtDist(t.coeffs, PLATE_X);
  if (tEnd == null) return g;
  const tDraw = flightTime == null ? tEnd : Math.min(flightTime, tEnd);
  const n = Math.max(2, Math.round(120 * (tDraw / tEnd)));
  const pts = Array.from({ length: n + 1 }, (_, i) => toVec(posAtTime(t.coeffs, (i / n) * tDraw)));
  if (pts.length >= 2 && tDraw > 0.01) {
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(8, n), t.dashed ? 0.026 : 0.038, 10, false),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: !!t.dashed, opacity: t.dashed ? 0.55 : 1, roughness: 0.5 }),
    );
    g.add(tube);
  }
  if (flightTime == null) {
    const d = posAtDist(t.coeffs, DECISION_X);
    if (d) { const m = ballMesh(color, 0.1); m.position.copy(toVec(d)); g.add(m); }
    const m = ballMesh(color); m.position.copy(toVec(posAtTime(t.coeffs, tEnd))); g.add(m);
  } else {
    const p = posAtTime(t.coeffs, tDraw);
    const m = ballMesh(color, 0.125); m.position.copy(toVec(p)); g.add(m);
    // Shadow dot on the ground under the ball.
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(p.side, 0.02, p.dist);
    g.add(sh);
  }
  return g;
}

function dispose(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}

const STEP = 0.25;

/** The next-pitch heat grid as colored tiles standing at the plate's front edge. */
function heatGroup(heat: HeatLayer, selected: Loc | null, best: Loc | null, anchor: Loc | null, anchorColor: string): { group: THREE.Group; tiles: THREE.Mesh[] } {
  const group = new THREE.Group();
  const tiles: THREE.Mesh[] = [];
  let lo = Infinity, hi = -Infinity;
  for (const c of heat.cells) { const v = heat.value(c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const geo = new THREE.PlaneGeometry(STEP - 0.03, STEP - 0.03);
  for (const c of heat.cells) {
    let f = hi - lo < 1e-9 ? 0 : (heat.value(c) - lo) / (hi - lo);
    if (heat.better === "low") f = 1 - f;
    const col = RAMP[Math.min(RAMP.length - 1, Math.floor(f * RAMP.length))];
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(c.side, c.height, PLATE_X + 0.04);
    m.userData.loc = { side: c.side, height: c.height };
    group.add(m);
    tiles.push(m);
  }
  const ring = (loc: Loc, color: number, r: number) => {
    const o = new THREE.Mesh(new THREE.RingGeometry(r - 0.03, r, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false }));
    o.position.set(loc.side, loc.height, PLATE_X + 0.03);
    group.add(o);
  };
  if (best) ring(best, GOLD, 0.15);
  if (anchor) ring(anchor, new THREE.Color(anchorColor).getHex(), 0.13);
  if (selected) ring(selected, 0xffffff, 0.1);
  return { group, tiles };
}

export default function Scene3D({ last, next, aim, aimColor, camera, heat, selected, anchorLoc, anchorColor, best, onPick, flightTime }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    scene: THREE.Scene; cam: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer;
    tracks: THREE.Group; heatG: THREE.Group; tiles: THREE.Mesh[];
  } | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    buildField(scene);
    const tracks = new THREE.Group(), heatG = new THREE.Group();
    scene.add(tracks, heatG);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.05, 400);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    ctx.current = { scene, cam, controls, renderer, tracks, heatG, tiles: [] };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / Math.max(h, 1);
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Click a heat tile to pick the next-pitch location. Ignore drags.
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const c = ctx.current; if (!c || !c.tiles.length) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), c.cam);
      const hit = ray.intersectObjects(c.tiles, false)[0];
      if (hit) pickRef.current(hit.object.userData.loc as Loc);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      dispose(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const p = CAMERA_PRESETS[camera];
    c.cam.position.set(...p.pos);
    c.controls.target.set(...p.target);
    c.controls.update();
  }, [camera]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.tracks.children.slice().forEach((o) => { c.tracks.remove(o); dispose(o); });
    if (last) c.tracks.add(trackGroup(last, flightTime));
    if (next) c.tracks.add(trackGroup(next, flightTime));
    if (last && next && flightTime == null) {
      const a = posAtDist(last.coeffs, DECISION_X), b = posAtDist(next.coeffs, DECISION_X);
      if (a && b) c.tracks.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toVec(a), toVec(b)]), new THREE.LineBasicMaterial({ color: GOLD })));
    }
    if (aim) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 10, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(aimColor) }));
      ring.position.copy(toVec(aim));
      c.tracks.add(ring);
    }
  }, [last, next, aim, aimColor, flightTime]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.heatG.children.slice().forEach((o) => { c.heatG.remove(o); dispose(o); });
    c.tiles = [];
    if (heat) {
      const { group, tiles } = heatGroup(heat, selected, best, anchorLoc, anchorColor);
      c.heatG.add(group);
      c.tiles = tiles;
    }
  }, [heat, selected, best, anchorLoc, anchorColor]);

  return <div className="scene" ref={host} role="img" aria-label="3D view of the two pitch trajectories from release to the plate" />;
}
