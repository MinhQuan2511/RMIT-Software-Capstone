/**
 * Circular Arc Fitting Service
 * Fits a circle through three points lying on a weld arc and samples it.
 *
 * The seam descriptor for a curved workpiece carries three points that are all
 * ON the arc — start, via and end — rather than a centre and a radius. The
 * circle is therefore the circumcircle of the triangle those points form, and
 * the sweep is whatever angle the traversal start → via → end actually covers.
 * Any sweep is supported, not just a half turn.
 *
 * Degenerate input (three collinear points, or two coincident ones) describes a
 * circle of infinite radius. That is reported as a failed fit so the caller can
 * fall back to a straight seam, rather than emitting a MoveC the controller
 * would reject.
 */

// Relative tolerance for the degeneracy test. The cross-product magnitude is
// compared against the scale of the triangle itself, so the test behaves the
// same for a 5 mm seam and a 5 m one.
const DEGENERACY_EPSILON = 1e-9;

// A fit can be geometrically valid and still be useless: a via point that bows
// only microns off the chord yields a radius of kilometres, which is numerically
// fragile and which controllers reject as too close to collinear. Bow is the
// perpendicular distance from the via point to the start-end chord, in the same
// units as the input (mm), and anything under this is reported as nearly
// straight so the caller can emit a MoveL instead.
const NEARLY_STRAIGHT_BOW_MM = 0.1;

/** Normalises a point given as {x,y,z} or [x,y,z] into a plain triple. */
function toVec(p) {
  if (!p) return null;
  if (Array.isArray(p)) return [Number(p[0]), Number(p[1]), Number(p[2])];
  if (p.x === undefined || p.y === undefined || p.z === undefined) return null;
  return [Number(p.x), Number(p.y), Number(p.z)];
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) { return Math.sqrt(dot(a, a)); }
function unit(a) {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}
function toPoint(v) { return { x: v[0], y: v[1], z: v[2] }; }

/**
 * Fits a circle through three points on an arc.
 *
 * @param {{x,y,z}|number[]} startPoint
 * @param {{x,y,z}|number[]} viaPoint   - A point on the arc between start and end
 * @param {{x,y,z}|number[]} endPoint
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   center?: {x,y,z},
 *   radius?: number,
 *   normal?: {x,y,z},
 *   sweepAngle?: number,
 *   viaAngle?: number,
 *   arcLength?: number
 * }}
 */
function fitCircle3Pt(startPoint, viaPoint, endPoint) {
  const p1 = toVec(startPoint);
  const p2 = toVec(viaPoint);
  const p3 = toVec(endPoint);

  if (!p1 || !p2 || !p3) {
    return { ok: false, reason: 'missing_point' };
  }
  if ([...p1, ...p2, ...p3].some((n) => !Number.isFinite(n))) {
    return { ok: false, reason: 'non_finite' };
  }

  // Edge vectors of the triangle, taken from the end point as reference.
  const a = sub(p1, p3);
  const b = sub(p2, p3);
  const axb = cross(a, b);
  const axbLen = norm(axb);

  // Scale-relative degeneracy test: |a x b| is twice the triangle area, so it
  // vanishes for collinear points and for any pair of coincident points.
  const scaleRef = Math.max(norm(a), norm(b));
  if (scaleRef === 0 || axbLen <= DEGENERACY_EPSILON * scaleRef * scaleRef) {
    return {
      ok: false,
      reason: scaleRef === 0 ? 'coincident_points' : 'collinear_points',
    };
  }

  // Circumcentre of the triangle in 3D.
  const aa = dot(a, a);
  const bb = dot(b, b);
  const numerator = cross(sub(scale(b, aa), scale(a, bb)), axb);
  const center = add(p3, scale(numerator, 1 / (2 * axbLen * axbLen)));

  const radius = norm(sub(p1, center));

  // Plane normal oriented by the traversal start → via → end, so a positive
  // rotation about it carries the torch the way the seam actually runs.
  const normal = unit(cross(sub(p2, p1), sub(p3, p1)));

  // Signed angles about that normal, measured from the start radius vector.
  const u1 = sub(p1, center);
  const angleFromStart = (p) => {
    const u = sub(p, center);
    return Math.atan2(dot(normal, cross(u1, u)), dot(u1, u));
  };

  const wrap = (t) => (t < 0 ? t + 2 * Math.PI : t);
  const viaAngle = wrap(angleFromStart(p2));
  let sweepAngle = wrap(angleFromStart(p3));

  // The end must lie beyond the via along the direction of travel. If it does
  // not, the traversal wraps the long way round the circle.
  if (sweepAngle < viaAngle) {
    sweepAngle = 2 * Math.PI;
  }

  // Perpendicular distance from the via point to the start-end chord.
  const chord = sub(p3, p1);
  const chordLen = norm(chord);
  const bow = chordLen > 0
    ? norm(cross(sub(p2, p1), chord)) / chordLen
    : radius;

  return {
    ok: true,
    start: toPoint(p1),
    bow,
    nearlyStraight: bow < NEARLY_STRAIGHT_BOW_MM,
    center: toPoint(center),
    radius,
    normal: toPoint(normal),
    sweepAngle,
    viaAngle,
    arcLength: radius * sweepAngle,
  };
}

/**
 * Samples points evenly along a fitted arc, from the start point to the end
 * point inclusive. Used by the 3D viewport, which needs a point list to build
 * a tube; the RAPID output uses the fit directly via MoveC and needs no
 * sampling at all.
 *
 * @param {ReturnType<typeof fitCircle3Pt>} fit
 * @param {number} segments - Number of segments; the result has segments+1 points
 * @returns {{x,y,z}[]}
 */
function sampleArc(fit, segments = 32) {
  if (!fit || !fit.ok) return [];

  const n = Math.max(1, Math.floor(segments));
  const center = toVec(fit.center);
  const normal = toVec(fit.normal);
  const start = toVec(fit.start);

  // Orthonormal frame of the circle plane: e1 points from the centre at the
  // start of the arc, e2 is 90 degrees further along the direction of travel.
  const e1 = unit(sub(start, center));
  const e2 = cross(normal, e1);

  const points = [];
  for (let i = 0; i <= n; i += 1) {
    const theta = (fit.sweepAngle * i) / n;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    points.push(toPoint(add(center, add(scale(e1, fit.radius * c), scale(e2, fit.radius * sn)))));
  }
  return points;
}

module.exports = {
  fitCircle3Pt,
  sampleArc,
};
