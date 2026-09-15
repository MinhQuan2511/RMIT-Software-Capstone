/**
 * Three.js scene for one canonical job revision, independent of React and of
 * the WebGL renderer so it can be built and disposed in tests.
 *
 * Every marker, line and the torch path use the backend's own waypoints,
 * segments and fitted arc. Nothing is re-derived here. The workpiece shown for
 * straight seams is an illustrative T-joint, not imported CAD; arcs and point
 * lists get a neutral scene. There is no robot model, so nothing here shows
 * reachability, joint limits, singularities or collisions.
 */

import * as THREE from "three";
import { robotToViewPosition, robotToViewDirection, torchMeshViewQuaternion, toolFrameViewQuaternion, toThreeOrder } from "../lib/viewTransform.js";
import { arcPoint } from "../lib/playback.js";
import { createSparkState, stepSparks } from "../lib/sparks.js";
import { jointIndicators } from "../lib/orientationCheck.js";

export const INDICATOR_COLOR = { travel: 0xf8fafc, normalA: 0x22c55e, normalB: 0xf59e0b, torch: 0xe879f9 };

/** Arrow owned by this scene (line + cone), so disposal never touches shared geometry. */
function ownedArrow(from, dirRobot, length, color, name) {
  const g = new THREE.Group();
  g.name = name;
  const d = new THREE.Vector3(...robotToViewDirection(dirRobot)).normalize();
  const to = from.clone().addScaledVector(d, length);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color }));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 12), new THREE.MeshBasicMaterial({ color }));
  cone.position.copy(to);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  g.add(line, cone);
  g.userData.direction = d.toArray();
  return g;
}

const ROLE_COLOR = { air: 0x64748b, approach: 0xeab308, retract: 0xa855f7, point: 0x38bdf8, weld: 0x22d3ee };
const TARGET_COLOR = { home: 0x06b6d4, approach: 0xeab308, weld_start: 0x22c55e, weld_via: 0xf97316, weld_end: 0xef4444, retract: 0xa855f7, point: 0x38bdf8 };
const BEAD_SEGMENTS = 96;
const BEAD_RADIAL = 16;

const v3 = (p) => new THREE.Vector3(...robotToViewPosition(p));
const setQuat = (obj, q) => obj.quaternion.set(...toThreeOrder(q));

/** Exact circle from the canonical arc fit, in view coordinates. */
class ArcCurve3 extends THREE.Curve {
  constructor(arc) {
    super();
    this.arc = arc;
    this.sweep = (arc.sweepDeg * Math.PI) / 180;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const p = robotToViewPosition(arcPoint(this.arc, t * this.sweep));
    return target.set(p[0], p[1], p[2]);
  }
}

function buildTorch() {
  const g = new THREE.Group();
  const add = (geo, mat, y, rotX = 0) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.rotation.x = rotX; g.add(m); return m; };
  add(new THREE.ConeGeometry(8, 24, 16), new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.2 }), 12, Math.PI);
  add(new THREE.CylinderGeometry(9.5, 11, 70, 16), new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.85, roughness: 0.25 }), 59);
  add(new THREE.CylinderGeometry(12, 12, 45, 16), new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.4, roughness: 0.6 }), 100);
  add(new THREE.TorusGeometry(12, 1.6, 12, 32), new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7 }), 28, Math.PI / 2);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
  g.add(glow);
  const light = new THREE.PointLight(0x38bdf8, 0, 450);
  g.add(light);
  return { group: g, glow, light };
}

function illustrativeTJoint(start, end) {
  const seam = new THREE.Vector3().subVectors(end, start);
  const L = Math.max(seam.length(), 10);
  const uSeam = seam.clone().normalize();
  let uWidth = new THREE.Vector3().crossVectors(uSeam, new THREE.Vector3(0, 1, 0));
  if (uWidth.lengthSq() < 1e-6) uWidth = new THREE.Vector3(0, 0, 1);
  uWidth.normalize();
  const uUp = new THREE.Vector3().crossVectors(uWidth, uSeam).normalize();
  if (uUp.y < 0) { uUp.negate(); uWidth.negate(); }
  const group = new THREE.Group();
  group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(uSeam, uUp, uWidth));
  group.position.copy(start).add(end).multiplyScalar(0.5);
  const mat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.85 });
  const flange = new THREE.Mesh(new THREE.BoxGeometry(L + 30, 12, 140), mat);
  flange.position.set(0, -6, 0);
  const web = new THREE.Mesh(new THREE.BoxGeometry(L + 30, 70, 12), mat);
  web.position.set(0, 35, -6);
  group.add(flange, web);
  return group;
}

/**
 * @param {{record: object, aspect?: number}} opts
 */
export function buildWeldScene({ record, aspect = 16 / 9 }) {
  const { waypoints, segments } = record.path;
  const arc = record.geometry && record.geometry.arc;
  const byName = new Map(waypoints.map((w) => [w.name, w]));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#060913");
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xf0f4ff, 2.2);
  sun.position.set(600, 1000, 600);
  scene.add(sun);

  const positions = waypoints.map((w) => v3(w.pos));
  const box = new THREE.Box3().setFromPoints(positions);
  if (arc && Array.isArray(arc.samples)) arc.samples.forEach((s) => box.expandByPoint(v3([s.x, s.y, s.z])));
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 200);

  const grid = new THREE.GridHelper(Math.ceil(size * 2.5 / 100) * 100, 24, 0x334155, 0x1e293b);
  grid.position.set(center.x, box.min.y - 14, center.z);
  scene.add(grid);

  const start = waypoints.find((w) => w.type === "weld_start");
  const end = waypoints.find((w) => w.type === "weld_end");
  // Joint-relative revisions show the DECLARED joint frame instead of an illustrative workpiece,
  // so the picture never implies a joint geometry other than the one the targets were planned for.
  const indicators = jointIndicators(record);
  const illustrativeWorkpiece = record.geometry.plannedType === "straight" && start && end && !indicators;
  if (illustrativeWorkpiece) scene.add(illustrativeTJoint(v3(start.pos), v3(end.pos)));

  let jointFrame = null;
  if (indicators) {
    jointFrame = new THREE.Group();
    jointFrame.name = "joint-frame";
    const origin = v3(indicators.origin);
    jointFrame.add(ownedArrow(origin, indicators.travel, 90, INDICATOR_COLOR.travel, "joint-travel"));
    jointFrame.add(ownedArrow(origin, indicators.normalA, 70, INDICATOR_COLOR.normalA, "joint-normal-a"));
    jointFrame.add(ownedArrow(origin, indicators.normalB, 70, INDICATOR_COLOR.normalB, "joint-normal-b"));
    // Torch axis at each weld target: the stored quaternion applied to the declared approach axis,
    // drawn ending at the target so it points the way the torch points.
    for (const t of indicators.torchAxes) {
      const tail = new THREE.Vector3(...robotToViewPosition(t.pos.map((c, i) => c - 110 * t.approach[i])));
      jointFrame.add(ownedArrow(tail, t.approach, 110, INDICATOR_COLOR.torch, `torch-axis-${t.name}`));
    }
    scene.add(jointFrame);
  }

  // Motion segments.
  let weldCurve = null;
  for (const seg of segments) {
    if (!seg.from) continue;
    if (seg.role === "weld") {
      weldCurve = seg.instruction === "MoveC" && arc ? new ArcCurve3(arc) : new THREE.LineCurve3(v3(byName.get(seg.from).pos), v3(byName.get(seg.to).pos));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(weldCurve, BEAD_SEGMENTS, 3.5, BEAD_RADIAL, false), new THREE.MeshStandardMaterial({ color: 0x00d2ff, emissive: 0x0077aa, metalness: 0.8, roughness: 0.2 }));
      tube.name = "weld-path";
      scene.add(tube);
      continue;
    }
    const geo = new THREE.BufferGeometry().setFromPoints([v3(byName.get(seg.from).pos), v3(byName.get(seg.to).pos)]);
    const dashed = seg.role !== "point";
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color: ROLE_COLOR[seg.role] || ROLE_COLOR.air, dashSize: 12, gapSize: 7 })
      : new THREE.LineBasicMaterial({ color: ROLE_COLOR.point });
    const line = new THREE.Line(geo, mat);
    if (dashed) line.computeLineDistances();
    line.name = `segment-${seg.index}`;
    scene.add(line);
  }

  // Bead revealed along the weld curve with a draw range.
  let bead = null;
  if (weldCurve) {
    bead = new THREE.Mesh(new THREE.TubeGeometry(weldCurve, BEAD_SEGMENTS, 4.8, BEAD_RADIAL, false), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf1f5f9, metalness: 0.95, roughness: 0.1 }));
    bead.visible = false;
    bead.name = "bead";
    scene.add(bead);
  }

  // Target markers at exact backend positions.
  const markers = waypoints.map((w) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(w.type === "home" ? 8 : 6, 16, 16), new THREE.MeshStandardMaterial({ color: TARGET_COLOR[w.type] || 0x94a3b8, emissive: TARGET_COLOR[w.type] || 0x94a3b8, emissiveIntensity: 0.35 }));
    m.position.copy(v3(w.pos));
    m.name = `target-${w.name}`;
    scene.add(m);
    return m;
  });

  const torch = buildTorch();
  scene.add(torch.group);
  const toolAxes = new THREE.AxesHelper(60);
  toolAxes.visible = false;
  toolAxes.name = "tool-axes";
  scene.add(toolAxes);

  const sparkState = createSparkState();
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkState.positions, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xfef08a, size: 4.5, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  sparks.visible = false;
  sparks.frustumCulled = false;
  scene.add(sparks);

  const camera = new THREE.PerspectiveCamera(45, aspect, 1, 20000);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.9, size * 0.7, size * 0.9));
  camera.lookAt(center);

  const tip = new THREE.Vector3();
  const api = {
    scene,
    camera,
    target: center,
    markers,
    torch: torch.group,
    toolAxes,
    illustrativeWorkpiece: !!illustrativeWorkpiece,
    jointFrame,
    jointIndicators: indicators,
    hasWeld: !!weldCurve,

    /**
     * @param {ReturnType<import('../lib/playback.js').sampleTimeline>} sample
     * @param {{playing: boolean, dt: number, rng?: () => number}} frame
     */
    update(sample, { playing, dt, rng }) {
      torch.group.position.copy(v3(sample.position));
      setQuat(torch.group, torchMeshViewQuaternion(sample.quaternion));
      toolAxes.position.copy(torch.group.position);
      setQuat(toolAxes, toolFrameViewQuaternion(sample.quaternion));

      if (bead) {
        const n = Math.floor(sample.weldFraction * BEAD_SEGMENTS);
        bead.visible = n > 0;
        bead.geometry.setDrawRange(0, n * BEAD_RADIAL * 6);
      }
      // Arc effects are gated by the same timeline and only while playing.
      const active = playing && sample.inWeld;
      torch.light.intensity = active ? 25 + (rng || Math.random)() * 35 : 0;
      torch.glow.material.opacity = active ? 0.85 : 0;
      torch.group.getWorldPosition(tip);
      sparks.visible = stepSparks(sparkState, dt, active ? [tip.x, tip.y, tip.z] : null, active, rng);
      if (sparks.visible) sparkGeo.attributes.position.needsUpdate = true;
      return { arcActive: active };
    },

    setToolAxesVisible(v) { toolAxes.visible = !!v; },

    /** Disposes every geometry and material owned by this scene. */
    dispose() {
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((obj) => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => materials.add(m));
      });
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      scene.clear();
      return { geometries: geometries.size, materials: materials.size };
    },
  };
  return api;
}
