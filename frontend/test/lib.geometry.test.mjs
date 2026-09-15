import test from "node:test";
import assert from "node:assert/strict";
import { robotToViewPosition, toolFrameViewQuaternion, torchMeshViewQuaternion, rotateVec, slerp, quatNormalize } from "../src/lib/viewTransform.js";
import { buildTimeline, sampleTimeline, createPlaybackClock, arcPoint, PREVIEW_DURATION_S } from "../src/lib/playback.js";
import { createSparkState, stepSparks, seededRng, MAX_DT_S } from "../src/lib/sparks.js";
import { buildScene25d, computeBounds, resolveLabelOverlaps, labelsOverlap, SVG } from "../src/lib/projection25d.js";
import { suggestMapping, suggestOrientation, parseCsvText, buildPointListDocument } from "../src/lib/pointListMapping.js";
import { STRAIGHT_RECORD, ARC_RECORD } from "./fixtures.mjs";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const closeVec = (a, b, eps = 1e-6) => a.forEach((v, i) => close(v, b[i], eps));

test("T09 view transform: [x,y,z] → [x,z,−y] applied to positions and orientations consistently", () => {
  assert.deepEqual(robotToViewPosition([1, 2, 3]), [1, 3, -2]);
  // For any robtarget q: the tool Z axis in view equals the transformed robot-frame tool Z.
  for (const q of [[1, 0, 0, 0], [0, 0.382683431, 0.923879533, 0], [0.383667588, 0.149822324, 0.889291982, -0.198776819]]) {
    const toolZRobot = rotateVec(q, [0, 0, 1]);
    closeVec(rotateVec(toolFrameViewQuaternion(q), [0, 0, 1]), robotToViewPosition(toolZRobot), 1e-9);
    // Torch mesh: the nozzle direction (mesh −Y) points along tool +Z.
    closeVec(rotateVec(torchMeshViewQuaternion(q), [0, -1, 0]), robotToViewPosition(toolZRobot), 1e-9);
    closeVec(rotateVec(torchMeshViewQuaternion(q), [1, 0, 0]), robotToViewPosition(rotateVec(q, [1, 0, 0])), 1e-9);
  }
  // Home orientation points the torch straight down in the view (−Y).
  closeVec(rotateVec(torchMeshViewQuaternion([0, 0.382683431, 0.923879533, 0]), [0, -1, 0]), [0, -1, 0], 1e-6);
  // Slerp takes the short path for q ≡ −q.
  const a = quatNormalize([0.9, 0.1, 0, 0.1]);
  closeVec(slerp(a, a.map((c) => -c), 0.5).map(Math.abs), a.map(Math.abs), 1e-9);
});

test("T21/T26 timeline: endpoints equal backend targets; weld gate and phases come from one timeline", () => {
  const tl = buildTimeline(STRAIGHT_RECORD.path, null);
  close(tl.durationS, PREVIEW_DURATION_S);
  const byName = Object.fromEntries(STRAIGHT_RECORD.path.waypoints.map((w) => [w.name, w]));
  const s0 = sampleTimeline(tl, 0);
  closeVec(s0.position, byName.home.pos);
  const weld = tl.segments.find((s) => s.role === "weld");
  close(weld.t0, 0.25 * 12, 1e-9);
  close(weld.t1, 0.75 * 12, 1e-9);
  closeVec(sampleTimeline(tl, weld.t0).position, byName.Target_40.pos);
  closeVec(sampleTimeline(tl, weld.t1).position, byName.Target_20_5.pos);
  closeVec(sampleTimeline(tl, 12).position, byName.home.pos);
  const mid = sampleTimeline(tl, 6);
  assert.equal(mid.inWeld, true);
  close(mid.weldFraction, 0.5, 1e-9);
  assert.equal(mid.phaseLabel, "Weld path");
  assert.equal(sampleTimeline(tl, 1).inWeld, false);
  assert.equal(sampleTimeline(tl, 1).phaseLabel, "Move to approach");
  assert.equal(sampleTimeline(tl, 11).phaseLabel, "Return to home");
  closeVec(sampleTimeline(tl, weld.t0 + 0.01).quaternion.map(Math.abs), byName.Target_40.orient.map(Math.abs), 1e-6);
});

test("T22/T26 arc timeline follows the canonical circle exactly and passes through the via target", () => {
  const arc = ARC_RECORD.geometry.arc;
  const tl = buildTimeline(ARC_RECORD.path, arc);
  const weld = tl.segments.find((s) => s.role === "weld");
  assert.equal(weld.instruction, "MoveC");
  const via = ARC_RECORD.path.waypoints.find((w) => w.type === "weld_via");
  const tVia = weld.t0 + (weld.t1 - weld.t0) * (arc.viaAngleDeg / arc.sweepDeg);
  const at = sampleTimeline(tl, tVia);
  closeVec(at.position, via.pos, 1e-3);
  closeVec(at.quaternion.map(Math.abs), via.orient.map(Math.abs), 1e-6);
  // Every sampled weld position lies on the circle.
  for (let k = 0; k <= 20; k += 1) {
    const p = sampleTimeline(tl, weld.t0 + ((weld.t1 - weld.t0) * k) / 20).position;
    const c = [arc.center.x, arc.center.y, arc.center.z];
    close(Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]), arc.radiusMm, 1e-6);
  }
  closeVec(arcPoint(arc, 0), [arc.start.x, arc.start.y, arc.start.z], 1e-9);
});

test("T26 playback clock: play, pause, seek, replay and speed without a second integrator", () => {
  let now = 0;
  const clock = createPlaybackClock({ durationS: 12, now: () => now });
  assert.equal(clock.time(), 0);
  clock.play();
  now += 3000;
  close(clock.time(), 3);
  close(clock.time(), 3, 0); // reading twice never advances time
  clock.pause();
  now += 5000;
  close(clock.time(), 3);
  clock.seek(9);
  close(clock.time(), 9);
  clock.setSpeed(2);
  clock.play();
  now += 1000;
  close(clock.time(), 11);
  now += 5000;
  assert.equal(clock.time(), 12);
  assert.equal(clock.snapshot().playing, false);
  assert.equal(clock.snapshot().ended, true);
  clock.play(); // play at the end restarts
  now += 500;
  close(clock.time(), 1);
  clock.replay();
  close(clock.time(), 0);
  clock.setSpeed(3); // not an allowed speed
  assert.equal(clock.snapshot().speed, 2);
});

test("T26 sparks: elapsed-time integration is frame-rate independent and large gaps are clamped", () => {
  const run = (hz) => {
    const s = createSparkState(8);
    s.lifetimes.fill(10); // no respawn during the comparison
    s.velocities.fill(100);
    for (let i = 0; i < hz; i += 1) stepSparks(s, 1 / hz, [0, 0, 0], true, seededRng(1));
    return s;
  };
  const a = run(30);
  const b = run(144);
  // Float32Array storage accumulates ~1e-5 rounding over 144 steps; the old
  // per-frame constant would differ by 3.8 s of lifetime between 30 Hz and 144 Hz.
  for (let i = 0; i < a.positions.length; i += 1) close(a.positions[i], b.positions[i], 1e-2);
  close(a.lifetimes[0], 9, 1e-4);
  close(b.lifetimes[0], 9, 1e-4);

  const s = createSparkState(4);
  s.lifetimes.fill(10);
  stepSparks(s, 5, [0, 0, 0], true, seededRng(2)); // tab hidden for 5 s
  close(s.lifetimes[0], 10 - MAX_DT_S, 1e-5);
  assert.equal(stepSparks(s, 0.016, [0, 0, 0], false), false);
  assert.ok(s.lifetimes.every((l) => l === 0), "inactive arc clears particles");
});

test("T22 2.5D scene: arcs are drawn from canonical samples with a continuous weld highlight and a labelled via", () => {
  const scene = buildScene25d(ARC_RECORD);
  assert.equal(scene.points.length, 6);
  const weld = scene.segments.filter((s) => s.role === "weld");
  assert.equal(weld.length, 1, "one continuous weld segment, not two chords");
  assert.equal(weld[0].polyline.length, ARC_RECORD.geometry.arc.samples.length);
  assert.equal(weld[0].style.glow, true);
  assert.ok(scene.labels.some((l) => l.type === "weld_via"));
  assert.ok(!scene.segments.some((s) => s.from === "Target_45" || s.to === "Target_45"), "via is not a move endpoint");
  for (const p of scene.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));

  const straight = buildScene25d(STRAIGHT_RECORD);
  assert.equal(straight.segments.find((s) => s.role === "weld").polyline.length, 2);
  assert.deepEqual(straight.segments.map((s) => s.role), ["air", "approach", "weld", "retract", "air"]);
  assert.match(straight.seamBand.note, /not drawn to the physical seam width/);

  // Label pills never overlap, including the compressed arc projection, and stay inside the viewBox.
  for (const s of [scene, straight]) {
    assert.equal(labelsOverlap(s.labels), false);
    for (const l of s.labels) assert.ok(l.x - l.w / 2 >= 0 && l.x + l.w / 2 <= SVG.W && l.y - l.h / 2 >= 0 && l.y + l.h / 2 <= SVG.H);
  }
  const stacked = resolveLabelOverlaps(Array.from({ length: 6 }, (_, i) => ({ name: `T${i}`, type: "point", text: `Target_${i}0 · Target`, w: 130, h: 18, x: 300, y: 180 })));
  assert.equal(labelsOverlap(stacked), false, "six labels at one point are separated");
  const reversed = buildScene25d({ ...STRAIGHT_RECORD, path: { ...STRAIGHT_RECORD.path, waypoints: STRAIGHT_RECORD.path.waypoints.map((w) => ({ ...w, pos: [w.pos[1], w.pos[0], w.pos[2]] })) } });
  assert.equal(labelsOverlap(reversed.labels), false);

  // Zero projected range and a single point stay finite.
  const b = computeBounds([[100, 0, 0], [100, 0, 0]]);
  assert.ok(Number.isFinite(b.minX) && b.maxX > b.minX);
  assert.equal(buildScene25d(null), null);
});

test("T11 spreadsheet mapping: suggested but explicit, required columns enforced, empty rows skipped, no defaults", () => {
  const { headers, rows, problems } = parseCsvText('Name,X,Y,Z,Rx,Ry,Rz\r\nP1,450.5,12.2,400.1,90,0,-90\n"P,2",472.1,35.4,395.2,90,0,-90\n,,,,,,\n');
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].Name, "P,2");
  const mapping = suggestMapping(headers);
  assert.equal(mapping.x, "X");
  assert.equal(suggestOrientation(mapping), "euler_zyx_deg");
  const missingChoice = buildPointListDocument({ rows, mapping, orientationConvention: null, configurationPolicy: null });
  assert.equal(missingChoice.document, null);
  assert.equal(missingChoice.problems.length, 2);
  const unmapped = buildPointListDocument({ rows, mapping: { ...mapping, z: null }, orientationConvention: "euler_zyx_deg", configurationPolicy: "fixed_zero" });
  assert.ok(unmapped.problems.some((p) => p.includes("Z (mm)")));
  const ok = buildPointListDocument({ rows: [...rows, { __rowNumber: 9, Name: "", X: "", Y: "", Z: "", Rx: "", Ry: "", Rz: "" }], mapping, orientationConvention: "euler_zyx_deg", configurationPolicy: "fixed_zero" });
  assert.equal(ok.document.rows.length, 2);
  assert.equal(ok.skippedEmptyRows, 1);
  assert.deepEqual(ok.document.rows[0], { rowNumber: 2, name: "P1", x: "450.5", y: "12.2", z: "400.1", rx: "90", ry: "0", rz: "-90" });
  assert.equal(parseCsvText("").problems.length, 1);
});
