/**
 * Exact distance and intersection primitives between simple convex sets and
 * oriented boxes. Pure functions, no I/O, no sampling.
 *
 * A box is { center: [x,y,z], axes: [u, v, w] (orthonormal, right-handed),
 * half: [hu, hv, hw] } in millimetres. Swept or static query shapes are the
 * convex hull of 1, 2 or 4 points (a point, a segment, or a planar
 * parallelogram). A capsule of radius r around such a hull overlaps the box
 * exactly when the hull-to-box distance is below r.
 *
 * Disjoint convex polytopes attain their minimum distance at a vertex–face,
 * edge–edge or vertex–(edge|vertex) feature pair, so point–box, point–polygon
 * and segment–segment distances over all features give the exact distance.
 * Intersection is decided first by clipping every edge of one set against the
 * other, which also catches arbitrarily thin boxes crossed between vertices.
 * See LocalUse/4/GEOMETRY_CLEARANCE_METHOD.md §6.
 */

'use strict';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => scale(v, 1 / norm(v));
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function toLocal(box, p) {
  const d = sub(p, box.center);
  return [dot(d, box.axes[0]), dot(d, box.axes[1]), dot(d, box.axes[2])];
}

function toWorld(box, l) {
  return add(box.center, add(scale(box.axes[0], l[0]), add(scale(box.axes[1], l[1]), scale(box.axes[2], l[2]))));
}

/** Point to box: exact distance (0 inside), depth below the nearest face when inside, closest box point. */
function pointBox(p, box) {
  const l = toLocal(box, p);
  const h = box.half;
  const q = l.map((v, i) => Math.max(-h[i], Math.min(h[i], v)));
  const distance = norm(sub(l, q));
  const depth = distance === 0 ? Math.min(...l.map((v, i) => h[i] - Math.abs(v))) : 0;
  return { distance, depth, closestOnBox: toWorld(box, q), closestOnShape: p.slice(), local: l };
}

/**
 * Liang–Barsky clip of a local-frame segment against [-half, half]. Returns the
 * parameter interval inside the (closed) box and the faces crossed on entry and
 * exit ({axis, sign}; null when the segment starts or ends inside), or null.
 */
function clipLocal(a, b, half) {
  if (half.some((h) => h < 0)) return null;
  let t0 = 0;
  let t1 = 1;
  let enter = null;
  let exit = null;
  for (let i = 0; i < 3; i += 1) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-15) {
      if (a[i] < -half[i] || a[i] > half[i]) return null;
      continue;
    }
    let tn = (-half[i] - a[i]) / d;
    let tf = (half[i] - a[i]) / d;
    let sn = -1;
    let sf = 1;
    if (d < 0) { [tn, tf] = [tf, tn]; [sn, sf] = [sf, sn]; }
    if (tn > t0) { t0 = tn; enter = { axis: i, sign: sn }; }
    if (tf < t1) { t1 = tf; exit = { axis: i, sign: sf }; }
    if (t0 > t1) return null;
  }
  return { t0, t1, enter, exit };
}

/** Closest points between segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection §5.1.9). */
function segmentSegment(p1, q1, p2, q2) {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;
  if (a <= 1e-24 && e <= 1e-24) { s = 0; t = 0; } else if (a <= 1e-24) {
    s = 0; t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-24) { t = 0; s = clamp01(-c / a); } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 * a * e ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const c1 = add(p1, scale(d1, s));
  const c2 = add(p2, scale(d2, t));
  return { distance: norm(sub(c1, c2)), c1, c2, s, t };
}

function boxVertices(box) {
  const out = [];
  for (const su of [-1, 1]) for (const sv of [-1, 1]) for (const sw of [-1, 1]) out.push(toWorld(box, [su * box.half[0], sv * box.half[1], sw * box.half[2]]));
  return out;
}

function boxEdges(box) {
  const h = box.half;
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    for (const sj of [-1, 1]) {
      for (const sk of [-1, 1]) {
        const a = [0, 0, 0];
        a[i] = -h[i]; a[j] = sj * h[j]; a[k] = sk * h[k];
        const b = a.slice();
        b[i] = h[i];
        out.push([toWorld(box, a), toWorld(box, b)]);
      }
    }
  }
  return out;
}

/** Exact segment–box distance with closest points; 0 and a witness point when they intersect. */
function segmentBox(a, b, box) {
  const clip = clipLocal(toLocal(box, a), toLocal(box, b), box.half);
  if (clip) {
    const w = lerp(a, b, (clip.t0 + clip.t1) / 2);
    return { distance: 0, intersects: true, closestOnShape: w, closestOnBox: w, interval: [clip.t0, clip.t1] };
  }
  let best = null;
  const consider = (distance, onShape, onBox) => { if (!best || distance < best.distance) best = { distance, intersects: false, closestOnShape: onShape, closestOnBox: onBox }; };
  for (const p of [a, b]) { const r = pointBox(p, box); consider(r.distance, p.slice(), r.closestOnBox); }
  for (const [e0, e1] of boxEdges(box)) { const r = segmentSegment(a, b, e0, e1); consider(r.distance, r.c1, r.c2); }
  return best;
}

/**
 * Segment inside a box: the largest depth below the nearest face reached along
 * the segment (exact: maximum of a concave piecewise-linear function), and
 * whether the segment passes through the OPEN box from one face to the
 * opposite face (a through-crossing, detected for any positive thickness).
 */
function segmentPenetration(a, b, box, epsilon = 1e-6) {
  const la = toLocal(box, a);
  const lb = toLocal(box, b);
  const clip = clipLocal(la, lb, box.half);
  if (!clip) return { touches: false, maxDepth: 0, deepestPoint: null, throughCrossing: null, interval: null };
  // depth(t) = min over faces (h_i − s·l_i(t)), linear pieces c + m·t.
  const lines = [];
  for (let i = 0; i < 3; i += 1) {
    const d = lb[i] - la[i];
    for (const s of [1, -1]) lines.push({ c: box.half[i] - s * la[i], m: -s * d });
  }
  const depthAt = (t) => Math.min(...lines.map((l) => l.c + l.m * t));
  const candidates = [clip.t0, clip.t1];
  for (let p = 0; p < lines.length; p += 1) {
    for (let q = p + 1; q < lines.length; q += 1) {
      const dm = lines[p].m - lines[q].m;
      if (Math.abs(dm) > 1e-15) {
        const t = (lines[q].c - lines[p].c) / dm;
        if (t > clip.t0 && t < clip.t1) candidates.push(t);
      }
    }
  }
  let bestT = clip.t0;
  let maxDepth = -Infinity;
  for (const t of candidates) { const d = depthAt(t); if (d > maxDepth) { maxDepth = d; bestT = t; } }
  const open = clipLocal(la, lb, box.half.map((h) => h - epsilon));
  const throughCrossing = open && open.enter && open.exit && open.enter.axis === open.exit.axis && open.enter.sign !== open.exit.sign
    ? { axis: open.exit.axis, entryPoint: lerp(a, b, open.t0), exitPoint: lerp(a, b, open.t1) } : null;
  return { touches: true, maxDepth: Math.max(0, maxDepth), deepestPoint: lerp(a, b, bestT), throughCrossing, interval: [clip.t0, clip.t1] };
}

/** Exact distance from a point to a planar convex polygon (vertices in order). */
function pointPolygon(p, poly, n) {
  const d = dot(sub(p, poly[0]), n);
  const x = sub(p, scale(n, d));
  let inside = true;
  for (let i = 0; i < poly.length; i += 1) {
    const e = sub(poly[(i + 1) % poly.length], poly[i]);
    if (dot(cross(e, sub(x, poly[i])), n) < -1e-12 * (norm(e) * norm(sub(x, poly[i])) + 1)) { inside = false; break; }
  }
  if (inside) return { distance: Math.abs(d), closest: x };
  let best = null;
  for (let i = 0; i < poly.length; i += 1) {
    const r = segmentSegment(p, p, poly[i], poly[(i + 1) % poly.length]);
    if (!best || r.distance < best.distance) best = { distance: r.distance, closest: r.c2 };
  }
  return best;
}

/**
 * Exact distance between the convex hull of 1, 2 or 4 points and a box.
 * Four points must be a planar parallelogram listed in cyclic order (the
 * volume swept by a segment translating along a straight line).
 */
function hullBox(points, box) {
  if (points.length === 1) {
    const r = pointBox(points[0], box);
    return { distance: r.distance, intersects: r.distance === 0, closestOnShape: r.closestOnShape, closestOnBox: r.closestOnBox };
  }
  if (points.length === 2) return segmentBox(points[0], points[1], box);
  if (points.length !== 4) throw new Error('hullBox: expected 1, 2 or 4 points');

  const [p0, p1, , p3] = points;
  const nRaw = cross(sub(p1, p0), sub(p3, p0));
  const scaleRef = Math.max(norm(sub(p1, p0)) * norm(sub(p3, p0)), 1e-24);
  if (norm(nRaw) <= 1e-9 * scaleRef || norm(sub(p1, p0)) < 1e-12 || norm(sub(p3, p0)) < 1e-12) {
    // Degenerate (collinear) parallelogram: its hull is the segment between the two farthest points.
    let pair = [points[0], points[1]];
    let far = -1;
    for (let i = 0; i < 4; i += 1) for (let j = i + 1; j < 4; j += 1) { const d = norm(sub(points[i], points[j])); if (d > far) { far = d; pair = [points[i], points[j]]; } }
    return segmentBox(pair[0], pair[1], box);
  }
  const n = unit(nRaw);
  const edges = points.map((p, i) => [p, points[(i + 1) % 4]]);
  for (const [a, b] of edges) {
    const clip = clipLocal(toLocal(box, a), toLocal(box, b), box.half);
    if (clip) { const w = lerp(a, b, (clip.t0 + clip.t1) / 2); return { distance: 0, intersects: true, closestOnShape: w, closestOnBox: w }; }
  }
  for (const [e0, e1] of boxEdges(box)) {
    const s0 = dot(sub(e0, p0), n);
    const s1 = dot(sub(e1, p0), n);
    if ((s0 <= 0 && s1 >= 0) || (s0 >= 0 && s1 <= 0)) {
      const t = s0 === s1 ? 0 : s0 / (s0 - s1);
      const x = lerp(e0, e1, t);
      if (pointPolygon(x, points, n).distance <= 1e-9) return { distance: 0, intersects: true, closestOnShape: x, closestOnBox: x };
    }
  }
  let best = null;
  const consider = (distance, onShape, onBox) => { if (!best || distance < best.distance) best = { distance, intersects: false, closestOnShape: onShape, closestOnBox: onBox }; };
  for (const p of points) { const r = pointBox(p, box); consider(r.distance, p.slice(), r.closestOnBox); }
  for (const v of boxVertices(box)) { const r = pointPolygon(v, points, n); consider(r.distance, r.closest, v); }
  for (const [a, b] of edges) for (const [e0, e1] of boxEdges(box)) { const r = segmentSegment(a, b, e0, e1); consider(r.distance, r.c1, r.c2); }
  return best;
}

module.exports = {
  add, sub, scale, dot, cross, norm, unit, lerp,
  toLocal, toWorld, pointBox, clipLocal, segmentSegment, segmentBox, segmentPenetration, pointPolygon, hullBox, boxVertices, boxEdges,
};
