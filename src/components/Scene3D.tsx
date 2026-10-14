import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DECISION_X, PLATE_X, posAtDist, trajectoryPoints, type Coeffs, type Point } from "../lib/physics";
import { ZONE } from "../lib/grid";

// Scene axes: x = side (PlateLocSide sign), y = height, z = distance from the back tip of the plate.
// Looking from behind the plate toward the mound (+z), +x (third-base side) is on the left,
// which is the catcher's view of PlateLocSide.
const toVec = (p: Point) => new THREE.Vector3(p.side, p.height, p.dist);

export type CameraPreset = "catcher" | "pitcher" | "rhh" | "lhh" | "side" | "overhead";

export const CAMERA_PRESETS: Record<CameraPreset, { label: string; pos: [number, number, number]; target: [number, number, number] }> = {
  catcher: { label: "Catcher", pos: [0, 2.9, -4.2], target: [0, 3.1, 30] },
  rhh: { label: "Right-handed hitter", pos: [2.4, 5.0, 0.6], target: [0, 3.6, 40] },
  lhh: { label: "Left-handed hitter", pos: [-2.4, 5.0, 0.6], target: [0, 3.6, 40] },
  pitcher: { label: "Pitcher", pos: [0, 7.2, 68], target: [0, 2.8, 0] },
  side: { label: "Side", pos: [-78, 5, 30], target: [0, 3.5, 30] },
  overhead: { label: "Overhead", pos: [0, 48, 29.9], target: [0, 0, 30] },
};

export interface SceneTrack {
  coeffs: Coeffs;
  color: string;
  dashed?: boolean;
}

interface Props {
  last: SceneTrack | null;
  next: SceneTrack | null;
  aim: Point | null;
  aimColor: string;
  camera: CameraPreset;
}

const STAGE = 0x0f2440;
const GOLD = 0xeaaa00;

function buildField(scene: THREE.Scene) {
  scene.background = new THREE.Color(STAGE);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-12, 30, -10);
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 80), new THREE.MeshStandardMaterial({ color: 0x163a63 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.01, 30);
  scene.add(ground);
  const grid = new THREE.GridHelper(80, 40, 0x27507f, 0x1d4572);
  grid.position.set(0, 0, 30);
  scene.add(grid);

  // Home plate, front edge at PLATE_X, point at the back tip (z = 0).
  const hw = 8.5 / 12;
  const plate = new THREE.Shape();
  plate.moveTo(-hw, PLATE_X); plate.lineTo(hw, PLATE_X); plate.lineTo(hw, 8.5 / 12); plate.lineTo(0, 0); plate.lineTo(-hw, 8.5 / 12); plate.closePath();
  const plateMesh = new THREE.Mesh(new THREE.ShapeGeometry(plate), new THREE.MeshStandardMaterial({ color: 0xf4f6fa, side: THREE.DoubleSide }));
  plateMesh.rotation.x = Math.PI / 2;
  plateMesh.position.y = 0.01;
  scene.add(plateMesh);

  // Strike zone frame at the plate's front edge.
  const zw = ZONE.halfWidth * 2, zh = ZONE.top - ZONE.bottom;
  const zone = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(zw, zh)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
  );
  zone.position.set(0, (ZONE.top + ZONE.bottom) / 2, PLATE_X);
  scene.add(zone);

  // Decision plane at 23.8 ft.
  const plane = new THREE.Group();
  plane.add(new THREE.Mesh(new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })));
  plane.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(6, 6)),
    new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55 })));
  plane.position.set(0, 3, DECISION_X);
  scene.add(plane);

  // Mound and rubber.
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 48), new THREE.MeshStandardMaterial({ color: 0x24456c }));
  mound.position.set(0, 0.3, 60.5);
  scene.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0xf4f6fa }));
  rubber.position.set(0, 0.63, 60.5);
  scene.add(rubber);
}

function trackGroup(t: SceneTrack): THREE.Group {
  const g = new THREE.Group();
  const pts = trajectoryPoints(t.coeffs).map(toVec);
  if (pts.length < 2) return g;
  const color = new THREE.Color(t.color);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, t.dashed ? 0.028 : 0.04, 8, false),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, transparent: !!t.dashed, opacity: t.dashed ? 0.6 : 1 }),
  );
  g.add(tube);
  const ball = (p: Point | null) => {
    if (!p) return;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.121, 20, 20), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    m.position.copy(toVec(p));
    g.add(m);
  };
  ball(posAtDist(t.coeffs, DECISION_X));
  ball(posAtDist(t.coeffs, PLATE_X));
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

export default function Scene3D({ last, next, aim, aimColor, camera }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    scene: THREE.Scene; cam: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer; dynamic: THREE.Group;
  } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    buildField(scene);
    const dynamic = new THREE.Group();
    scene.add(dynamic);
    const cam = new THREE.PerspectiveCamera(34, 1, 0.05, 400);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    ctx.current = { scene, cam, controls, renderer, dynamic };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / Math.max(h, 1);
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
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
    c.dynamic.children.slice().forEach((o) => { c.dynamic.remove(o); dispose(o); });
    if (last) c.dynamic.add(trackGroup(last));
    if (next) c.dynamic.add(trackGroup(next));
    if (last && next) {
      const a = posAtDist(last.coeffs, DECISION_X), b = posAtDist(next.coeffs, DECISION_X);
      if (a && b) {
        c.dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toVec(a), toVec(b)]),
          new THREE.LineBasicMaterial({ color: GOLD })));
      }
    }
    if (aim) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 10, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(aimColor) }));
      ring.position.copy(toVec(aim));
      c.dynamic.add(ring);
    }
  }, [last, next, aim, aimColor]);

  return <div className="scene" ref={host} role="img" aria-label="3D view of the two pitch trajectories from release to the plate" />;
}
