/**
 * 2.5D isometric projection of a canonical job revision for the Parse & Map SVG.
 *
 * Projection (unchanged): ix = 0.7x + 0.7y, iy = z − 0.25y, auto-framed into a
 * 620 × 360 viewBox with 90/80 px margins and 20 %/25 % padding. Everything is
 * built from the revision's waypoints, ordered segments and arc samples; no
 * offset is recomputed here.
 */

export const SVG = Object.freeze({ W: 620, H: 360, PAD_X: 90, PAD_Y: 80 });

export const ROLE_STYLE = Object.freeze({
  air: { color: "#64748b", dash: "6,4", width: 1.5, glow: false, marker: "arrowGrey", label: "Air move (dashed)" },
  approach: { color: "#eab308", dash: "5,3", width: 2, glow: false, marker: "arrowYellow", label: "Approach (short dash)" },
  weld: { color: "#22d3ee", dash: "", width: 4, glow: true, marker: "arrowCyan", label: "Weld path (solid)" },
  retract: { color: "#a855f7", dash: "5,3", width: 2, glow: false, marker: "arrowPurple", label: "Retract (short dash)" },
  point: { color: "#38bdf8", dash: "", width: 2, glow: false, marker: "arrowCyan", label: "Point move (solid)" },
});

export const TARGET_STYLE = Object.freeze({
  home: { fill: "#06b6d4", label: "Standby", shape: "square" },
  approach: { fill: "#eab308", label: "Approach", shape: "diamond" },
  weld_start: { fill: "#22c55e", label: "Weld start", shape: "circle" },
  weld_via: { fill: "#f97316", label: "Arc via (MoveC)", shape: "triangle" },
  weld_end: { fill: "#ef4444", label: "Weld end", shape: "circle" },
  retract: { fill: "#a855f7", label: "Retract", shape: "diamond" },
  point: { fill: "#38bdf8", label: "Target", shape: "circle" },
});

export const isoProject = (p) => ({ ix: p[0] * 0.7 + p[1] * 0.7, iy: p[2] - p[1] * 0.25 });

export const LABEL_HEIGHT = 18;
export const labelText = (name, type) => `${name} · ${(TARGET_STYLE[type] || TARGET_STYLE.point).label}`;
export const labelWidth = (text) => Math.max(text.length * 5.6 + 14, 70);

const PAD = 2;
function penetration(a, b) {
  const px = (a.w + b.w) / 2 + PAD - Math.abs(a.x - b.x);
  const py = (a.h + b.h) / 2 + PAD - Math.abs(a.y - b.y);
  return px > 0 && py > 0 ? { px, py } : null;
}

/**
 * Separates overlapping label pills (axis-aligned boxes) along the axis of
 * least penetration, keeping them inside the viewBox. Anchors (the target
 * markers) do not move; leader lines connect each label back to its target.
 */
export function resolveLabelOverlaps(labels, iterations = 120) {
  const out = labels.map((l) => ({ ...l }));
  const clamp = (l) => {
    l.x = Math.min(Math.max(l.x, l.w / 2 + 1), SVG.W - l.w / 2 - 1);
    l.y = Math.min(Math.max(l.y, l.h / 2 + 1), SVG.H - l.h / 2 - 1);
  };
  out.forEach(clamp);
  for (let it = 0; it < iterations; it += 1) {
    let moved = false;
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        const p = penetration(a, b);
        if (!p) continue;
        moved = true;
        if (p.py <= p.px) {
          const dir = a.y < b.y || (a.y === b.y && i < j) ? -1 : 1;
          a.y += (dir * p.py) / 2 + dir * 0.5;
          b.y -= (dir * p.py) / 2 + dir * 0.5;
        } else {
          const dir = a.x < b.x || (a.x === b.x && i < j) ? -1 : 1;
          a.x += (dir * p.px) / 2 + dir * 0.5;
          b.x -= (dir * p.px) / 2 + dir * 0.5;
        }
        clamp(a);
        clamp(b);
      }
    }
    if (!moved) break;
  }
  return out;
}

export function labelsOverlap(labels) {
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) if (penetration(labels[i], labels[j])) return true;
  }
  return false;
}

export function computeBounds(points) {
  if (!points.length) return null;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of points) {
    const { ix, iy } = isoProject(p);
    if (!Number.isFinite(ix) || !Number.isFinite(iy)) continue;
    minX = Math.min(minX, ix); maxX = Math.max(maxX, ix);
    minY = Math.min(minY, iy); maxY = Math.max(maxY, iy);
  }
  if (!Number.isFinite(minX)) return null;
  // Zero projected range (e.g. a seam seen end-on) keeps a 50-unit frame.
  const padX = (maxX - minX) * 0.2 || 50;
  const padY = (maxY - minY) * 0.25 || 50;
  return { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
}

export function makeProjector(bounds) {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  return (p) => {
    const { ix, iy } = isoProject(p);
    return {
      x: SVG.PAD_X + ((ix - bounds.minX) / rangeX) * (SVG.W - SVG.PAD_X * 2),
      y: SVG.H - SVG.PAD_Y - ((iy - bounds.minY) / rangeY) * (SVG.H - SVG.PAD_Y * 2),
    };
  };
}

const vecOf = (p) => [p.x, p.y, p.z];

/**
 * @param {object} record  job revision record
 * @returns {null | {points, segments, weldPolyline, seamBand, basis, labels}}
 */
export function buildScene25d(record) {
  if (!record || !record.path || !record.path.waypoints.length) return null;
  const { waypoints, segments } = record.path;
  const arc = record.geometry && record.geometry.arc;
  const samples = arc && Array.isArray(arc.samples) ? arc.samples.map(vecOf) : [];

  const bounds = computeBounds([...waypoints.map((w) => w.pos), ...samples]);
  if (!bounds) return null;
  const project = makeProjector(bounds);
  const byName = new Map(waypoints.map((w) => [w.name, w]));

  const points = waypoints.map((w) => ({ name: w.name, type: w.type, pos: w.pos, ...project(w.pos) }));
  const pointByName = new Map(points.map((p) => [p.name, p]));

  const segs = [];
  for (const seg of segments) {
    if (!seg.from) continue; // first move starts from an unknown robot position
    const style = ROLE_STYLE[seg.role] || ROLE_STYLE.air;
    const polyline = seg.instruction === "MoveC" && samples.length >= 2
      ? samples.map(project)
      : [project(byName.get(seg.from).pos), project(byName.get(seg.to).pos)];
    segs.push({ index: seg.index, role: seg.role, instruction: seg.instruction, from: seg.from, to: seg.to, via: seg.via || null, polyline, style });
  }
  const weldSeg = segs.find((s) => s.role === "weld") || null;

  // 2D seam basis for label placement.
  const start = points.find((p) => p.type === "weld_start");
  const end = points.find((p) => p.type === "weld_end");
  let u = { x: 1, y: 0 };
  let mid = { x: SVG.W / 2, y: SVG.H / 2 };
  if (start && end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) u = { x: dx / l, y: dy / l };
    mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  let n = { x: -u.y, y: u.x };
  if (n.y > 0 || (Math.abs(n.y) < 1e-3 && n.x > 0)) n = { x: -n.x, y: -n.y };

  const offsetFor = (p) => {
    switch (p.type) {
      case "approach": return { dx: n.x * 35 - u.x * 25, dy: n.y * 35 - u.y * 25 };
      case "retract": return { dx: n.x * 35 + u.x * 25, dy: n.y * 35 + u.y * 25 };
      case "weld_start": return { dx: -n.x * 35 - u.x * 20, dy: -n.y * 35 - u.y * 20 };
      case "weld_end": return { dx: -n.x * 35 + u.x * 20, dy: -n.y * 35 + u.y * 20 };
      case "weld_via": {
        const vx = p.x - mid.x;
        const vy = p.y - mid.y;
        const l = Math.hypot(vx, vy);
        return l > 1 ? { dx: (vx / l) * 32, dy: (vy / l) * 32 } : { dx: n.x * 32, dy: n.y * 32 };
      }
      case "home": return { dx: 0, dy: -28 };
      default: return { dx: 0, dy: -18 };
    }
  };
  const labels = resolveLabelOverlaps(points.map((p) => {
    const o = offsetFor(p);
    const text = labelText(p.name, p.type);
    return { name: p.name, type: p.type, text, w: labelWidth(text), h: LABEL_HEIGHT, x: p.x + o.dx, y: p.y + o.dy, anchorX: p.x, anchorY: p.y };
  }));

  const widthMm = record.geometry && record.geometry.seamWidthMm;
  const seamBand = weldSeg && Number.isFinite(widthMm)
    ? { polyline: weldSeg.polyline, physicalWidthMm: widthMm, strokePx: 12, note: "Translucent band is a fixed 12 px visual aid; it is not drawn to the physical seam width." }
    : null;

  return {
    points,
    pointByName,
    segments: segs,
    weldPolyline: weldSeg ? weldSeg.polyline : null,
    seamBand,
    basis: { u, n, mid },
    labels,
    bounds,
  };
}

export const polylineToPath = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
