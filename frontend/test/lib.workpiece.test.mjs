import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as THREE from "three";
import { buildWeldScene, FINDING_COLOR, HIGHLIGHT_COLOR } from "../src/components/weldScene.js";
import { robotToViewPosition, toolFrameViewQuaternion, toThreeOrder } from "../src/lib/viewTransform.js";
import { buildTimeline, sampleTimeline } from "../src/lib/playback.js";
import { segmentRows, findingMarkers, workpieceMode, clearanceSummary } from "../src/lib/clearanceView.js";
import { constructFillet, draftFromParameters, definitionsFromDraft, measuredSeam, requestParametersFromRecord, reverseTraversal, switchWeldingSide, wallSideOf, validateWorkpieceDraft } from "../src/lib/workpieceInput.js";
import { STRAIGHT_RECORD, JOINT_RECORD, TEE_RECORD, CORNER_REVERSED_RECORD, ROTATED_RECORD, INTERSECT_RECORD } from "./fixtures.mjs";

const require = createRequire(import.meta.url);
const backendWorkpiece = require("../../backend/services/geometry/workpiece.js");
const backendClearance = require("../../backend/services/geometry/clearance.js");
const close = (a, b, eps = 1e-6, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b}`);
const clone = (o) => JSON.parse(JSON.stringify(o));

test("plates are drawn at exactly the stored boxes, converted to the view frame once", () => {
  for (const record of [TEE_RECORD, CORNER_REVERSED_RECORD, ROTATED_RECORD]) {
    const s = buildWeldScene({ record });
    s.scene.updateMatrixWorld(true);
    assert.equal(s.plateMeshes.length, record.workpiece.parts.length);
    record.workpiece.parts.forEach((part, k) => {
      const mesh = s.plateMeshes[k];
      assert.equal(mesh.userData.partId, part.id);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const got = mesh.localToWorld(new THREE.Vector3(sx * part.half[0], sy * part.half[1], sz * part.half[2]));
        const corner = part.center.map((c, i) => c + sx * part.half[0] * part.axes[0][i] + sy * part.half[1] * part.axes[1][i] + sz * part.half[2] * part.axes[2][i]);
        const want = robotToViewPosition(corner);
        close(got.x, want[0], 1e-6, part.id); close(got.y, want[1], 1e-6); close(got.z, want[2], 1e-6);
      }
    });
    // Weld-start marker and plate joint faces share the stored root point (seam on the modeled surfaces).
    const start = record.path.waypoints.find((w) => w.type === "weld_start");
    const marker = s.markers.find((m) => m.name === `target-${start.name}`);
    const want = robotToViewPosition(start.pos);
    close(marker.position.x, want[0], 1e-9); close(marker.position.y, want[1], 1e-9); close(marker.position.z, want[2], 1e-9);
    s.dispose();
  }
});

test("labels distinguish operator-defined, illustrative and unavailable geometry; seam-only mode keeps axes, targets and orientation", () => {
  assert.deepEqual(workpieceMode(TEE_RECORD), { mode: "operator_defined", label: "Operator-defined geometry" });
  assert.deepEqual(workpieceMode(CORNER_REVERSED_RECORD), { mode: "illustrative", label: "Illustrative geometry" });
  assert.deepEqual(workpieceMode(STRAIGHT_RECORD), { mode: "unavailable", label: "Workpiece geometry unavailable" });
  assert.deepEqual(workpieceMode({ path: STRAIGHT_RECORD.path }), { mode: "unavailable", label: "Workpiece geometry unavailable" }, "older revision without a workpiece record");
  const s = buildWeldScene({ record: STRAIGHT_RECORD });
  assert.equal(s.plateMeshes.length, 0);
  const start = STRAIGHT_RECORD.path.waypoints.find((w) => w.type === "weld_start");
  const axes = s.seamFrame.children.find((c) => c.name === `stored-tool-frame-${start.name}`);
  const q = toThreeOrder(toolFrameViewQuaternion(start.orient));
  close(Math.abs(axes.quaternion.x * q[0] + axes.quaternion.y * q[1] + axes.quaternion.z * q[2] + axes.quaternion.w * q[3]), 1, 1e-9);
  assert.equal(s.markers.length, STRAIGHT_RECORD.path.waypoints.length);
  s.dispose();
});

test("segments come from the stored plan: MoveL linear, MoveJ dashed schematic and not assessed, identifiers on selection", () => {
  const record = clone(TEE_RECORD);
  record.path.segments[5].instruction = "MoveJ"; // SYNTHETIC: a joint-space return to standby
  record.clearance = backendClearance.evaluateClearance({ waypoints: record.path.waypoints, segments: record.path.segments, workpiece: record.workpiece, toolEnvelope: record.toolEnvelope.definition });
  const rows = segmentRows(record);
  assert.deepEqual(rows.map((r) => r.id), ["S0", "S1", "S2", "S3", "S4", "S5"]);
  assert.equal(rows[0].connector, "none");
  assert.equal(rows[5].connector, "schematic");
  assert.equal(rows[5].tcpPath, "not_assessed");
  assert.equal(rows[5].reason, "JOINT_SPACE_MOTION_NOT_RECONSTRUCTED");
  const s = buildWeldScene({ record });
  assert.equal(s.segmentObjects.has(0), false, "the move from the unknown start is not drawn");
  const moveJ = s.segmentObjects.get(5);
  assert.equal(moveJ.material.type, "LineDashedMaterial");
  assert.equal(moveJ.userData.instruction, "MoveJ");
  const linear = s.segmentObjects.get(2);
  assert.equal(linear.material.type, "LineBasicMaterial");
  const pos = linear.geometry.attributes.position;
  const from = robotToViewPosition(record.path.waypoints.find((w) => w.name === "Target_30").pos);
  // BufferGeometry stores Float32 vertices: equal to the stored target within single precision.
  close(pos.getX(0), from[0], 1e-3); close(pos.getY(0), from[1], 1e-3); close(pos.getZ(0), from[2], 1e-3);
  const info = s.highlightSegment(5);
  assert.deepEqual([info.segmentId, info.instruction, info.connector], ["S5", "MoveJ", "schematic"]);
  assert.equal(moveJ.material.color.getHex(), HIGHLIGHT_COLOR);
  s.highlightSegment(null);
  assert.equal(moveJ.material.color.getHex(), moveJ.userData.baseColor);
  // Playback holds the torch instead of sliding it along the guessed MoveJ line.
  const tl = buildTimeline(record.path, null);
  const seg = tl.segments[5];
  const mid = sampleTimeline(tl, (seg.t0 + seg.t1) / 2);
  assert.deepEqual(mid.position, seg.fromPos);
  assert.match(mid.phaseLabel, /not animated/);
  s.dispose();
});

test("findings, zones and the tool envelope are drawn from the stored records; representation changes materials only", () => {
  const record = INTERSECT_RECORD;
  assert.equal(record.clearance.overall.result, "intersection_detected");
  assert.equal(record.output.sha256, STRAIGHT_RECORD.output.sha256, "same module bytes as the seam-only revision");
  const before = clone(record.clearance);
  const s = buildWeldScene({ record });
  const markers = findingMarkers(record);
  assert.equal(s.findingObjects.length, markers.length);
  assert.ok(markers.length > 0);
  s.findingObjects.forEach((m, i) => {
    const want = robotToViewPosition(markers[i].point);
    close(m.position.x, want[0], 1e-9);
    assert.equal(m.material.color.getHex(), FINDING_COLOR[markers[i].result]);
  });
  const zones = record.clearance.segments.filter((x) => x.zones && x.zones.endTcpRadiusMm > 0);
  assert.equal(s.zoneObjects.length, zones.length);
  assert.equal(s.zoneObjects[0].geometry.parameters.radius, zones[0].zones.endTcpRadiusMm);
  for (const mode of ["solid", "wireframe", "transparent"]) {
    s.setRepresentation(mode);
    assert.equal(s.plateMeshes[0].material.wireframe, mode === "wireframe");
  }
  assert.deepEqual(record.clearance, before);
  assert.equal(clearanceSummary(record).blocksExport, true);
  s.dispose();

  const t = buildWeldScene({ record: TEE_RECORD });
  assert.equal(t.plateMeshes[0].material.transparent, true, "penetrations stay visible by default");
  assert.equal(t.envelopeGroup.children.length, TEE_RECORD.toolEnvelope.definition.capsules.length);
  const tl = buildTimeline(TEE_RECORD.path, null);
  const weld = tl.segments.find((x) => x.role === "weld");
  const sample = sampleTimeline(tl, (weld.t0 + weld.t1) / 2);
  t.update(sample, { playing: false, dt: 0.016 });
  const q = toThreeOrder(toolFrameViewQuaternion(sample.quaternion));
  const g = t.envelopeGroup.quaternion;
  close(Math.abs(g.x * q[0] + g.y * q[1] + g.z * q[2] + g.w * q[3]), 1, 1e-9);
  const tcp = robotToViewPosition(sample.position);
  close(t.envelopeGroup.position.x, tcp[0], 1e-9);
  const nozzle = t.envelopeGroup.children.find((c) => c.name === "envelope-nozzle");
  assert.deepEqual(nozzle.userData.fromToolMm, TEE_RECORD.toolEnvelope.definition.capsules[0].fromToolMm);
  t.dispose();
});

test("a second record keeps its own plates when another scene is built and disposed", () => {
  const a = buildWeldScene({ record: TEE_RECORD });
  const b = buildWeldScene({ record: ROTATED_RECORD });
  const aPos = a.plateMeshes.map((m) => m.position.toArray());
  b.dispose();
  const c = buildWeldScene({ record: CORNER_REVERSED_RECORD });
  assert.deepEqual(a.plateMeshes.map((m) => m.position.toArray()), aPos);
  const want = robotToViewPosition(TEE_RECORD.workpiece.parts[0].center);
  close(a.plateMeshes[0].position.x, want[0], 1e-9);
  assert.notEqual(TEE_RECORD.workpiece.definitionSha256, CORNER_REVERSED_RECORD.workpiece.definitionSha256);
  a.dispose();
  c.dispose();
});

test("workpiece editor helpers: construction is accepted by the backend; reversal and side switching are involutions", () => {
  const seam = measuredSeam(TEE_RECORD);
  const def = constructFillet({ ...seam, side: "left", arrangement: "tee" });
  const v = backendWorkpiece.validateWorkpieceDefinition(def);
  assert.equal(v.ok, true, JSON.stringify(v.diagnostics));
  assert.equal(backendWorkpiece.checkSeamOnWorkpiece(backendWorkpiece.buildWorkpieceModel(v.definition), seam.start, seam.end).ok, true);
  assert.deepEqual(def, TEE_RECORD.parameters.workpiece, "same construction as the backend fixture");
  assert.equal(wallSideOf(def, seam), "left");

  const draft = draftFromParameters(TEE_RECORD.parameters, seam);
  assert.deepEqual(definitionsFromDraft(draft, seam, TEE_RECORD.parameters.toolEnvelope).workpiece, def);
  const mirrored = switchWeldingSide(draft);
  assert.equal(wallSideOf(definitionsFromDraft(mirrored, seam).workpiece, seam), "right");
  assert.deepEqual(switchWeldingSide(mirrored), draft);

  // Reversed revision: the measured seam is still the file's start → end.
  const reversedSeam = measuredSeam(CORNER_REVERSED_RECORD);
  assert.deepEqual(reversedSeam, seam);
  assert.equal(CORNER_REVERSED_RECORD.path.waypoints.find((w) => w.type === "weld_start").pos[0], 600);
  assert.equal(wallSideOf(CORNER_REVERSED_RECORD.parameters.workpiece, reversedSeam), "right");

  const params = requestParametersFromRecord(TEE_RECORD);
  assert.deepEqual(params.workpiece, TEE_RECORD.parameters.workpiece);
  assert.deepEqual(params.toolEnvelope, TEE_RECORD.parameters.toolEnvelope);
  const once = reverseTraversal(params);
  assert.equal(once.parameters.traversal, "reversed");
  assert.equal(once.templateRemapped, false, "joint from the workpiece needs no remapping");
  assert.deepEqual(once.parameters.workpiece, params.workpiece, "plates unchanged");
  assert.deepEqual(reverseTraversal(once.parameters).parameters, params);

  const tpl = requestParametersFromRecord(JOINT_RECORD);
  const r1 = reverseTraversal(tpl);
  assert.equal(r1.templateRemapped, true);
  assert.equal(r1.parameters.joint.template, "fillet90_wall_right");
  assert.deepEqual(reverseTraversal(r1.parameters).parameters, tpl);

  assert.deepEqual(validateWorkpieceDraft(draft, seam), []);
  const bad = validateWorkpieceDraft({ ...draft, dims: { ...draft.dims, tA: 0, hB: Number.NaN }, reference: [1, 0, 0] }, seam);
  assert.ok(bad.some((e) => /Plate A thickness/.test(e)) && bad.some((e) => /Plate B open-side height/.test(e)) && bad.some((e) => /15°/.test(e)), bad.join(" | "));
  assert.deepEqual(requestParametersFromRecord(STRAIGHT_RECORD).workpiece, { schema: "vd-workpiece@1", kind: "unknown" });
});

test("stored actual-path angles and clearance statuses use the scoped vocabulary only", () => {
  assert.ok(TEE_RECORD.orientation.actualPath);
  close(TEE_RECORD.orientation.actualPath.pushAngleDeg, 10, 1e-5);
  for (const r of [STRAIGHT_RECORD, TEE_RECORD, CORNER_REVERSED_RECORD, ROTATED_RECORD, INTERSECT_RECORD]) {
    const text = JSON.stringify(r.clearance);
    assert.ok(!/"(safe|passed|collision[_-]?free|robot[_-]?validated)"/i.test(text), r.source.displayName);
    assert.ok(Object.values(backendClearance.STATUS).includes(r.clearance.overall.result));
  }
  assert.equal(CORNER_REVERSED_RECORD.clearance.overall.realWorkpiece, "not_assessed");
  assert.equal(STRAIGHT_RECORD.clearance.overall.result, "not_assessed");
});
