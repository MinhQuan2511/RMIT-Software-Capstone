/**
 * Presentation of the STORED clearance record and plan segments. Pure.
 * Nothing here re-evaluates geometry; it only formats what the backend stored.
 */

export const CLEARANCE_STATES = {
  intersection_detected: { text: "Intersection detected", tone: "bad", icon: "report" },
  no_intersection_detected_in_assessed_geometry: { text: "No intersection detected in assessed geometry", tone: "info", icon: "check_small" },
  inconclusive: { text: "Inconclusive", tone: "pending", icon: "help" },
  not_assessed: { text: "Not assessed", tone: "neutral", icon: "remove_circle_outline" },
  not_assessed_illustrative_geometry: { text: "Not assessed for the real workpiece (illustrative geometry)", tone: "neutral", icon: "draw" },
  not_recorded: { text: "Not recorded (revision predates clearance checks)", tone: "neutral", icon: "remove_circle_outline" },
};

export const ROLE_LABEL = { air: "Transfer", approach: "Approach", weld: "Weld", retract: "Retract", point: "Point move" };
export const CONNECTOR_LABEL = {
  linear: "Linear TCP path (MoveL) between corner zones",
  schematic: "Schematic connector — joint-space motion, clearance not assessed",
  arc: "Circular TCP path (MoveC) — clearance not assessed",
  none: "From the unknown program-start position — not drawn",
};

/** 'operator_defined' | 'illustrative' | 'unavailable' and the label the UI must show. */
export function workpieceMode(record) {
  const wp = record && record.workpiece;
  if (!wp || wp.kind !== "fillet90_plates") return { mode: "unavailable", label: "Workpiece geometry unavailable" };
  return { mode: wp.provenance === "operator_defined" ? "operator_defined" : "illustrative", label: wp.label };
}

function connectorFor(seg) {
  if (!seg.from) return "none";
  if (seg.instruction === "MoveL") return "linear";
  if (seg.instruction === "MoveC") return "arc";
  return "schematic";
}

/** One row per stored segment, with the stored clearance results when present. */
export function segmentRows(record) {
  const stored = record && record.clearance ? new Map(record.clearance.segments.map((s) => [s.index, s])) : new Map();
  const findings = record && record.clearance ? record.clearance.findings : [];
  return record.path.segments.map((seg) => {
    const c = stored.get(seg.index);
    return {
      index: seg.index,
      id: `S${seg.index}`,
      instruction: seg.instruction,
      role: seg.role,
      roleLabel: ROLE_LABEL[seg.role] || seg.role,
      from: seg.from,
      to: seg.to,
      via: seg.via || null,
      speed: seg.speed,
      zone: seg.zone,
      connector: c ? c.connector : connectorFor(seg),
      tcpPath: c ? c.tcpPath.result : "not_recorded",
      tcpCoverage: c ? c.tcpPath.coverage : "not_assessed",
      toolEnvelope: c ? c.toolEnvelope.result : "not_recorded",
      reason: c ? (c.tcpPath.reasonCode || c.toolEnvelope.reasonCode || null) : null,
      findings: findings.filter((f) => f.subject.kind === "segment" && f.subject.index === seg.index),
    };
  });
}

/** Points to mark in 3D: where a definite or inconclusive finding is located (target frame, mm). */
export function findingMarkers(record) {
  if (!record || !record.clearance) return [];
  return record.clearance.findings.map((f) => {
    const point = f.deepestPoint || f.entryPoint || f.point || f.witnessOnMaterial || f.closestOnMaterial || null;
    return point ? { id: f.id, result: f.result, point, scope: f.scope, part: f.part, subject: f.subject } : null;
  }).filter(Boolean);
}

export function clearanceSummary(record) {
  const c = record && record.clearance;
  if (!c) return null;
  return {
    result: c.overall.result,
    realWorkpiece: c.overall.realWorkpiece,
    realWorkpieceNote: c.overall.realWorkpieceNote,
    geometry: c.geometry,
    toolEnvelope: c.toolEnvelope,
    categories: c.categories,
    counts: c.counts,
    tolerances: c.tolerances,
    blocksExport: c.overall.blocksExport,
    findings: c.findings,
    unassessedByReason: Object.entries(c.unassessed.reduce((acc, u) => { acc[u.reasonCode] = (acc[u.reasonCode] || 0) + 1; return acc; }, {})).map(([code, count]) => ({ code, count, message: c.unassessed.find((u) => u.reasonCode === code).message })),
    methodVersion: c.methodVersion,
    scope: c.scope,
  };
}
