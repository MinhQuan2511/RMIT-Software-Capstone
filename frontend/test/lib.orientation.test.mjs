import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as THREE from "three";
import { recomputeOrientation, jointIndicators, isJointRelative } from "../src/lib/orientationCheck.js";
import { validateJointDraft, buildJointParameters, draftFromRecord, defaultJointDraft } from "../src/lib/jointInput.js";
import { createUsabilityLog, USABILITY_KEY } from "../src/lib/usabilityLog.js";
import { buildWeldScene, INDICATOR_COLOR } from "../src/components/weldScene.js";
import { robotToViewDirection, rotateVec } from "../src/lib/viewTransform.js";
import { buildTimeline, sampleTimeline } from "../src/lib/playback.js";
import { STRAIGHT_RECORD, ARC_RECORD, JOINT_RECORD } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const backendJoint = require("../../backend/services/kinematics/jointOrientation.js");
const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test("joint fixture is synthetic and its stored targets reproduce the requested angles in the browser", () => {
  assert.equal(JOINT_RECORD.orientation.station.provenance, "synthetic_fixture");
  assert.equal(isJointRelative(STRAIGHT_RECORD), false);
  assert.equal(recomputeOrientation(ARC_RECORD), null);
  const r = recomputeOrientation(JOINT_RECORD);
  assert.equal(r.agrees, true, JSON.stringify(r));
  assert.equal(r.openSide, true);
  assert.equal(r.sameOrientationOnAllTargets, true);
  close(r.workAngleDeg, JOINT_RECORD.orientation.recovered.workAngleDeg, 1e-9);
  close(r.pushAngleDeg, JOINT_RECORD.orientation.recovered.pushAngleDeg, 1e-9);
});

test("3D indicators use the stored joint frame and stored quaternions; no illustrative workpiece; full disposal", () => {
  const s = buildWeldScene({ record: JOINT_RECORD });
  assert.equal(s.illustrativeWorkpiece, false);
  assert.ok(s.jointFrame);
  const ind = jointIndicators(JOINT_RECORD);
  const byName = (n) => s.jointFrame.children.find((c) => c.name === n);
  const expectDir = (group, robotDir) => {
    const v = new THREE.Vector3(...robotToViewDirection(robotDir)).normalize().toArray();
    group.userData.direction.forEach((c, i) => close(c, v[i], 1e-12));
  };
  expectDir(byName("joint-travel"), ind.travel);
  expectDir(byName("joint-normal-a"), JOINT_RECORD.orientation.jointFrame.normalA);
  expectDir(byName("joint-normal-b"), JOINT_RECORD.orientation.jointFrame.normalB);
  for (const w of JOINT_RECORD.path.waypoints.filter((x) => x.type === "weld_start" || x.type === "weld_end")) {
    expectDir(byName(`torch-axis-${w.name}`), rotateVec(w.orient, [0, 0, 1]));
  }
  assert.equal(byName("joint-normal-a").children[0].material.color.getHex(), INDICATOR_COLOR.normalA);
  // The torch mesh during the weld uses the same stored quaternion as the indicator.
  s.update(sampleTimeline(buildTimeline(JOINT_RECORD.path, null), 6), { playing: false, dt: 0.016 });

  for (let i = 0; i < 20; i += 1) {
    const scene = buildWeldScene({ record: [STRAIGHT_RECORD, ARC_RECORD, JOINT_RECORD][i % 3] });
    const geometries = new Set();
    const materials = new Set();
    scene.scene.traverse((o) => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    let disposed = 0;
    geometries.forEach((g) => g.addEventListener("dispose", () => { disposed += 1; }));
    materials.forEach((m) => m.addEventListener("dispose", () => { disposed += 1; }));
    scene.dispose();
    assert.equal(disposed, geometries.size + materials.size);
  }
  s.dispose();
});

test("client joint validation matches backend acceptance for the same specs", () => {
  const seam = { start: [400, 100, 300], end: [600, 100, 300] };
  const h = Math.SQRT1_2;
  const RAD = Math.PI / 180;
  const specs = [
    { kind: "template", template: "fillet90_wall_left", referenceNormal: [0, 0, 1] },
    { kind: "template", template: "fillet90_wall_right", referenceNormal: [1, 0, 0.1] },
    { kind: "template", template: "fillet90_wall_left", referenceNormal: [0, 0, 0] },
    { kind: "explicit_normals", normalA: [0, 0, 1], normalB: [0, -1, 0] },
    { kind: "explicit_normals", normalA: [0, 0, 1], normalB: [0, 0, 1] },
    { kind: "explicit_normals", normalA: [0, 0, 1], normalB: [0, -Math.cos(10 * RAD), Math.sin(10 * RAD)] },
    { kind: "explicit_normals", normalA: [0, 0, 1], normalB: [1, 0, 0] },
    { kind: "explicit_normals", normalA: [0, 0, 1], normalB: [0, -1, Number.NaN] },
    { kind: "explicit_frame", xAxis: [1, 0, 0], yAxis: [0, h, h], zAxis: [0, -h, h] },
    { kind: "explicit_frame", xAxis: [1, 0, 0], yAxis: [0, h, h], zAxis: [0, h, -h] },
    { kind: "explicit_frame", xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0.1, 1] },
    { kind: "explicit_frame", xAxis: [2, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] },
  ];
  for (const spec of specs) {
    const draft = { ...defaultJointDraft(), stationId: "synthetic-tool-z-approach", jointKind: spec.kind, ...spec };
    delete draft.kind;
    const clientOk = validateJointDraft(draft, seam).length === 0;
    const server = backendJoint.planFilletOrientation({ start: seam.start, end: seam.end, joint: spec, toolConvention: { approachAxis: "+Z", rollAxis: "+X", rollReference: "travel" }, workAngleDeg: 45, pushAngleDeg: 10 });
    assert.equal(clientOk, server.ok, `${JSON.stringify(spec)} client=${clientOk} server=${server.ok} ${JSON.stringify(server.diagnostics)}`);
  }
  const base = { ...defaultJointDraft(), stationId: "operator-declared" };
  const problems = validateJointDraft({ ...base, workAngleDeg: 80, pushAngleDeg: -40, declared: { ...base.declared, toolName: "1bad", rollAxis: "-Z", note: "" } }, seam);
  for (const re of [/Work angle/, /Push angle/, /tool name/, /perpendicular/, /note/]) assert.ok(problems.some((p) => re.test(p)), `${re} not in ${problems}`);
  assert.ok(validateJointDraft({ ...defaultJointDraft(), stationId: "" }, seam).some((p) => /station/.test(p)));
});

test("stored joint parameters round-trip to request parameters (built-in and operator-declared stations)", () => {
  const params = buildJointParameters(draftFromRecord(JOINT_RECORD), JOINT_RECORD);
  assert.deepEqual(params.station, { id: "synthetic-tool-z-approach" });
  assert.deepEqual(params.joint, JOINT_RECORD.parameters.joint);
  assert.deepEqual(params.orientation, JOINT_RECORD.parameters.orientation);
  assert.deepEqual(params.clearances, JOINT_RECORD.parameters.clearances);
  const declaredRecord = { parameters: { ...JOINT_RECORD.parameters, station: { schema: "vd-station-profile@1", id: "operator-declared", toolName: "tWeldGun", wobjName: "wobj0", toolConvention: { approachAxis: "+X", rollAxis: "-Z", rollReference: "against_travel" }, declaration: { note: "team notes", evidenceReference: null }, digestSha256: "x" } } };
  const p2 = buildJointParameters(draftFromRecord(declaredRecord), declaredRecord);
  assert.deepEqual(p2.station, { id: "operator-declared", toolName: "tWeldGun", wobjName: "wobj0", toolConvention: { approachAxis: "+X", rollAxis: "-Z", rollReference: "against_travel" }, note: "team notes" });
  // From a legacy record only motion is carried over (clearance keys differ between profiles).
  const fromLegacy = buildJointParameters({ ...defaultJointDraft(), stationId: "synthetic-tool-z-approach" }, STRAIGHT_RECORD);
  assert.equal(fromLegacy.clearances, undefined);
  assert.deepEqual(fromLegacy.motion, STRAIGHT_RECORD.parameters.motion);
});

test("usability capture: off by default, allowlisted events only, no personal details, survives corrupt storage", () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  let t = 1000;
  const log = createUsabilityLog({ storage, now: () => t });
  assert.equal(log.record("job_created", { revision: 1 }), false, "disabled by default");
  log.enable();
  t = 1500;
  assert.equal(log.record("job_created", { revision: 1, plannedType: "straight", operator: "Jane Doe", fileName: "C:\\secret\\Feature.txt" }), true);
  assert.equal(log.record("keystroke", {}), false);
  t = 4000;
  log.record("module_downloaded", { revision: "1; DROP" });
  const exported = JSON.parse(log.exportJson());
  assert.deepEqual(exported.events.map((e) => [e.tMs, e.event]), [[0, "capture_started"], [500, "job_created"], [3000, "module_downloaded"]]);
  assert.deepEqual(exported.events[1].detail, { revision: 1, plannedType: "straight" });
  assert.deepEqual(exported.events[2].detail, {});
  assert.ok(!JSON.stringify(exported).includes("Jane") && !JSON.stringify(exported).includes("secret"));
  store.set(USABILITY_KEY, "{corrupt");
  assert.equal(createUsabilityLog({ storage }).state().enabled, false);
  log.clear();
  assert.equal(log.state().events.length, 0);
});
