"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import RAPIDCodeEditor from "@/components/RAPIDCodeEditor";
import WeldSimulation3D from "@/components/WeldSimulation3D";
import PlaybackControls from "@/components/PlaybackControls";
import TargetTable from "@/components/TargetTable";
import { OrientationSummary, SyntheticBanner } from "@/components/OrientationPanel";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { useToast } from "@/components/ToastContext";
import { api } from "@/services/apiClient";
import { createPlaybackClock } from "@/lib/playback";
import { isJointRelative } from "@/lib/orientationCheck";
import { usabilityLog } from "@/lib/usabilityLog";
import { Card, Icon, InlineError, JobIdentityCard, StateBadge, ValidationPanel } from "@/components/StatusPanels";

export default function GeneratePage() {
  const router = useRouter();
  const { job, operator, applyJobView } = useWorkflowSession();
  const { showToast } = useToast();
  const [clock] = useState(() => createPlaybackClock());
  const [axes, setAxes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!job) return null;
  const { record, review, gates } = job;
  const moduleReviewed = !!review.moduleReview;
  const prechecksOk = gates.validation.applicationPrechecks === "passed";
  const joint = isJointRelative(record);

  const markReviewed = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.review(record.jobId, record.revision, "module", operator);
      applyJobView(view);
      usabilityLog.record("module_reviewed", { revision: record.revision, profileId: record.profile.id });
      showToast("Module reviewed", `Revision ${record.revision} module review recorded.`, "success");
      router.push("/export");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative min-h-0">
      <aside className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[44%] min-w-[400px] h-full pt-5 px-5 gap-3 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Generate: review the candidate module</h1>
          <p className="text-xs text-on-surface-variant mt-1">Stored bytes of revision {record.revision}. Read-only; any change must be made as a new revision on Parse &amp; Map.</p>
        </div>
        <StepperProgress />
        <JobIdentityCard record={record} gates={gates} />

        <div className="flex flex-col min-h-[320px]">
          <RAPIDCodeEditor code={record.output.code} title={`Module1.mod · revision ${record.revision}`} statusText={prechecksOk ? "Application prechecks passed" : "Application prechecks failed"} outputSha256={record.output.sha256} />
        </div>

        <Card title="Application prechecks (not a RAPID compiler)" icon="fact_check">
          <ul className="flex flex-col gap-1 text-[11px]">
            {record.prechecks.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2">
                <span><span className="font-mono text-[10px] text-on-surface-variant">{c.id}</span><span className="block">{c.message}</span></span>
                <StateBadge value={c.status} compact />
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-on-surface-variant mt-2">These re-read the generated text for the structure this application emits. Whether a specific RobotWare controller accepts the module is established only by importing it there.</p>
        </Card>

        <OrientationSummary record={record} />

        <Card title="Assumptions carried by this module" icon="warning">
          <ul className="list-disc pl-5 text-[11px] flex flex-col gap-1">
            <li>{record.profile.description}</li>
            <li>{record.profile.toolDeclaration}</li>
            {record.profile.configurationNote && <li>{record.profile.configurationNote}</li>}
            {record.profile.clearancesNote && <li>Approach, retract and standby offsets: {record.profile.clearancesNote}</li>}
            {joint && <li>The joint frame and tool-axis convention are declarations. The orientation has passed a mathematical check only.</li>}
            <li>Motion only: no arc ignition, wire feed, gas or other I/O instructions.</li>
          </ul>
        </Card>

        <ValidationPanel gates={gates} />

        <InlineError error={error} />
        {moduleReviewed ? (
          <div className="flex items-center justify-between gap-2 text-xs bg-surface border border-outline-variant rounded-xl p-3">
            <span className="flex items-center gap-1 font-bold text-emerald-800"><Icon name="task_alt" className="text-[16px]" />Module reviewed by {review.moduleReview.by}</span>
            <button type="button" onClick={() => router.push("/export")} className="bg-primary text-on-primary rounded-lg px-3 py-2 text-xs font-bold uppercase">Continue to download</button>
          </div>
        ) : (
          <button type="button" onClick={markReviewed} disabled={busy || !prechecksOk || !gates.isLatest} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-surface-container-high disabled:text-on-surface-variant text-white rounded-xl py-3 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
            <Icon name={busy ? "progress_activity" : "verified"} className={busy ? "animate-spin" : ""} />
            {!prechecksOk ? "Prechecks failed: cannot review" : "I have reviewed this module text"}
          </button>
        )}
        <div className="pb-4" />
      </aside>

      <div className="flex-1 h-full relative bg-slate-950 flex flex-col overflow-hidden min-w-0">
        <div className="absolute top-3 left-3 right-3 z-20 flex flex-wrap gap-2 pointer-events-none text-[11px]">
          <span className="bg-slate-900/90 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-semibold">Browser preview · illustrative animation</span>
          <span className="bg-slate-900/90 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-mono">TOOL {record.profile.toolName}</span>
          <span className="bg-slate-900/90 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-mono">TARGETS {record.path.targetCount} · MOVES {record.path.instructionCount}</span>
          <span className="bg-slate-900/90 border border-slate-600 text-slate-300 px-3 py-1.5 rounded-lg">Reachability: not evaluated (no robot model)</span>
          <span className="bg-slate-900/90 border border-slate-600 text-slate-300 px-3 py-1.5 rounded-lg">
            {joint
              ? "Declared joint frame: white = travel, green = plate A normal, amber = plate B normal; magenta = torch axis from the stored quaternions"
              : record.geometry.plannedType === "straight" ? "Workpiece: illustrative T-joint, not imported CAD" : "No workpiece model shown"}
          </span>
          {joint && <span className="pointer-events-auto"><SyntheticBanner record={record} /></span>}
        </div>
        <div className="flex-1 relative min-h-0">
          <WeldSimulation3D record={record} clock={clock} showToolAxes={axes} fallback={<TargetTable record={record} />} />
        </div>
        <div className="p-3">
          <PlaybackControls clock={clock} record={record} showToolAxes={axes} onToggleToolAxes={setAxes} />
        </div>
      </div>
    </div>
  );
}
