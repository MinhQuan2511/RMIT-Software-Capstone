"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import { useToast } from "@/components/ToastContext";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { api } from "@/services/apiClient";
import { Card, DiagnosticsList, Icon, InlineError, SourceKindBadge } from "@/components/StatusPanels";
import { shortHash, PROVENANCE_LABEL } from "@/lib/statusLabels";
import { usabilityLog } from "@/lib/usabilityLog";

const STATUS = {
  Writing: { icon: "edit_note", cls: "bg-amber-500/10 text-amber-800", hint: "Waiting for size and modification time to settle" },
  Ready: { icon: "fiber_new", cls: "bg-green-500/10 text-green-800", hint: "Stored as a new source during this scan" },
  Ingested: { icon: "inventory_2", cls: "bg-blue-500/10 text-blue-800", hint: "Already stored (same bytes)" },
  Ignored: { icon: "block", cls: "bg-slate-500/10 text-slate-600", hint: "Not a seam descriptor" },
  Error: { icon: "error", cls: "bg-red-500/10 text-red-800", hint: "Could not be read" },
  Staged: { icon: "upload_file", cls: "bg-amber-500/10 text-amber-800", hint: "Selected in this browser, not uploaded yet" },
  Uploaded: { icon: "cloud_done", cls: "bg-green-500/10 text-green-800", hint: "Stored as a source" },
};

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function StatusChip({ status }) {
  const s = STATUS[status] || STATUS.Error;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${s.cls}`} title={s.hint}>
      <Icon name={s.icon} className="text-[13px]" />{status}
    </span>
  );
}

function PreviewChip({ preview }) {
  if (!preview) return <span className="text-[10px] text-on-surface-variant">—</span>;
  const errors = preview.errorCount ?? (preview.diagnostics ? preview.diagnostics.filter((d) => d.severity === "error").length : 0);
  return preview.ok
    ? <span className="text-[10px] font-bold text-emerald-800 flex items-center gap-1"><Icon name="check" className="text-[13px]" />Valid {preview.seamType}</span>
    : <span className="text-[10px] font-bold text-red-800 flex items-center gap-1"><Icon name="close" className="text-[13px]" />{errors} error(s)</span>;
}

export default function AcquirePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { projectId, sourceId, selectSource, applyJobView, job, operator } = useWorkflowSession();

  const [method, setMethod] = useState("watched-folder");
  const [watch, setWatch] = useState({ data: null, error: null });
  const [draft, setDraft] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [scan, setScan] = useState({ data: null, error: null });
  const [scanNonce, setScanNonce] = useState(0);
  const [staged, setStaged] = useState([]);
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProvenance, setUploadProvenance] = useState("user_supplied_unverified");
  const [declaring, setDeclaring] = useState({ value: "", note: "", busy: false, error: null });
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [selected, setSelected] = useState({ key: null, data: null, error: null });
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [log, setLog] = useState([]);
  const [tab, setTab] = useState("log");
  const seenReady = useRef(new Set());

  const addLog = (text, tone = "info") => setLog((l) => [...l.slice(-49), { at: new Date().toLocaleTimeString(), text, tone }]);

  // Watched-folder configuration.
  useEffect(() => {
    if (method !== "watched-folder") return undefined;
    const controller = new AbortController();
    api.watchStatus(controller.signal)
      .then((d) => { setWatch({ data: d, error: null }); setDraft((cur) => cur || d.configured); })
      .catch((err) => { if (!err.cancelled) setWatch({ data: null, error: err }); });
    return () => controller.abort();
  }, [method]);

  // Poll every 3 s while this page is open with the watched folder selected.
  // Overlapping polls are skipped; leaving the page or switching method stops polling.
  useEffect(() => {
    if (method !== "watched-folder") return undefined;
    let cancelled = false;
    let inFlight = false;
    let controller = null;
    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      api.scanWatchFolder(controller.signal)
        .then((d) => {
          if (cancelled) return;
          setScan({ data: d, error: null });
          const fresh = (d.files || []).filter((f) => f.status === "Ready" && !seenReady.current.has(f.sourceId));
          fresh.forEach((f) => seenReady.current.add(f.sourceId));
          if (fresh.length) setLog((l) => [...l.slice(-49), ...fresh.map((f) => ({ at: new Date().toLocaleTimeString(), text: `Stored ${f.name} as ${f.sourceId} (${f.preview && f.preview.ok ? "valid" : "has errors"})`, tone: "ok" }))]);
        })
        .catch((err) => { if (!cancelled && !err.cancelled) setScan((s) => ({ data: s.data, error: err })); })
        .finally(() => { inFlight = false; });
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
      if (controller) controller.abort();
    };
  }, [method, scanNonce]);

  // Details of the selected source (stored record, preview, text).
  useEffect(() => {
    if (!sourceId || sourceId.startsWith("src_points_")) return undefined;
    const controller = new AbortController();
    api.getSource(sourceId, controller.signal)
      .then((d) => setSelected({ key: sourceId, data: d, error: null }))
      .catch((err) => { if (!err.cancelled) setSelected({ key: sourceId, data: null, error: err }); });
    return () => controller.abort();
  }, [sourceId]);
  const sel = selected.key === sourceId ? selected : { data: null, error: null };

  const saveFolder = async () => {
    setSavingFolder(true);
    try {
      const d = await api.setWatchFolder(draft.trim());
      setWatch({ data: d, error: null });
      addLog(`Watch folder set to ${d.display}${d.demoFolder ? " (demo samples folder)" : ""}`);
      showToast("Watch folder saved", d.demoFolder ? "This is the bundled samples folder: files from it are demo sources." : d.display, "success");
      setScanNonce((n) => n + 1);
    } catch (err) {
      showToast("Watch folder rejected", err.message, "error");
      addLog(`Watch folder rejected: ${err.message}`, "bad");
    } finally {
      setSavingFolder(false);
    }
  };

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    setStaged(files);
    setUploads([]);
  };

  const upload = async () => {
    setUploading(true);
    try {
      const declaration = uploadProvenance !== "user_supplied_unverified" ? { provenance: uploadProvenance, operator } : null;
      const r = await api.uploadSources(staged.filter((f) => /\.txt$/i.test(f.name)), declaration);
      setUploads(r.sources);
      setStaged([]);
      r.sources.forEach((s) => addLog(`Uploaded ${s.source.displayName} → ${s.source.id}${s.created ? "" : " (identical bytes already stored)"}`, s.preview.ok ? "ok" : "bad"));
      if (r.sources.length === 1) selectSource(r.sources[0].source.id);
    } catch (err) {
      showToast("Upload failed", err.message, "error");
      addLog(`Upload failed: ${err.message}`, "bad");
    } finally {
      setUploading(false);
    }
  };

  const loadDemo = async (sample) => {
    setLoadingDemo(true);
    try {
      const r = await api.loadDemoSample(sample);
      selectSource(r.source.id);
      addLog(`Loaded demo sample ${r.source.displayName} (${r.source.id}) — inspection only`, "info");
      showToast("Demo sample loaded", "Demo sources are for inspection only; download and RobotStudio launch are blocked.", "info");
    } catch (err) {
      showToast("Demo sample not loaded", err.message, "error");
    } finally {
      setLoadingDemo(false);
    }
  };

  const declareProvenance = async () => {
    setDeclaring((d) => ({ ...d, busy: true, error: null }));
    try {
      await api.declareSourceProvenance(sourceId, declaring.value, operator, declaring.note);
      const d = await api.getSource(sourceId);
      setSelected({ key: sourceId, data: d, error: null });
      setDeclaring({ value: "", note: "", busy: false, error: null });
      addLog(`Provenance of ${d.source.displayName} declared as ${d.provenance.effective.value}`, "info");
    } catch (err) {
      setDeclaring((d) => ({ ...d, busy: false, error: err }));
    }
  };

  const processSource = async (parameters) => {
    if (!sourceId) return;
    setProcessing(true);
    setProcessError(null);
    try {
      const view = await api.createJob(projectId, sourceId, parameters);
      applyJobView(view);
      usabilityLog.record("job_created", { revision: view.record.revision, plannedType: view.record.geometry.plannedType });
      addLog(`Job ${view.record.jobId} revision ${view.record.revision} created`, "ok");
      showToast("Job created", `Revision ${view.record.revision}: ${view.record.path.targetCount} targets generated. Review the geometry next.`, "success");
      router.push("/parse-map");
    } catch (err) {
      setProcessError(err);
      addLog(`Processing failed: ${err.message}`, "bad");
    } finally {
      setProcessing(false);
    }
  };

  const rows = method === "watched-folder"
    ? (scan.data ? scan.data.files : []).map((f) => ({ key: `w-${f.name}`, name: f.name, size: f.sizeBytes, modified: f.modified, status: f.status, sourceId: f.sourceId, kind: f.sourceKind, preview: f.preview, message: f.message }))
    : [
      ...staged.map((f) => ({ key: `s-${f.name}-${f.size}`, name: f.name, size: f.size, modified: new Date(f.lastModified).toISOString(), status: /\.txt$/i.test(f.name) ? "Staged" : "Error", sourceId: null, message: /\.txt$/i.test(f.name) ? null : "Only .txt seam descriptors are accepted." })),
      ...uploads.map((u) => ({ key: `u-${u.source.id}`, name: u.source.displayName, size: u.source.sizeBytes, modified: u.source.importedAt, status: "Uploaded", sourceId: u.source.id, kind: u.source.sourceKind, preview: u.preview })),
    ];

  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  const selPreview = sel.data ? sel.data.preview : null;
  const selIsCurrentJob = job && job.record.source.id === sourceId;

  return (
    <div className="flex-1 flex w-full h-full relative bg-slate-950 min-h-0">
      <div className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[48%] min-w-[420px] h-full pt-5 px-5 gap-3 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Acquire a seam descriptor</h1>
          <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">Pick up exported files from the watched folder or upload them. Select exactly one stored source to process.</p>
        </div>
        <StepperProgress />

        <Card title="Input method" icon="input">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Input method">
            {[{ v: "watched-folder", l: "Watched folder", d: "Polled every 3 s while this page is open. No background watcher runs." }, { v: "manual", l: "Manual upload", d: ".txt only, up to 10 files of 256 KB each." }].map((m) => (
              <label key={m.v} className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer ${method === m.v ? "border-primary bg-primary/5" : "border-outline-variant"}`}>
                <input type="radio" name="method" value={m.v} checked={method === m.v} onChange={() => setMethod(m.v)} className="mt-0.5" />
                <span className="text-xs"><span className="font-bold text-on-surface block">{m.l}</span><span className="text-on-surface-variant">{m.d}</span></span>
              </label>
            ))}
          </div>
        </Card>

        <Card title={method === "watched-folder" ? "Watched folder" : "Upload files"} icon="folder_copy">
          {method === "watched-folder" ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="watch-folder" className="text-[10px] font-bold uppercase text-on-surface-variant">Folder (inside an approved root)</label>
              <div className="flex gap-2">
                <input id="watch-folder" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveFolder(); }} spellCheck={false} className="flex-1 min-w-0 bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono" />
                <button type="button" onClick={saveFolder} disabled={savingFolder || !draft.trim()} className="bg-primary text-on-primary disabled:opacity-50 px-3 py-2 rounded-md font-bold text-xs">{savingFolder ? "Saving" : "Save"}</button>
                <button type="button" onClick={() => setScanNonce((n) => n + 1)} className="bg-primary/10 text-primary px-3 py-2 rounded-md font-bold text-xs">Scan now</button>
              </div>
              {watch.error && <InlineError error={watch.error} />}
              {watch.data && (
                <div className="text-[11px] text-on-surface-variant flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 font-semibold">
                    <Icon name={watch.data.approved ? "check_circle" : "error"} className={`text-[15px] ${watch.data.approved ? "text-emerald-700" : "text-red-700"}`} />
                    {watch.data.approved ? `Watching ${watch.data.display}` : watch.data.problem}
                  </span>
                  {watch.data.demoFolder && <span className="font-bold text-amber-900">This is the bundled samples folder: files from it are DEMO sources and cannot be exported.</span>}
                  <span>Approved roots: {watch.data.approvedRoots.map((r) => `${r.display}${r.exists ? "" : " (missing)"}`).join(", ")}</span>
                </div>
              )}
              {scan.error && <InlineError error={scan.error} onRetry={() => setScanNonce((n) => n + 1)} />}
              {scan.data && !scan.data.ok && <p className="text-[11px] text-red-800 font-semibold" role="alert">{scan.data.problem}</p>}
              {scan.data && <p className="text-[10px] text-on-surface-variant">Last scan {new Date(scan.data.scannedAt).toLocaleTimeString()}{scan.data.truncated ? " · listing truncated at 500 entries" : ""}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="upload" className="text-[10px] font-bold uppercase text-on-surface-variant">Seam descriptor files (.txt)</label>
              <input id="upload" type="file" multiple accept=".txt,text/plain" onChange={onFiles} className="w-full text-xs file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-on-primary" />
              <label className="text-[10px] font-bold uppercase text-on-surface-variant flex flex-col gap-1">Where do these bytes come from?
                <select aria-label="Upload provenance" value={uploadProvenance} onChange={(e) => setUploadProvenance(e.target.value)} className="normal-case font-normal bg-surface-container-highest border border-outline-variant rounded-md px-2 py-1.5 text-xs">
                  <option value="user_supplied_unverified">Not verified (default)</option>
                  <option value="recorded_device_export">Recorded export from the vision software (my statement)</option>
                  <option value="synthetic_fixture">Synthetic test fixture</option>
                </select>
              </label>
              <p className="text-[10px] text-on-surface-variant -mt-1">A declaration is recorded with your operator name. Synthetic fixtures can be packaged for offline evidence but not exported to a controller.</p>
              <button type="button" onClick={upload} disabled={uploading || !staged.some((f) => /\.txt$/i.test(f.name))} className="self-start bg-primary text-on-primary disabled:opacity-50 px-4 py-2 rounded-md text-xs font-bold">{uploading ? "Uploading…" : "Upload selected files"}</button>
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-outline-variant/40 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-bold text-on-surface-variant">Demo (inspection only):</span>
            <button type="button" onClick={() => loadDemo("straight")} className="px-2 py-1 border border-amber-400 bg-amber-50 text-amber-900 rounded font-bold">Load straight sample</button>
            <button type="button" onClick={() => loadDemo("arc")} className="px-2 py-1 border border-amber-400 bg-amber-50 text-amber-900 rounded font-bold">Load arc sample</button>
          </div>
        </Card>

        <Card title={`Files (${rows.length})`} icon="queue">
          <div className="overflow-x-auto max-h-[240px]">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-on-surface-variant border-b border-outline-variant/40">
                  <th scope="col" className="py-1 pr-1"><span className="sr-only">Select</span></th>
                  <th scope="col" className="py-1 pr-2">File</th>
                  <th scope="col" className="py-1 pr-2">Size</th>
                  <th scope="col" className="py-1 pr-2">Status</th>
                  <th scope="col" className="py-1">Validation</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-center text-on-surface-variant italic">{method === "watched-folder" ? "No .txt files in the folder yet." : "No files selected."}</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.key} className={`border-t border-outline-variant/30 align-top ${r.sourceId && r.sourceId === sourceId ? "bg-primary/5" : ""}`}>
                    <td className="py-1.5 pr-1">
                      {r.sourceId && (
                        <input type="radio" name="source" aria-label={`Select ${r.name}`} checked={r.sourceId === sourceId} onChange={() => { selectSource(r.sourceId); usabilityLog.record("source_selected"); }} />
                      )}
                    </td>
                    <td className="py-1.5 pr-2 font-mono font-bold text-on-surface break-all">
                      {r.name}
                      {r.kind === "demo" && <span className="ml-1"><SourceKindBadge kind="demo" /></span>}
                      {r.message && <span className="block font-sans font-normal text-[10px] text-on-surface-variant">{r.message}</span>}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{formatBytes(r.size)}</td>
                    <td className="py-1.5 pr-2"><StatusChip status={r.status} /></td>
                    <td className="py-1.5"><PreviewChip preview={r.preview} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Selected source" icon="task">
          {!sourceId && <p className="text-xs text-on-surface-variant italic">Select a stored source in the table or load a demo sample. New files never replace your selection automatically.</p>}
          {sel.error && <InlineError error={sel.error} />}
          {sel.data && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold break-all">{sel.data.source.displayName}</span>
                <SourceKindBadge kind={sel.data.source.sourceKind} />
                <span className="font-mono text-[10px] text-on-surface-variant" title={sel.data.source.sha256}>SHA-256 {shortHash(sel.data.source.sha256)}</span>
              </div>
              {sel.data.provenance && (
                <div className="text-[11px] flex flex-col gap-1 border border-outline-variant/50 rounded p-2">
                  <span>
                    <span className="font-bold">Provenance:</span> {PROVENANCE_LABEL[sel.data.provenance.effective.value] || sel.data.provenance.effective.value}
                    {sel.data.provenance.effective.declared ? ` — declared by ${sel.data.provenance.effective.declaredBy}` : " (default; nothing declared)"}
                    <span className="text-on-surface-variant"> · arrived by {sel.data.provenance.transport.replace(/_/g, " ")}</span>
                  </span>
                  <span className="text-[10px] text-on-surface-variant">How a file arrived is not where it came from: copying a file into the watched folder does not make it a device capture.</span>
                  <div className="flex flex-wrap gap-1 items-center">
                    <select aria-label="Declare source provenance" value={declaring.value} onChange={(e) => setDeclaring((d) => ({ ...d, value: e.target.value }))} className="bg-surface-container-highest border border-outline-variant rounded px-1.5 py-1 text-[11px]">
                      <option value="">Declare provenance…</option>
                      <option value="recorded_device_export">Recorded device export (my statement)</option>
                      <option value="user_supplied_unverified">User-supplied, not verified</option>
                      <option value="synthetic_fixture">Synthetic test fixture</option>
                    </select>
                    <input aria-label="Provenance note" maxLength={500} placeholder="Note (optional)" value={declaring.note} onChange={(e) => setDeclaring((d) => ({ ...d, note: e.target.value }))} className="flex-1 min-w-[120px] bg-surface-container-highest border border-outline-variant rounded px-1.5 py-1 text-[11px]" />
                    <button type="button" onClick={declareProvenance} disabled={!declaring.value || declaring.busy} className="bg-primary text-on-primary disabled:opacity-50 rounded px-2 py-1 font-bold">Record declaration</button>
                  </div>
                  <InlineError error={declaring.error} />
                </div>
              )}
              <DiagnosticsList diagnostics={selPreview && selPreview.diagnostics} emptyText="The descriptor parses without diagnostics. Geometry checks run when it is processed." />
              {selIsCurrentJob && <p className="text-[11px] text-on-surface-variant">A job for this source is already open (revision {job.record.revision}). Processing again creates a separate job.</p>}
              <InlineError error={processError} />
              {processError && processError.diagnostics.some((d) => d.code === "ARC_NEAR_STRAIGHT") && (
                <div className="border border-amber-400 bg-amber-50 text-amber-900 rounded-lg p-3 text-[11px] flex flex-col gap-2">
                  <p>The requested arc is nearly straight. You may deliberately process it as a straight seam instead. That choice is stored with the revision, the via point is ignored, and the conversion must be acknowledged before export.</p>
                  <button type="button" onClick={() => processSource({ nearStraightArcPolicy: "convert_to_line" })} disabled={processing} className="self-start bg-amber-700 text-white rounded px-3 py-1.5 font-bold">
                    Process with explicit arc-to-line conversion
                  </button>
                </div>
              )}
              <button type="button" onClick={() => processSource()} disabled={processing || uploading || loadingDemo || !selPreview || !selPreview.ok} className="w-full bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                <Icon name={processing ? "progress_activity" : "play_arrow"} className={processing ? "animate-spin" : ""} />
                {processing ? "Processing…" : selPreview && !selPreview.ok ? "Fix the input errors before processing" : "Process selected source"}
              </button>
            </div>
          )}
        </Card>
        <div className="pb-4" />
      </div>

      <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative min-w-0">
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{method === "watched-folder" ? "Watched folder" : "Manual upload"}</p>
            <p className="text-sm font-mono font-bold text-slate-100 break-all">{method === "watched-folder" ? (watch.data ? watch.data.display : "—") : "Local file selection"}</p>
            <p className="text-[10px] text-slate-400 mt-1">{method === "watched-folder" ? (watch.data && watch.data.approved ? "Approved" : "Not approved / unknown") : "Not polled"}</p>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">File statuses (measured)</p>
            <p className="text-xs font-mono text-slate-100 mt-1">{Object.keys(counts).length ? Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ") : "none"}</p>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Selected source</p>
            <p className="text-sm font-mono font-bold text-slate-100 break-all">{sel.data ? sel.data.source.displayName : "none"}</p>
            <p className="text-[10px] text-slate-400 mt-1">{selPreview ? (selPreview.ok ? `Parses as ${selPreview.seamType}` : "Has input errors") : "—"}</p>
          </div>
        </div>

        <ol className="flex items-center justify-center gap-3 px-8 py-6 text-slate-300 text-[10px] font-black uppercase tracking-tight" aria-label="Pipeline state">
          {[
            { label: "Source stored", on: !!sel.data, icon: "folder_open" },
            { label: "Input valid", on: !!(selPreview && selPreview.ok), icon: "rule" },
            { label: "Job revision", on: !!selIsCurrentJob, icon: "inventory_2" },
          ].map((n, i) => (
            <li key={n.label} className="flex items-center gap-3">
              {i > 0 && <span className={`h-[2px] w-16 ${n.on ? "bg-emerald-500" : "bg-slate-700"}`} aria-hidden="true"></span>}
              <span className="flex flex-col items-center gap-2">
                <span className={`w-14 h-14 rounded-2xl flex items-center justify-center border-2 ${n.on ? "bg-emerald-600 border-emerald-400" : "bg-slate-900 border-slate-700"}`}>
                  <Icon name={n.icon} className="text-2xl text-white" />
                </span>
                <span>{n.label}: {n.on ? "yes" : "no"}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mx-5 mb-5 flex-1 min-h-[200px] bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 flex gap-4" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")} className={`text-[10px] font-bold uppercase tracking-widest ${tab === "log" ? "text-sky-400" : "text-slate-500"}`}>Event log</button>
            <button type="button" role="tab" aria-selected={tab === "record"} onClick={() => setTab("record")} className={`text-[10px] font-bold uppercase tracking-widest ${tab === "record" ? "text-sky-400" : "text-slate-500"}`}>Stored source record</button>
            <button type="button" onClick={() => setLog([])} className="ml-auto text-[10px] text-slate-500 hover:text-slate-300">Clear log</button>
          </div>
          <div className="flex-1 p-3 overflow-auto font-mono text-[11px] leading-relaxed" role="tabpanel">
            {tab === "log" ? (
              log.length === 0 ? <p className="text-slate-500 italic">No events yet in this page session.</p> : log.map((e, i) => (
                <p key={i} className={e.tone === "bad" ? "text-red-400" : e.tone === "ok" ? "text-emerald-400" : "text-sky-300"}>[{e.at}] {e.text}</p>
              ))
            ) : sel.data ? (
              <pre className="text-slate-300 whitespace-pre-wrap break-all">{JSON.stringify(sel.data.source, null, 2)}{"\n\n--- content ---\n"}{sel.data.text}</pre>
            ) : <p className="text-slate-500 italic">No source selected.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
