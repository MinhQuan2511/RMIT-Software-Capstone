"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import TargetTable from "@/components/TargetTable";
import ReviewPanel from "@/components/ReviewPanel";
import MotionProfileForm from "@/components/MotionProfileForm";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { useTestingWorkflow } from "@/components/TestingWorkflowContext";
import { useToast } from "@/components/ToastContext";
import { api } from "@/services/apiClient";
import { FIELDS, suggestMapping, suggestOrientation, buildPointListDocument } from "@/lib/pointListMapping";
import { Card, DiagnosticsList, Icon, InlineError, JobIdentityCard } from "@/components/StatusPanels";

function MappingEditor({ sheet, onStored }) {
  const { showToast } = useToast();
  const [mapping, setMapping] = useState(() => suggestMapping(sheet.headers));
  const [orientation, setOrientation] = useState(() => suggestOrientation(suggestMapping(sheet.headers)));
  const [configuration, setConfiguration] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const built = useMemo(() => buildPointListDocument({ rows: sheet.rows, mapping, orientationConvention: orientation, configurationPolicy: configuration }), [sheet, mapping, orientation, configuration]);
  const visibleFields = FIELDS.filter((f) => !f.group || f.group === orientation || (f.group === "columns" && configuration === "columns"));

  const store = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.createPointListSource(sheet.fileName, built.document);
      showToast(r.preview.ok ? "Point list stored" : "Point list stored with errors", r.preview.ok ? `${r.preview.rowCount} rows validated by the backend.` : "Fix the listed rows and store again.", r.preview.ok ? "success" : "error");
      onStored(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Map columns of ${sheet.fileName}`} icon="table_view">
      <fieldset className="flex flex-col gap-2 mb-3">
        <legend className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Orientation is given as</legend>
        <label className="text-xs flex items-center gap-2"><input type="radio" name="orient" checked={orientation === "quaternion_wxyz"} onChange={() => setOrientation("quaternion_wxyz")} />Quaternion q1..q4 = [w, x, y, z] (norm must be within 0.001 of 1)</label>
        <label className="text-xs flex items-center gap-2"><input type="radio" name="orient" checked={orientation === "euler_zyx_deg"} onChange={() => setOrientation("euler_zyx_deg")} />Euler Rx, Ry, Rz in degrees, R = Rz·Ry·Rx</label>
      </fieldset>
      <fieldset className="flex flex-col gap-2 mb-3">
        <legend className="text-[10px] font-bold uppercase text-on-surface-variant mb-1">Robot configuration</legend>
        <label className="text-xs flex items-center gap-2"><input type="radio" name="conf" checked={configuration === "fixed_zero"} onChange={() => setConfiguration("fixed_zero")} />Use [0,0,0,0] for every target (not solved; validate in RobotStudio)</label>
        <label className="text-xs flex items-center gap-2"><input type="radio" name="conf" checked={configuration === "columns"} onChange={() => setConfiguration("columns")} />Read cf1, cf4, cf6, cfx columns</label>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        {visibleFields.map((f) => (
          <label key={f.key} className="text-[11px] font-bold flex flex-col gap-0.5">{f.label}{f.required ? " *" : ""}
            <select value={mapping[f.key] || ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))} className="font-normal font-mono border border-outline-variant rounded px-1.5 py-1 bg-surface-container-highest">
              <option value="">— not mapped —</option>
              {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </label>
        ))}
      </div>
      {built.problems.length > 0 && <ul className="mt-3 text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded p-2 list-disc pl-5">{built.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {built.document && <p className="mt-2 text-[11px] text-on-surface-variant">{built.document.rows.length} rows will be stored{built.skippedEmptyRows ? `; ${built.skippedEmptyRows} empty row(s) skipped` : ""}. Values are validated by the backend, not defaulted.</p>}
      <InlineError error={error} />
      <button type="button" onClick={store} disabled={!built.document || busy} className="mt-3 w-full bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2.5 text-xs font-bold uppercase">{busy ? "Storing…" : "Store point list as a source"}</button>
    </Card>
  );
}

export default function TestingPreviewPage() {
  const router = useRouter();
  const { projectId, sourceId, selectSource, job, applyJobView, closeJob } = useWorkflowSession();
  const { sheet, image } = useTestingWorkflow();
  const { showToast } = useToast();
  const [stored, setStored] = useState({ key: null, data: null, error: null });
  const [profiles, setProfiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pointSource = sourceId && sourceId.startsWith("src_points_") ? sourceId : null;

  useEffect(() => {
    if (!pointSource) return undefined;
    const controller = new AbortController();
    api.getSource(pointSource, controller.signal).then((d) => setStored({ key: pointSource, data: d, error: null })).catch((err) => { if (!err.cancelled) setStored({ key: pointSource, data: null, error: err }); });
    return () => controller.abort();
  }, [pointSource]);

  useEffect(() => {
    let cancelled = false;
    api.profiles().then((d) => { if (!cancelled) setProfiles(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const storedView = stored.key === pointSource ? stored : { data: null, error: null };
  const testingJob = job && job.record.mode === "testing" ? job : null;

  const createJob = async () => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.createJob(projectId, pointSource);
      applyJobView(view);
      showToast("Job created", `Revision ${view.record.revision}: ${view.record.path.targetCount} targets. Review below.`, "success");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const reprocess = async (parameters) => {
    setBusy(true);
    setError(null);
    try {
      const view = await api.reprocess(testingJob.record.jobId, testingJob.record.revision, parameters);
      applyJobView(view);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative min-h-0">
      <aside className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[46%] min-w-[420px] h-full pt-5 px-5 gap-3 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Testing mode: map and review</h1>
          <p className="text-xs text-on-surface-variant mt-1">Map the columns, store the point list, create a job, then review it like any other revision.</p>
        </div>
        <StepperProgress />

        {testingJob ? (
          <>
            <JobIdentityCard record={testingJob.record} gates={testingJob.gates} />
            <Card title="Diagnostics" icon="report"><DiagnosticsList diagnostics={testingJob.record.diagnostics} /></Card>
            <ReviewPanel nextPath="/generate" />
            <InlineError error={error} />
            {profiles && <MotionProfileForm key={`${testingJob.record.jobId}#${testingJob.record.revision}`} record={testingJob.record} speeds={profiles.speeds} zones={profiles.zones} busy={busy} disabled={!testingJob.gates.isLatest} onReprocess={reprocess} />}
            <button type="button" onClick={() => { closeJob(); selectSource(null); router.push("/testing-upload"); }} className="self-start text-xs font-bold text-primary underline">Start a new point list (this job stays stored)</button>
          </>
        ) : (
          <>
            {sheet && <MappingEditor key={sheet.fileName + sheet.rows.length} sheet={sheet} onStored={(r) => { selectSource(r.source.id); setStored({ key: r.source.id, data: { source: r.source, preview: r.preview }, error: null }); }} />}
            {!sheet && !pointSource && (
              <Card title="Nothing staged" icon="info">
                <p className="text-xs text-on-surface-variant">The spreadsheet is kept only in memory and is not available after a reload. Upload it again.</p>
                <button type="button" onClick={() => router.push("/testing-upload")} className="mt-2 bg-primary text-on-primary rounded px-3 py-1.5 text-xs font-bold">Go to Upload</button>
              </Card>
            )}
            {pointSource && (
              <Card title="Stored point list" icon="inventory_2">
                {storedView.error && <InlineError error={storedView.error} />}
                {storedView.data && (
                  <>
                    <p className="text-xs font-mono break-all mb-2">{storedView.data.source.displayName} · {storedView.data.source.id}</p>
                    <DiagnosticsList diagnostics={storedView.data.preview.diagnostics} emptyText="All rows validated." />
                    <InlineError error={error} />
                    <button type="button" onClick={createJob} disabled={busy || !storedView.data.preview.ok} className="mt-3 w-full bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-2">
                      <Icon name={busy ? "progress_activity" : "play_arrow"} className={busy ? "animate-spin" : ""} />
                      {storedView.data.preview.ok ? "Create job from this point list" : "Fix the rows before creating a job"}
                    </button>
                  </>
                )}
              </Card>
            )}
          </>
        )}
        <div className="pb-4" />
      </aside>

      <div className="flex-1 h-full overflow-y-auto bg-background p-6 flex flex-col gap-4 min-w-0">
        {testingJob && <div className="bg-surface border border-outline-variant rounded-xl p-4"><TargetTable record={testingJob.record} /></div>}
        {!testingJob && sheet && (
          <div className="bg-surface border border-outline-variant rounded-xl p-4 overflow-x-auto">
            <p className="text-[10px] font-bold uppercase text-on-surface-variant mb-2">Raw rows as read (first 50 of {sheet.rows.length})</p>
            <table className="text-[11px] font-mono">
              <thead><tr>{["row", ...sheet.headers].map((h) => <th key={h} scope="col" className="text-left pr-3 pb-1 border-b border-outline-variant/40">{h}</th>)}</tr></thead>
              <tbody>{sheet.rows.slice(0, 50).map((r) => <tr key={r.__rowNumber}>{[r.__rowNumber, ...sheet.headers.map((h) => r[h])].map((v, i) => <td key={i} className="pr-3 py-0.5">{String(v)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
        {image && (
          <figure className="bg-surface border border-outline-variant rounded-xl p-4">
            <Image src={image.url} alt={`Reference image ${image.name}`} width={image.width} height={image.height} unoptimized className="max-h-[360px] w-auto h-auto object-contain mx-auto" />
            <figcaption className="text-[11px] text-on-surface-variant mt-2 text-center">Reference image (documentation only; not calibration or measured geometry).</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
