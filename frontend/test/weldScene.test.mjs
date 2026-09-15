import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildWeldScene } from "../src/components/weldScene.js";
import { buildTimeline, sampleTimeline } from "../src/lib/playback.js";
import { robotToViewPosition, torchMeshViewQuaternion, toThreeOrder } from "../src/lib/viewTransform.js";
import { seededRng } from "../src/lib/sparks.js";
import { STRAIGHT_RECORD, ARC_RECORD } from "./fixtures.mjs";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

function ownedResources(scene) {
  const geometries = new Set();
  const materials = new Set();
  scene.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
  });
  return { geometries, materials };
}

test("T21 scene: markers sit at the exact backend targets (including the arc via)", () => {
  for (const record of [STRAIGHT_RECORD, ARC_RECORD]) {
    const s = buildWeldScene({ record });
    assert.equal(s.markers.length, record.path.waypoints.length);
    record.path.waypoints.forEach((w, i) => {
      const [x, y, z] = robotToViewPosition(w.pos);
      close(s.markers[i].position.x, x, 1e-9);
      close(s.markers[i].position.y, y, 1e-9);
      close(s.markers[i].position.z, z, 1e-9);
    });
    s.dispose();
  }
  // No hard-coded workpiece: without a stored workpiece the preview is seam-only.
  const straight = buildWeldScene({ record: STRAIGHT_RECORD });
  assert.equal(straight.workpieceMode, "unavailable");
  assert.equal(straight.workpieceLabel, "Workpiece geometry unavailable");
  assert.equal(straight.workpieceGroup, null);
  assert.ok(straight.seamFrame);
  straight.dispose();
  const arc = buildWeldScene({ record: ARC_RECORD });
  assert.equal(arc.workpieceMode, "unavailable", "no joint implied for a curved seam");
  arc.dispose();
});

test("T09/T26 scene: torch pose follows the timeline and the RAPID quaternion; arc effects only while playing in the weld", () => {
  const s = buildWeldScene({ record: ARC_RECORD });
  const tl = buildTimeline(ARC_RECORD.path, ARC_RECORD.geometry.arc);
  const mid = sampleTimeline(tl, 6);
  const on = s.update(mid, { playing: true, dt: 1 / 60, rng: seededRng(7) });
  assert.equal(on.arcActive, true);
  const expectedQ = toThreeOrder(torchMeshViewQuaternion(mid.quaternion));
  const q = s.torch.quaternion;
  const dot = Math.abs(q.x * expectedQ[0] + q.y * expectedQ[1] + q.z * expectedQ[2] + q.w * expectedQ[3]);
  close(dot, 1, 1e-9);
  const [x, y, z] = robotToViewPosition(mid.position);
  close(s.torch.position.x, x, 1e-9); close(s.torch.position.y, y, 1e-9); close(s.torch.position.z, z, 1e-9);
  assert.equal(s.update(mid, { playing: false, dt: 1 / 60 }).arcActive, false, "sparks hidden while paused");
  assert.equal(s.update(sampleTimeline(tl, 1), { playing: true, dt: 1 / 60 }).arcActive, false);
  s.dispose();
});

test("T27 scene: every owned geometry and material is disposed; repeated builds do not accumulate", () => {
  for (let i = 0; i < 25; i += 1) {
    const s = buildWeldScene({ record: i % 2 ? ARC_RECORD : STRAIGHT_RECORD });
    s.update(sampleTimeline(buildTimeline((i % 2 ? ARC_RECORD : STRAIGHT_RECORD).path, (i % 2 ? ARC_RECORD : STRAIGHT_RECORD).geometry.arc), 6), { playing: true, dt: 0.016, rng: seededRng(i) });
    const { geometries, materials } = ownedResources(s.scene);
    let disposed = 0;
    geometries.forEach((g) => g.addEventListener("dispose", () => { disposed += 1; }));
    materials.forEach((m) => m.addEventListener("dispose", () => { disposed += 1; }));
    const counts = s.dispose();
    assert.equal(counts.geometries, geometries.size);
    assert.equal(disposed, geometries.size + materials.size);
    assert.equal(s.scene.children.length, 0);
  }
  assert.ok(THREE.REVISION);
});
