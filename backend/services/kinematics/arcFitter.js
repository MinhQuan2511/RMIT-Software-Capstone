/**
 * Circular Arc Fitting Service
 * Fits a circle through three points lying on a weld arc and samples it.
 *
 * The seam descriptor for a curved workpiece carries three points that are all
 * ON the arc — start, via and end — rather than a centre and a radius. The
 * circle is therefore the circumcircle of the triangle those points form, and
 * the sweep is whatever angle the traversal start → via → end actually covers.
 *
 * Degenerate input (coincident or collinear points) describes no usable circle
 * and is reported as a failed fit. The caller decides what that means; this
 * module never substitutes a straight line.
 */

const DEFAULT_FIT_OPTIONS = Object.freeze({
  // Relative tolerance for the collinearity test: |a × b| is compared with the
  // squared scale of the triangle so the test behaves the same at 5 mm and 5 m.
  collinearEpsilon: 1e-9,
  // Two of the three points closer than this are treated as coincident.
  minPointSeparationMm: 0.5,
});

function toVec(p) {
  if (!p) return null;
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1]), Number(p[2])];
  if (p.x === undefined || p.y === undefined || p.z === undefined) return null;
  return [Number(p.x), Number(p.y), Number(p.z)];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.sqrt(dot(a, a));
const unit = (a) => { const n = norm(a); return n > 0 ? scale(a, 1 / n) : [0, 0, 0]; };
const toPoint = (v) => ({ x: v[0], y: v[1], z: v[2] });

/**
 * @returns {{ok: false, reason: string, details?: object} | {
 *   ok: true, start, center, radius, normal, sweepAngle, viaAngle, arcLength,
 *   chordLength, bow, maxChordDeviation, planeTiltDeg, direction
 * }}
 */
function fitCircle3Pt(startPoint, viaPoint, endPoint, options = {}) {
  const opts = { ...DEFAULT_FIT_OPTIONS, ...options };
  const p1 = toVec(startPoint);
  const p2 = toVec(viaPoint);
  const p3 = toVec(endPoint);

  if (!p1 || !p2 || !p3) return { ok: false, reason: 'missing_point' };
  if ([...p1, ...p2, ...p3].some((n) => !Number.isFinite(n))) return { ok: false, reason: 'non_finite' };

  const separations = { startVia: norm(sub(p2, p1)), viaEnd: norm(sub(p3, p2)), startEnd: norm(sub(p3, p1)) };
  const minSeparation = Math.min(separations.startVia, separations.viaEnd, separations.startEnd);
  if (minSeparation < opts.minPointSeparationMm) {
    return { ok: false, reason: 'coincident_points', details: { separationsMm: separations, minPointSeparationMm: opts.minPointSeparationMm } };
  }

  const a = sub(p1, p3);
  const b = sub(p2, p3);
  const axb = cross(a, b);
  const axbLen = norm(axb);
  const scaleRef = Math.max(norm(a), norm(b));
  if (axbLen <= opts.collinearEpsilon * scaleRef * scaleRef) {
    return { ok: false, reason: 'collinear_points' };
  }

  // Circumcentre in 3D.
  const aa = dot(a, a);
  const bb = dot(b, b);
  const numerator = cross(sub(scale(b, aa), scale(a, bb)), axb);
  const center = add(p3, scale(numerator, 1 / (2 * axbLen * axbLen)));
  const radius = norm(sub(p1, center));

  // Normal oriented by start → via → end, so a positive rotation about it
  // carries the torch the way the seam runs.
  const normal = unit(cross(sub(p2, p1), sub(p3, p1)));

  const u1 = sub(p1, center);
  const angleFromStart = (p) => {
    const u = sub(p, center);
    const t = Math.atan2(dot(normal, cross(u1, u)), dot(u1, u));
    return t < 0 ? t + 2 * Math.PI : t;
  };
  const viaAngle = angleFromStart(p2);
  const sweepAngle = angleFromStart(p3);

  // With the normal oriented by the traversal the via always precedes the end.
  // If floating point says otherwise the geometry is not trustworthy.
  if (!(viaAngle > 0 && viaAngle < sweepAngle)) {
    return { ok: false, reason: 'via_not_between', details: { viaAngle, sweepAngle } };
  }

  const chord = sub(p3, p1);
  const chordLength = norm(chord);
  const bow = norm(cross(sub(p2, p1), chord)) / chordLength;
  // Largest distance between the arc and the line through its end points,
  // reached at the mid-sweep point: R(1 − cos(θ/2)), valid for any sweep < 2π.
  const maxChordDeviation = radius * (1 - Math.cos(sweepAngle / 2));
  const planeTiltDeg = (Math.acos(Math.min(1, Math.abs(normal[2]))) * 180) / Math.PI;

  return {
    ok: true,
    start: toPoint(p1),
    center: toPoint(center),
    radius,
    normal: toPoint(normal),
    sweepAngle,
    viaAngle,
    arcLength: radius * sweepAngle,
    chordLength,
    bow,
    maxChordDeviation,
    planeTiltDeg,
    // Viewed from +Z looking down. Undefined-ish for a vertical plane, where
    // the tilt warning applies anyway.
    direction: normal[2] >= 0 ? 'counterclockwise_from_above' : 'clockwise_from_above',
  };
}

/** Point on a fitted arc at angle theta (radians) from the start radius. */
function pointOnArc(fit, theta) {
  const center = toVec(fit.center);
  const normal = toVec(fit.normal);
  const e1 = unit(sub(toVec(fit.start), center));
  const e2 = cross(normal, e1);
  return add(center, add(scale(e1, fit.radius * Math.cos(theta)), scale(e2, fit.radius * Math.sin(theta))));
}

/** Unit travel tangent at angle theta. */
function tangentOnArc(fit, theta) {
  const center = toVec(fit.center);
  const normal = toVec(fit.normal);
  const e1 = unit(sub(toVec(fit.start), center));
  const e2 = cross(normal, e1);
  return unit(add(scale(e1, -Math.sin(theta)), scale(e2, Math.cos(theta))));
}

/**
 * Samples points evenly along a fitted arc, start to end inclusive.
 * @returns {{x,y,z}[]} segments + 1 points
 */
function sampleArc(fit, segments = 48) {
  if (!fit || !fit.ok) return [];
  const n = Math.max(1, Math.floor(segments));
  const points = [];
  for (let i = 0; i <= n; i += 1) points.push(toPoint(pointOnArc(fit, (fit.sweepAngle * i) / n)));
  return points;
}

module.exports = { fitCircle3Pt, sampleArc, pointOnArc, tangentOnArc, DEFAULT_FIT_OPTIONS };
