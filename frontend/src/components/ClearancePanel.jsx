"use client";

import React from "react";
import { Card, StateBadge } from "./StatusPanels";
import { clearanceSummary } from "@/lib/clearanceView";

const fmt = (v, dp = 3) => (Number.isFinite(v) ? v.toFixed(dp) : "—");
const SCOPE_LABEL = {
  target_position: "Target position",
  tcp_path: "TCP path",
  tool_envelope_at_target: "Torch envelope at target",
  tool_envelope_swept: "Torch envelope along move",
};

function subjectText(s) {
  if (s.kind === "target") return `target ${s.name}${s.capsule ? ` · capsule ${s.capsule}` : ""}`;
  return `S${s.index} ${s.instruction} ${s.from}→${s.to}${s.portion ? ` · ${s.portion} ${fmt(s.fromMm, 1)}–${fmt(s.toMm, 1)} mm` : ""}${s.capsule ? ` · capsule ${s.capsule}` : ""}`;
}

function findingNumbers(f) {
  const parts = [];
  if (Number.isFinite(f.maxDepthMm)) parts.push(`max depth ${fmt(f.maxDepthMm)} mm`);
  if (Number.isFinite(f.depthMm)) parts.push(`depth ${fmt(f.depthMm)} mm`);
  if (Number.isFinite(f.overlapDepthLowerBoundMm)) parts.push(`overlap ≥ ${fmt(f.overlapDepthLowerBoundMm)} mm (lower bound)`);
  if (Number.isFinite(f.distanceMm)) parts.push(`distance ${fmt(f.distanceMm)} mm`);
  if (Number.isFinite(f.coreDistanceMm)) parts.push(`core distance ${fmt(f.coreDistanceMm)} mm vs radius ${f.radiusMm} mm`);
  if (Number.isFinite(f.toleranceMm)) parts.push(`tolerance ${f.toleranceMm} mm`);
  return parts.join(" · ");
}

/** Stored workpiece-clearance diagnostics. Display only: the backend computed and stored every value. */
export default function ClearancePanel({ record, onSelectSegment }) {
  const c = clearanceSummary(record);
  if (!c) {
    return (
      <Card title="Workpiece clearance (modeled plates only)" icon="deployed_code">
        <p className="text-[11px]"><StateBadge value="not_recorded" /></p>
      </Card>
    );
  }
  const seg = c.counts.tcpPathSegments;
  const env = c.counts.toolEnvelopeSegments;
  return (
    <Card title="Workpiece clearance (modeled plates only)" icon="deployed_code">
      <div className="flex flex-col gap-2 text-[11px]" data-testid="clearance-panel">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="font-bold text-on-surface-variant">Geometry</dt>
          <dd>{c.geometry.label}{c.geometry.definitionSha256 ? <span className="font-mono text-[10px] text-on-surface-variant"> · {c.geometry.definitionSha256.slice(0, 12)}…</span> : null}</dd>
          <dt className="font-bold text-on-surface-variant">Torch envelope</dt>
          <dd>{c.toolEnvelope.kind === "unknown" ? "Unknown — torch body not checked" : `${c.toolEnvelope.provenance === "synthetic_fixture" ? "SYNTHETIC dimensions" : "Operator-defined"} capsules (tool frame)`}</dd>
          <dt className="font-bold text-on-surface-variant">Result (assessed scope)</dt>
          <dd><StateBadge value={c.result} /></dd>
          <dt className="font-bold text-on-surface-variant">Real workpiece</dt>
          <dd><StateBadge value={c.realWorkpiece} /> <span className="block text-[10px] text-on-surface-variant mt-0.5">{c.realWorkpieceNote}</span></dd>
          <dt className="font-bold text-on-surface-variant">Target positions</dt>
          <dd><StateBadge value={c.categories.targetPositions} /></dd>
          <dt className="font-bold text-on-surface-variant">TCP path</dt>
          <dd><StateBadge value={c.categories.tcpPath} /> <span className="text-[10px]">segments: {seg.assessed} assessed · {seg.partiallyAssessed} partially · {seg.notAssessed} not assessed (of {seg.total})</span></dd>
          <dt className="font-bold text-on-surface-variant">Torch envelope</dt>
          <dd><StateBadge value={c.categories.toolEnvelope} /> <span className="text-[10px]">segments: {env.assessed} assessed · {env.partiallyAssessed} partially · {env.notAssessed} not assessed</span></dd>
          <dt className="font-bold text-on-surface-variant">Tolerances</dt>
          <dd className="font-mono text-[10px]">grazing {c.tolerances.grazingToleranceMm} mm · weld-tip contact {c.tolerances.weldContactToleranceMm} mm within {c.tolerances.weldContactZoneMm} mm of a weld target · ε {c.tolerances.numericalEpsilonMm} mm</dd>
        </dl>
        {c.blocksExport && (
          <p role="alert" className="font-bold text-red-900 bg-red-50 border border-red-300 rounded px-2 py-1">
            Definite intersection with the operator-defined workpiece: ordinary module export is blocked for this revision. Correct the geometry,
            welding side, traversal or stand-offs as a new revision. The offline evidence package keeps this failure.
          </p>
        )}
        {c.findings.length > 0 && (
          <div>
            <p className="font-bold mb-1">Findings ({c.findings.length})</p>
            <ul className="flex flex-col gap-1 max-h-56 overflow-auto" aria-label="Clearance findings">
              {c.findings.slice(0, 40).map((f) => (
                <li key={f.id} className="border border-outline-variant/50 rounded px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px]">{f.id} · {SCOPE_LABEL[f.scope] || f.scope} · {f.part}</span>
                    <StateBadge value={f.result} compact />
                  </div>
                  <button type="button" className="text-left underline decoration-dotted disabled:no-underline" disabled={!onSelectSegment || f.subject.kind !== "segment"} onClick={() => onSelectSegment && onSelectSegment(f.subject.index)}>
                    {subjectText(f.subject)}
                  </button>
                  <span className="block text-[10px] text-on-surface-variant">{f.kind.replace(/_/g, " ")}{findingNumbers(f) ? ` · ${findingNumbers(f)}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {c.unassessedByReason.length > 0 && (
          <div>
            <p className="font-bold mb-1">Not assessed</p>
            <ul className="list-disc pl-5 flex flex-col gap-0.5">
              {c.unassessedByReason.map((u) => <li key={u.code}><span className="font-mono text-[10px]">{u.code} ×{u.count}</span>: {u.message}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[10px] text-on-surface-variant leading-relaxed">{c.scope} Method {c.methodVersion}.</p>
      </div>
    </Card>
  );
}
