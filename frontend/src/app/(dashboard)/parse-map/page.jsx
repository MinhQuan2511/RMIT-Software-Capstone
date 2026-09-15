"use client";

import React, { useEffect, useState } from "react";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import Toolpath25D from "@/components/Toolpath25D";
import TargetTable from "@/components/TargetTable";
import ReviewPanel from "@/components/ReviewPanel";
import MotionProfileForm from "@/components/MotionProfileForm";
import { JointOrientationForm, OrientationSummary } from "@/components/OrientationPanel";
import WorkpieceEditor from "@/components/WorkpieceEditor";
import ClearancePanel from "@/components/ClearancePanel";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { useToast } from "@/components/ToastContext";
import { api } from "@/services/apiClient";
import { usabilityLog } from "@/lib/usabilityLog";
import { Card, DiagnosticsList, InlineError, JobIdentityCard, StateBadge } from "@/components/StatusPanels";

const n = (v, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

function GeometryCard({ record }) {
  const g = record.geometry;
  const a = g.arc;
  const rows = [
    ["Planned seam", g.plannedType + (g.requestedType !== g.plannedType ? ` (requested ${g.requestedType})` : "")],
    [g.plannedType === "arc" ? "Arc length" : "Length", `${n(g.lengthMm)} mm`],
    ["Chord length", `${n(g.chordLengthMm)} mm`],
    ...(g.slopeDeg !== null && g.slopeDeg !== undefined ? [["Slope", `${n(g.slopeDeg)}°`]] : []),
    ["Seam width", `${n(g.seamWidthMm)} mm (${g.seamWidthProvenance === "default" ? "configured default" : "from file"}; display only)`],
    ...(a ? [
      ["Radius", `${n(a.radiusMm, 3)} mm`],
      ["Sweep", `${n(a.sweepDeg, 3)}° (via at ${n(a.viaAngleDeg, 2)}°)`],
      ["Max arc–chord deviation", `${n(a.maxChordDeviationMm, 3)} mm`],
      ["Direction", a.direction.replace(/_/g, " ")],
      ["Plane tilt", `${n(a.planeTiltDeg)}°`],
    ] : []),
    ...(g.conversion ? [["Conversion", `arc → straight, max deviation ${n(g.conversion.maxChordDeviationMm, 4)} mm`]] : []),
    ...(g.traversal ? [["Traversal", g.traversal.mode === "reversed" ? "reversed: measured end → measured start" : "as measured"]] : []),
    ["Workpiece", record.workpiece ? `${record.workpiece.label}${record.workpiece.arrangement ? ` (${record.workpiece.arrangement})` : ""}` : "not recorded"],
    ["Units / frame", `${record.coordinates.units} (${record.coordinates.unitsProvenance}) · ${record.coordinates.frame} (${record.coordinates.frameProvenance})`],
    ...(g.homeZ ? [["Standby Z", `${g.homeZ.formula}: ${n(g.homeZ.maxWeldZMm, 3)} + ${g.homeZ.homeLiftMm} mm`]] : []),
    ...(g.standby ? [["Standby", `${g.standby.formula}: ${g.standby.homeStandoffMm} mm`]] : []),
    ...(record.coordinates.calibrationReference ? [["Calibration file", `${record.coordinates.calibrationReference.displayName} referenced for provenance; not applied`]] : []),
  ];
  if (g.plannedType === "point_list") {
    rows.splice(0, rows.length,
      ["Plan", "point list (Testing mode)"], ["Targets", String(g.pointCount)], ["Home row", g.hasHome ? "present" : "absent"],
      ["Straight-line path length", `${n(g.pathLengthMm)} mm (between consecutive targets)`], ["Orientation", g.orientationConvention], ["Configuration", g.configurationPolicy]);
  }
  return (
    <Card title="Geometry (from the stored revision)" icon="straighten">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="font-bold text-on-surface-variant">{k}</dt><dd className="font-mono break-words">{v}</dd></React.Fragment>))}
      </dl>
      {g.offsetConvention && <p className="text-[10px] text-on-surface-variant mt-2 leading-relaxed">Offset convention: {g.offsetConvention}</p>}
    </Card>
  );
}

export default function ParseMapPage() {
  const { job, applyJobView, reloadJob } = useWorkflowSession();
  const { showToast } = useToast();
  const [profiles, setProfiles] = useState({ data: null, error: null });
  const [busy, setBusy] = useState(false);
  const [reprocessError, setReprocessError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.profiles().then((d) => { if (!cancelled) setProfiles({ data: d, error: null }); }).catch((err) => { if (!cancelled) setProfiles({ data: null, error: err }); });
    return () => { cancelled = true; };
  }, []);

  if (!job) return null;
  const { record, gates } = job;

  const reprocess = async (parameters) => {
    setBusy(true);
    setReprocessError(null);
    try {
      const view = await api.reprocess(record.jobId, record.revision, parameters);
      applyJobView(view);
      if (!view.reused) usabilityLog.record("revision_created", { revision: view.record.revision, profileId: view.record.profile.id });
      showToast(view.reused ? "No change" : `Revision ${view.record.revision} created`, view.reused ? "These parameters match the current revision." : "Review the new geometry; earlier reviews do not carry over.", view.reused ? "info" : "success");
    } catch (err) {
      setReprocessError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative min-h-0">
      <div className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[44%] min-w-[400px] h-full pt-5 px-5 gap-3 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Parse &amp; Map: review geometry</h1>
          <p className="text-xs text-on-surface-variant mt-1">Everything on this page comes from stored revision {record.revision}. Nothing is re-derived in the browser.</p>
        </div>
        <StepperProgress />
        <JobIdentityCard record={record} gates={gates} />
        <Card title="Processing stages" icon="checklist">
          <ul className="flex flex-col gap-1 text-[11px]">
            <li className="flex justify-between"><span>Input / schema</span><StateBadge value={gates.validation.input} /></li>
            <li className="flex justify-between"><span>Geometry checks</span><StateBadge value={gates.validation.geometry} /></li>
            <li className="flex justify-between"><span>Orientation (mathematical check)</span><StateBadge value={gates.validation.orientationCheck} /></li>
            <li className="flex justify-between"><span>Application prechecks on the module</span><StateBadge value={gates.validation.applicationPrechecks} /></li>
            <li className="flex justify-between gap-2"><span>Workpiece clearance (modeled plates only)</span><StateBadge value={gates.validation.workpieceClearance || "not_recorded"} /></li>
            <li className="flex justify-between"><span>Reachability / robot and cell collision</span><StateBadge value="not_evaluated" /></li>
          </ul>
        </Card>
        <Card title="Diagnostics" icon="report">
          <DiagnosticsList diagnostics={record.diagnostics} />
        </Card>
        <ReviewPanel nextPath="/generate" />
        {profiles.error && <InlineError error={profiles.error} />}
        <InlineError error={reprocessError} onRetry={reprocessError && reprocessError.status === 409 ? reloadJob : null} />
        {profiles.data && record.mode === "file_import" && (
          <JointOrientationForm key={`orient-${record.jobId}#${record.revision}`} record={record} profilesData={profiles.data} disabled={!gates.isLatest} busy={busy} onReprocess={reprocess} />
        )}
        {profiles.data && record.mode === "file_import" && (
          <WorkpieceEditor key={`wp-${record.jobId}#${record.revision}`} record={record} profilesData={profiles.data} disabled={!gates.isLatest} busy={busy} onReprocess={reprocess} />
        )}
        {profiles.data && (
          <MotionProfileForm key={`${record.jobId}#${record.revision}`} record={record} speeds={profiles.data.speeds} zones={profiles.data.zones} disabled={!gates.isLatest} busy={busy} onReprocess={reprocess} />
        )}
        <div className="pb-4" />
      </div>

      <Active3DViewport title={`Toolpath · revision ${record.revision} (2.5D isometric projection)`}>
        <div className="flex flex-col gap-4 max-w-[900px] mx-auto">
          <div className="bg-surface/95 border border-outline-variant/40 rounded-xl p-4 shadow-lg">
            <Toolpath25D record={record} />
          </div>
          <OrientationSummary record={record} />
          <ClearancePanel record={record} />
          <GeometryCard record={record} />
          <div className="bg-surface/95 border border-outline-variant/40 rounded-xl p-4 shadow-lg">
            <TargetTable record={record} />
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
