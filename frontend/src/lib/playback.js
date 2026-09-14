/**
 * Browser preview playback: one clock and one timeline for torch position,
 * orientation, path highlighting, bead growth and arc-effect gating.
 *
 * This is an illustrative animation. It does not reproduce MoveJ joint motion,
 * RobotWare zone blending, acceleration or controller orientation
 * interpolation, and its duration is a chosen preview length — not a measured
 * or estimated cycle time.
 */

import { slerp } from "./viewTransform.js";

export const PREVIEW_DURATION_S = 12;
export const SPEEDS = [0.25, 0.5, 1, 2, 4];

// Share of the preview given to each role in the six-instruction weld template.
// Reproduces the previous scripted split: approach 15 %, touch-down 10 %,
// weld 50 %, retract 10 %, return 15 %. The initial MoveJ to home starts from an
// unknown robot position and is shown as the starting pose (zero duration).
const ROLE_WEIGHT = { approach: 0.1, weld: 0.5, retract: 0.1 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const vec = (p) => [p.x, p.y, p.z];

/** Exact point on the canonical fitted circle at angle theta (radians) from the start. */
export function arcPoint(arc, theta) {
  const c = vec(arc.center);
  const n = vec(arc.normal);
  const e1 = unit(sub(vec(arc.start), c));
  const e2 = cross(n, e1);
  const r = arc.radiusMm;
  return [0, 1, 2].map((i) => c[i] + r * (Math.cos(theta) * e1[i] + Math.sin(theta) * e2[i]));
}

/**
 * @param {{waypoints: object[], segments: object[]}} path  canonical revision path
 * @param {object|null} arc  record.geometry.arc
 */
export function buildTimeline(path, arc, durationS = PREVIEW_DURATION_S) {
  const byName = new Map(path.waypoints.map((w) => [w.name, w]));
  const weldIndex = path.segments.findIndex((s) => s.role === "weld");
  const raw = path.segments.map((seg, i) => {
    if (seg.from === null) return 0;
    if (ROLE_WEIGHT[seg.role] !== undefined) return ROLE_WEIGHT[seg.role];
    if (seg.role === "air") return 0.15;
    // Point lists: proportional to straight-line distance, never zero.
    const a = byName.get(seg.from).pos;
    const b = byName.get(seg.to).pos;
    return Math.max(len(sub(b, a)), 1e-3) + (i === 0 ? 0 : 0);
  });
  const total = raw.reduce((x, y) => x + y, 0) || 1;
  let t = 0;
  const segments = path.segments.map((seg, i) => {
    const dur = (raw[i] / total) * durationS;
    const entry = {
      index: seg.index,
      role: seg.role,
      instruction: seg.instruction,
      from: seg.from,
      to: seg.to,
      via: seg.via || null,
      t0: t,
      t1: t + dur,
      fromPos: seg.from ? byName.get(seg.from).pos : byName.get(seg.to).pos,
      toPos: byName.get(seg.to).pos,
      fromQ: seg.from ? byName.get(seg.from).orient : byName.get(seg.to).orient,
      toQ: byName.get(seg.to).orient,
      viaQ: seg.via ? byName.get(seg.via).orient : null,
      viaFraction: seg.via && arc ? arc.viaAngleDeg / arc.sweepDeg : null,
      arc: seg.instruction === "MoveC" ? arc : null,
    };
    t += dur;
    return entry;
  });
  return { durationS, segments, weldIndex, hasWeld: weldIndex >= 0 };
}

const PHASE_LABEL = { air: "Air move", approach: "Approach", weld: "Weld path", retract: "Retract", point: "Point-to-point move" };

/**
 * @returns {{time, segmentIndex, role, instruction, fraction, position, quaternion, weldFraction, inWeld, phaseLabel}}
 */
export function sampleTimeline(timeline, timeS) {
  const time = Math.min(Math.max(timeS, 0), timeline.durationS);
  let seg = timeline.segments[timeline.segments.length - 1];
  for (const s of timeline.segments) {
    if (time < s.t1 || s === seg) { seg = s; break; }
  }
  // Skip zero-length segments whose end is already passed.
  if (seg.t1 <= time && seg !== timeline.segments[timeline.segments.length - 1]) {
    seg = timeline.segments.find((s) => time < s.t1) || timeline.segments[timeline.segments.length - 1];
  }
  const dur = seg.t1 - seg.t0;
  const fraction = dur > 0 ? Math.min(Math.max((time - seg.t0) / dur, 0), 1) : 1;

  let position;
  let quaternion;
  if (seg.arc) {
    const sweep = (seg.arc.sweepDeg * Math.PI) / 180;
    position = arcPoint(seg.arc, fraction * sweep);
    const vf = seg.viaFraction;
    quaternion = fraction <= vf ? slerp(seg.fromQ, seg.viaQ, vf > 0 ? fraction / vf : 1) : slerp(seg.viaQ, seg.toQ, vf < 1 ? (fraction - vf) / (1 - vf) : 1);
  } else {
    position = lerp3(seg.fromPos, seg.toPos, fraction);
    quaternion = slerp(seg.fromQ, seg.toQ, fraction);
  }

  let weldFraction = 0;
  if (timeline.hasWeld) {
    const w = timeline.segments[timeline.weldIndex];
    weldFraction = time <= w.t0 ? 0 : time >= w.t1 ? 1 : (time - w.t0) / (w.t1 - w.t0);
  }
  const inWeld = seg.role === "weld" && time > seg.t0 && time < seg.t1;
  const before = timeline.hasWeld && seg.index < timeline.segments[timeline.weldIndex].index;
  const phaseLabel = seg.role === "air" && timeline.hasWeld ? (before ? "Move to approach" : "Return to home") : PHASE_LABEL[seg.role] || seg.role;

  return { time, segmentIndex: seg.index, role: seg.role, instruction: seg.instruction, fraction, position, quaternion, weldFraction, inWeld, phaseLabel };
}

/**
 * Wall-clock based playback clock. Time is derived from `now()` rather than
 * integrated per frame, so any number of readers (render loop, UI label) see the
 * same value and no duplicate loop can advance it twice.
 */
export function createPlaybackClock({ durationS = PREVIEW_DURATION_S, now = () => performance.now() } = {}) {
  let playing = false;
  let speed = 1;
  let base = 0;
  let startedAt = 0;

  const raw = () => (playing ? base + ((now() - startedAt) / 1000) * speed : base);

  const clock = {
    time() {
      const t = raw();
      if (t >= durationS) {
        if (playing) { playing = false; base = durationS; }
        return durationS;
      }
      return Math.max(0, t);
    },
    play() {
      if (clock.time() >= durationS) base = 0;
      else base = clock.time();
      startedAt = now();
      playing = true;
    },
    pause() {
      base = clock.time();
      playing = false;
    },
    seek(t) {
      base = Math.min(Math.max(Number(t) || 0, 0), durationS);
      startedAt = now();
    },
    replay() {
      base = 0;
      startedAt = now();
      playing = true;
    },
    setSpeed(s) {
      if (!SPEEDS.includes(s)) return;
      base = clock.time();
      startedAt = now();
      speed = s;
    },
    snapshot() {
      const time = clock.time();
      return { time, playing, speed, durationS, ended: time >= durationS };
    },
  };
  return clock;
}
