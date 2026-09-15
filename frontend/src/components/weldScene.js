/**
 * Three.js scene for one canonical job revision, independent of React and of
 * the WebGL renderer so it can be built and disposed in tests.
 *
 * Everything drawn comes from the stored revision and is converted from the
 * target frame to the view frame exactly once (viewTransform.js):
 *   - plates: record.workpiece.parts (the same boxes the backend clearance checks use)
 *   - targets, torch attitudes: record.path.waypoints (stored positions and quaternions)
 *   - segments: record.path.segments; MoveL as a linear TCP path, MoveJ as a
 *     dashed SCHEMATIC connector (its real path is not known), MoveC as the fitted arc
 *   - zones, findings, tool envelope: record.clearance and record.toolEnvelope
 * No path, plate or clearance result is re-derived here. Representation toggles
 * change only materials, never results. There is no robot model.
 */

import * as THREE from "three";
import { robotToViewPosition, robotToViewDirection, torchMeshViewQuaternion, toolFrameViewQuaternion, toThreeOrder } from "../lib/viewTransform.js";
import { arcPoint } from "../lib/playback.js";
import { createSparkState, stepSparks } from "../lib/sparks.js";
import { jointIndicators } from "../lib/orientationCheck.js";
import { workpieceMode, segmentRows, findingMarkers } from "../lib/clearanceView.js";

export const INDICATOR_COLOR = { travel: 0xf8fafc, normalA: 0x22c55e, normalB: 0xf59e0b, torch: 0xe879f9 };
export const SEGMENT_COLOR = { air: 0x94a3b8, approach: 0xeab308, retract: 0xa855f7, point: 0x38bdf8, weld: 0x22d3ee };
export const TARGET_COLOR = { home: 0x06b6d4, approach: 0xeab308, weld_start: 0x22c55e, weld_via: 0xf97316, weld_end: 0xef4444, retract: 0xa855f7, point: 0x38bdf8 };
export const PLATE_COLOR = { plateA: 0x64748b, plateB: 0x8b9cb3 };
export const FINDING_COLOR = { intersection_detected: 0xff2d55, inconclusive: 0xf59e0b };
export const ENVELOPE_COLOR = 0xe879f9;
export const HIGHLIGHT_COLOR = 0xffffff;
export const REPRESENTATIONS = ["transparent", "solid", "wireframe"];

const BEAD_SEGMENTS = 96;
const BEAD_RADIAL = 16;

const v3 = (p) => new THREE.Vector3(...robotToViewPosition(p));
const setQuat = (obj, q) => obj.quaternion.set(...toThreeOrder(q));

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

/** Decorative torch mesh (NOT the clearance envelope). Tip at the local origin, body along local +Y. */
function buildTorch() {
  const g = new THREE.Group();
  g.name = "decorative-torch";
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

function plateMaterial(color, representation) {
  const m = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide });
  applyRepresentation(m, representation);
  return m;
}

function applyRepresentation(material, representation) {
  material.wireframe = representation === "wireframe";
  material.transparent = representation === "transparent";
  material.opacity = representation === "transparent" ? 0.42 : 1;
  material.depthWrite = representation !== "transparent";
  material.needsUpdate = true;
}

/**
 * One stored plate box → mesh. Centre and axes are converted once; the view
 * mapping is a proper rotation, so the right-handed basis stays right-handed.
 */
export function plateMesh(part, representation = "transparent") {
  const geo = new THREE.BoxGeometry(2 * part.half[0], 2 * part.half[1], 2 * part.half[2]);
  const mesh = new THREE.Mesh(geo, plateMaterial(PLATE_COLOR[part.id] || 0x64748b, representation));
  mesh.name = `workpiece-${part.id}`;
  mesh.position.copy(v3(part.center));
  const basis = new THREE.Matrix4().makeBasis(...part.axes.map((a) => new THREE.Vector3(...robotToViewDirection(a))));
  mesh.quaternion.setFromRotationMatrix(basis);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xe2e8f0 }));
  edges.name = `workpiece-${part.id}-edges`;
  mesh.add(edges);
  mesh.userData = { partId: part.id, label: part.label };
  return mesh;
}

/** Capsules declared in the tool frame; the group's local axes ARE the tool axes. */
function envelopeMeshes(envelope) {
  const group = new THREE.Group();
  group.name = "tool-envelope";
  const mat = new THREE.MeshBasicMaterial({ color: ENVELOPE_COLOR, wireframe: true, transparent: true, opacity: 0.55 });
  for (const c of envelope.capsules) {
    const from = new THREE.Vector3(...c.fromToolMm);
    const to = new THREE.Vector3(...c.toToolMm);
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const capsule = new THREE.Group();
    capsule.name = `envelope-${c.id}`;
    if (len > 1e-9) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.radiusMm, c.radiusMm, len, 16, 1, true), mat);
      cyl.position.copy(from).addScaledVector(dir, 0.5);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      capsule.add(cyl);
    }
    for (const p of [from, to]) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(c.radiusMm, 12, 8), mat);
      s.position.copy(p);
      capsule.add(s);
    }
    capsule.userData = { capsuleId: c.id, fromToolMm: c.fromToolMm, toToolMm: c.toToolMm, radiusMm: c.radiusMm };
    group.add(capsule);
  }
  return group;
}

/**
 * @param {{record: object, aspect?: number, representation?: string}} opts
 */
export function buildWeldScene({ record, aspect = 16 / 9, representation = "transparent" }) {
  const { waypoints } = record.path;
  const arc = record.geometry && record.geometry.arc;
  const byName = new Map(waypoints.map((w) => [w.name, w]));
  const wpMode = workpieceMode(record);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#060913");
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xf0f4ff, 2.2);
  sun.position.set(600, 1000, 600);
  scene.add(sun);

  // Display-only framing: camera centre and grid never change engineering coordinates.
  const box = new THREE.Box3().setFromPoints(waypoints.map((w) => v3(w.pos)));
  if (arc && Array.isArray(arc.samples)) arc.samples.forEach((s) => box.expandByPoint(v3([s.x, s.y, s.z])));

  // Workpiece plates exactly as stored.
  let workpieceGroup = null;
  const plateMeshes = [];
  if (wpMode.mode !== "unavailable") {
    workpieceGroup = new THREE.Group();
    workpieceGroup.name = "workpiece";
    for (const part of record.workpiece.parts) {
      const mesh = plateMesh(part, representation);
      plateMeshes.push(mesh);
      workpieceGroup.add(mesh);
    }
    workpieceGroup.userData = { mode: wpMode.mode, label: wpMode.label };
    scene.add(workpieceGroup);
    workpieceGroup.updateMatrixWorld(true);
    plateMeshes.forEach((m) => box.expandByObject(m));
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(box.getSize(new THREE.Vector3()).length(), 200);
  const grid = new THREE.GridHelper(Math.ceil((size * 2.5) / 100) * 100, 24, 0x334155, 0x1e293b);
  grid.name = "display-grid";
  grid.position.set(center.x, box.min.y - 14, center.z);
  scene.add(grid);

  const start = waypoints.find((w) => w.type === "weld_start");
  const end = waypoints.find((w) => w.type === "weld_end");

  // Joint-relative revisions: the declared joint frame from the stored orientation record.
  const indicators = jointIndicators(record);
  let jointFrame = null;
  if (indicators) {
    jointFrame = new THREE.Group();
    jointFrame.name = "joint-frame";
    const origin = v3(indicators.origin);
    jointFrame.add(ownedArrow(origin, indicators.travel, 90, INDICATOR_COLOR.travel, "joint-travel"));
    jointFrame.add(ownedArrow(origin, indicators.normalA, 70, INDICATOR_COLOR.normalA, "joint-normal-a"));
    jointFrame.add(ownedArrow(origin, indicators.normalB, 70, INDICATOR_COLOR.normalB, "joint-normal-b"));
    for (const t of indicators.torchAxes) {
      const tail = new THREE.Vector3(...robotToViewPosition(t.pos.map((c, i) => c - 110 * t.approach[i])));
      jointFrame.add(ownedArrow(tail, t.approach, 110, INDICATOR_COLOR.torch, `torch-axis-${t.name}`));
    }
    scene.add(jointFrame);
  }

  // Seam frame (always): travel along the stored weld targets and the stored tool-frame axes at each weld target.
  let seamFrame = null;
  if (start && end) {
    seamFrame = new THREE.Group();
    seamFrame.name = "seam-frame";
    const chord = end.pos.map((c, i) => c - start.pos[i]);
    if (Math.hypot(...chord) > 1e-9) seamFrame.add(ownedArrow(v3(start.pos), chord, Math.min(120, Math.hypot(...chord)), INDICATOR_COLOR.travel, "seam-travel"));
    for (const w of [start, end]) {
      const axes = new THREE.AxesHelper(40);
      axes.name = `stored-tool-frame-${w.name}`;
      axes.position.copy(v3(w.pos));
      setQuat(axes, toolFrameViewQuaternion(w.orient));
      seamFrame.add(axes);
    }
    scene.add(seamFrame);
  }

  // Stored motion segments.
  const rows = segmentRows(record);
  const segmentObjects = new Map();
  let weldCurve = null;
  for (const row of rows) {
    if (row.connector === "none") continue;
    let obj;
    if (row.role === "weld") {
      weldCurve = row.instruction === "MoveC" && arc ? new ArcCurve3(arc) : new THREE.LineCurve3(v3(byName.get(row.from).pos), v3(byName.get(row.to).pos));
      obj = new THREE.Mesh(new THREE.TubeGeometry(weldCurve, BEAD_SEGMENTS, 3.5, BEAD_RADIAL, false), new THREE.MeshStandardMaterial({ color: SEGMENT_COLOR.weld, emissive: 0x0077aa, metalness: 0.8, roughness: 0.2 }));
      obj.name = "weld-path";
    } else {
      const geo = new THREE.BufferGeometry().setFromPoints([v3(byName.get(row.from).pos), v3(byName.get(row.to).pos)]);
      const color = SEGMENT_COLOR[row.role] || SEGMENT_COLOR.air;
      const schematic = row.connector !== "linear";
      obj = new THREE.Line(geo, schematic ? new THREE.LineDashedMaterial({ color, dashSize: 10, gapSize: 8 }) : new THREE.LineBasicMaterial({ color }));
      if (schematic) obj.computeLineDistances();
      obj.name = `segment-${row.index}`;
    }
    obj.userData = { segmentId: row.id, index: row.index, instruction: row.instruction, role: row.role, connector: row.connector, baseColor: obj.material.color.getHex() };
    segmentObjects.set(row.index, obj);
    scene.add(obj);
  }

  // Bead revealed along the weld curve with a draw range.
  let bead = null;
  if (weldCurve) {
    bead = new THREE.Mesh(new THREE.TubeGeometry(weldCurve, BEAD_SEGMENTS, 4.8, BEAD_RADIAL, false), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf1f5f9, metalness: 0.95, roughness: 0.1 }));
    bead.visible = false;
    bead.name = "bead";
    scene.add(bead);
  }

  // Fly-by zones at the stored targets (the corner path inside is not reconstructed).
  const zoneObjects = [];
  if (record.clearance) {
    for (const s of record.clearance.segments) {
      if (!s.zones || !(s.zones.endTcpRadiusMm > 0) || !Number.isFinite(s.zones.endTcpRadiusMm) || !byName.get(s.to)) continue;
      const zone = new THREE.Mesh(new THREE.SphereGeometry(s.zones.endTcpRadiusMm, 20, 12), new THREE.MeshBasicMaterial({ color: 0x94a3b8, wireframe: true, transparent: true, opacity: 0.25 }));
      zone.name = `zone-${s.index}`;
      zone.position.copy(v3(byName.get(s.to).pos));
      zone.userData = { zone: s.zones.end, radiusMm: s.zones.endTcpRadiusMm, target: s.to };
      zoneObjects.push(zone);
      scene.add(zone);
    }
  }

  // Stored findings (definite intersections red, inconclusive amber).
  const findingObjects = findingMarkers(record).map((f) => {
    // Drawn over the plates (depthTest off) so a finding inside material stays visible.
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(9), new THREE.MeshBasicMaterial({ color: FINDING_COLOR[f.result], depthTest: false }));
    m.renderOrder = 10;
    m.name = `finding-${f.id}`;
    m.position.copy(v3(f.point));
    m.userData = f;
    scene.add(m);
    return m;
  });

  // Target markers at exact stored positions.
  const markers = waypoints.map((w) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(w.type === "home" ? 8 : 6, 16, 16), new THREE.MeshStandardMaterial({ color: TARGET_COLOR[w.type] || 0x94a3b8, emissive: TARGET_COLOR[w.type] || 0x94a3b8, emissiveIntensity: 0.35 }));
    m.position.copy(v3(w.pos));
    m.name = `target-${w.name}`;
    m.userData = { target: w.name, type: w.type };
    scene.add(m);
    return m;
  });

  const torch = buildTorch();
  scene.add(torch.group);
  const toolAxes = new THREE.AxesHelper(60);
  toolAxes.visible = false;
  toolAxes.name = "tool-axes";
  scene.add(toolAxes);

  const envelopeDef = record.toolEnvelope && record.toolEnvelope.definition;
  const envelopeGroup = envelopeDef && envelopeDef.kind === "tool_frame_capsules" ? envelopeMeshes(envelopeDef) : null;
  if (envelopeGroup) scene.add(envelopeGroup);

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
  let highlighted = null;
  const api = {
    scene,
    camera,
    target: center,
    markers,
    torch: torch.group,
    toolAxes,
    workpieceMode: wpMode.mode,
    workpieceLabel: wpMode.label,
    workpieceGroup,
    plateMeshes,
    seamFrame,
    jointFrame,
    jointIndicators: indicators,
    segmentObjects,
    zoneObjects,
    findingObjects,
    envelopeGroup,
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
      if (envelopeGroup) {
        envelopeGroup.position.copy(torch.group.position);
        setQuat(envelopeGroup, toolFrameViewQuaternion(sample.quaternion));
      }

      if (bead) {
        const n = Math.floor(sample.weldFraction * BEAD_SEGMENTS);
        bead.visible = n > 0;
        bead.geometry.setDrawRange(0, n * BEAD_RADIAL * 6);
      }
      const active = playing && sample.inWeld;
      torch.light.intensity = active ? 25 + (rng || Math.random)() * 35 : 0;
      torch.glow.material.opacity = active ? 0.85 : 0;
      torch.group.getWorldPosition(tip);
      sparks.visible = stepSparks(sparkState, dt, active ? [tip.x, tip.y, tip.z] : null, active, rng);
      if (sparks.visible) sparkGeo.attributes.position.needsUpdate = true;
      return { arcActive: active };
    },

    setToolAxesVisible(v) { toolAxes.visible = !!v; },
    setZonesVisible(v) { zoneObjects.forEach((z) => { z.visible = !!v; }); },
    setEnvelopeVisible(v) { if (envelopeGroup) envelopeGroup.visible = !!v; },

    /** Materials only; results never change. */
    setRepresentation(mode) {
      if (!REPRESENTATIONS.includes(mode)) return;
      plateMeshes.forEach((m) => applyRepresentation(m.material, mode));
    },

    /** Highlights one stored segment (null clears). Returns its userData or null. */
    highlightSegment(index) {
      if (highlighted) {
        highlighted.material.color.setHex(highlighted.userData.baseColor);
        if (highlighted.material.emissive) highlighted.material.emissive.setHex(0x0077aa);
        highlighted = null;
      }
      const obj = index === null || index === undefined ? null : segmentObjects.get(index);
      if (!obj) return null;
      obj.material.color.setHex(HIGHLIGHT_COLOR);
      if (obj.material.emissive) obj.material.emissive.setHex(0xffffff);
      highlighted = obj;
      return obj.userData;
    },

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
