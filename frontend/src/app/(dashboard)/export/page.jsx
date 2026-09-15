"use client";

import React, { useEffect, useState } from "react";
import StepperProgress from "@/components/StepperProgress";
import WeldSimulation3D from "@/components/WeldSimulation3D";
import PlaybackControls from "@/components/PlaybackControls";
import TargetTable from "@/components/TargetTable";
import { SyntheticBanner } from "@/components/OrientationPanel";
import ClearancePanel from "@/components/ClearancePanel";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { useToast } from "@/components/ToastContext";
import { api } from "@/services/apiClient";
import { createPlaybackClock } from "@/lib/playback";
import { usabilityLog } from "@/lib/usabilityLog";
import { shortHash } from "@/lib/statusLabels";
import { Card, Icon, InlineError, JobIdentityCard, ValidationPanel } from "@/components/StatusPanels";

const LAUNCH_TEXT = {
  process_started: "RobotStudio process started. This does not confirm that a station opened or that the module was imported, compiled or run.",
  not_found: "RobotStudio.exe was not found under Program Files\\ABB. The module file is still saved; open RobotStudio yourself or set VD_ROBOTSTUDIO_EXE for the backend.",
  unsupported_os: "Launching RobotStudio is only supported when the backend runs on Windows. The module file is still saved.",
  override_invalid: "VD_ROBOTSTUDIO_EXE is set but does not point to RobotStudio.exe. The module file is still saved.",
  spawn_error: "The operating system refused to start RobotStudio. The module file is still saved.",
  spawn_timeout: "No process start was observed in time. Check whether RobotStudio opened; the module file is still saved.",
  not_attempted: "RobotStudio was not started because saving the module file failed.",
};

const CHECKLIST = [
  "Open the RobotStudio station and virtual controller that match the target robot (not an arbitrary station).",
  "Confirm the tool and work object named in the module header exist there with the expected definitions.",
  "Import the module (RAPID → Load Module) and run a syntax check; record any errors.",
  "Synchronise and simulate; check configuration, reachability, singularities and collisions against the real cell model.",
  "Record the RobotStudio and RobotWare versions, the output and configuration SHA-256 and the result below as evidence.",
  "Physical dry runs and welding require separate authorisation and commissioning; this checklist is not a safety certification.",
];

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ExportPage() {
  const { job, operator, applyJobView } = useWorkflowSession();
  const { showToast } = useToast();
  const [clock] = useState(() => createPlaybackClock());
  const [rs, setRs] = useState({ data: null, error: null });
  const [download, setDownload] = useState(null);
  const [copy, setCopy] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [exportState, setExportState] = useState({ busy: null, outcome: null, error: null });
  const [evidence, setEvidence] = useState({ result: "not_run", robotStudioVersion: "", robotWareVersion: "", robotVariant: "", notes: "" });
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.robotStudioStatus().then((d) => { if (!cancelled) setRs({ data: d, error: null }); }).catch((err) => { if (!cancelled) setRs({ data: null, error: err }); });
    return () => { cancelled = true; };
  }, []);

  if (!job) return null;
  const { record, review, gates } = job;
  const allowed = gates.export.allowed;
  const packageAllowed = gates.package ? gates.package.allowed : false;
  const configurationSha256 = gates.identity ? gates.identity.configurationSha256 : null;
  const syntheticOnly = !allowed && packageAllowed && gates.export.reasons.every((r) => r.code === "SYNTHETIC_SOURCE" || r.code === "SYNTHETIC_CONFIGURATION");

  const doDownload = async () => {
    setDownload({ status: "working" });
    try {
      const m = await api.fetchModule(record.jobId, record.revision, record.output.sha256);
      if (m.sha256 !== record.output.sha256) throw new Error("The downloaded bytes do not carry the expected output hash.");
      const fileName = m.fileName || "Module1.mod";
      saveBlob(new Blob([m.text], { type: "text/plain;charset=utf-8" }), fileName);
      usabilityLog.record("module_downloaded", { revision: record.revision });
      setDownload({ status: "started", message: `Browser download started: ${fileName}` });
    } catch (err) {
      setDownload({ status: "failed", message: err.message, error: err });
    }
  };

  const doCopy = async () => {
    try {
      const m = await api.fetchModule(record.jobId, record.revision, record.output.sha256);
      if (!navigator.clipboard) throw Object.assign(new Error("Clipboard API unavailable"), { clipboard: true });
      await navigator.clipboard.writeText(m.text);
      setCopy({ status: "copied", message: "Module text copied to the clipboard." });
    } catch (err) {
      const denied = err.clipboard || err.name === "NotAllowedError" || !err.status;
      if (denied && !err.network) {
        usabilityLog.record("copy_failed_download_offered");
        setCopy({ status: "failed", denied: true, message: "The browser did not allow clipboard access. The download below saves the same bytes." });
      } else {
        setCopy({ status: "failed", message: err.message });
      }
    }
  };

  const doExport = async (action) => {
    setExportState({ busy: action, outcome: null, error: null });
    try {
      const r = await api.exportModule(record.jobId, record.revision, { outputSha256: record.output.sha256, action, operator });
      applyJobView(r);
      setExportState({ busy: null, outcome: r.outcome, error: null });
      const saved = r.outcome.saved;
      if (saved && (saved.status === "saved" || saved.status === "already_saved")) showToast("Module saved", `${saved.fileName} in the export folder.`, "success");
      else showToast("Save failed", saved ? saved.message : "Unknown error", "error");
    } catch (err) {
      setExportState({ busy: null, outcome: null, error: err });
    }
  };

  const doPackage = async () => {
    setPkg({ status: "working" });
    try {
      const p = await api.fetchEvidencePackage(record.jobId, record.revision, { outputSha256: record.output.sha256, configurationSha256, operator });
      const digest = await sha256Hex(p.bytes);
      if (digest && p.sha256 && digest !== p.sha256) throw new Error("The package bytes do not match the hash reported by the backend.");
      saveBlob(new Blob([p.bytes], { type: "application/zip" }), p.fileName);
      usabilityLog.record("evidence_package_downloaded", { revision: record.revision });
      setPkg({ status: "started", fileName: p.fileName, sha256: digest || p.sha256, checked: !!digest });
      applyJobView(await api.getRevision(record.jobId, record.revision));
    } catch (err) {
      setPkg({ status: "failed", message: err.message, error: err });
    }
  };

  const submitEvidence = async (e) => {
    e.preventDefault();
    setEvidenceBusy(true);
    setEvidenceError(null);
    try {
      const view = await api.recordEvidence(record.jobId, record.revision, { ...evidence, operator, outputSha256: record.output.sha256, configurationSha256 });
      applyJobView(view);
      showToast("Evidence recorded", "Stored as operator-reported evidence for this output and configuration hash.", "success");
    } catch (err) {
      setEvidenceError(err);
    } finally {
      setEvidenceBusy(false);
    }
  };

  const outcome = exportState.outcome;

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative min-h-0">
      <aside className="bg-surface-container-low border-r border-outline-variant flex flex-col w-[46%] min-w-[420px] h-full pt-5 px-5 gap-3 shrink-0 overflow-y-auto">
        <div>
          <h1 className="text-xl font-extrabold text-on-surface tracking-tight">Download / Open RobotStudio</h1>
          <p className="text-xs text-on-surface-variant mt-1">Obtain the reviewed candidate module for manual validation in RobotStudio. Nothing here transfers code to a controller or starts robot motion.</p>
        </div>
        <StepperProgress />
        <JobIdentityCard record={record} gates={gates} />
        <SyntheticBanner record={record} />

        {!allowed && (
          <div className="border border-amber-400 bg-amber-50 text-amber-900 rounded-xl p-3 text-xs" role="alert">
            <p className="font-bold flex items-center gap-1"><Icon name="lock" className="text-[16px]" />Export is blocked for this revision</p>
            <ul className="list-disc pl-5 mt-1">{gates.export.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>
            {syntheticOnly && <p className="mt-1 font-semibold">The offline evidence package below is still available for this synthetic revision.</p>}
          </div>
        )}

        <Card title="Get the module (independent actions)" icon="download">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button type="button" onClick={doDownload} disabled={!allowed || (download && download.status === "working")} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-1.5">
              <Icon name="download" className="text-[16px]" />Download .mod
            </button>
            <button type="button" onClick={doCopy} disabled={!allowed} className="bg-surface border border-outline-variant disabled:opacity-40 rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-1.5">
              <Icon name="content_copy" className="text-[16px]" />Copy text
            </button>
            <button type="button" onClick={() => doExport("save")} disabled={!allowed || !!exportState.busy} className="bg-surface border border-outline-variant disabled:opacity-40 rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-1.5">
              <Icon name="save" className="text-[16px]" />{exportState.busy === "save" ? "Saving…" : "Save to export folder"}
            </button>
            <button type="button" onClick={() => doExport("save_and_launch")} disabled={!allowed || !!exportState.busy} className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-1.5">
              <Icon name="open_in_new" className="text-[16px]" />{exportState.busy === "save_and_launch" ? "Working…" : "Save and open RobotStudio"}
            </button>
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-[11px]" aria-live="polite">
            {download && download.status !== "working" && <li className={download.status === "started" ? "text-emerald-800" : "text-red-800"}>Download: {download.message}</li>}
            {copy && (
              <li className={copy.status === "copied" ? "text-emerald-800" : "text-red-800"}>
                Copy: {copy.message}
                {copy.denied && (
                  <button type="button" onClick={doDownload} className="ml-2 underline font-bold text-blue-800">Download the .mod instead</button>
                )}
              </li>
            )}
            {outcome && outcome.saved && (
              <li className={outcome.saved.status === "failed" ? "text-red-800" : "text-emerald-800"}>
                Save: {outcome.saved.status === "saved" ? `written as ${outcome.saved.fileName}` : outcome.saved.status === "already_saved" ? `${outcome.saved.fileName} already exists with identical bytes` : `${outcome.saved.message} (${outcome.saved.code})`}
              </li>
            )}
            {outcome && outcome.launch && <li className={outcome.launch.status === "process_started" ? "text-sky-900" : "text-amber-900"}>RobotStudio: {LAUNCH_TEXT[outcome.launch.status] || outcome.launch.message}</li>}
          </ul>
          <InlineError error={exportState.error || (download && download.error)} />
          <p className="text-[10px] text-on-surface-variant mt-2">
            RobotStudio discovery: {rs.data ? `${rs.data.status}${rs.data.exeName ? ` (${rs.data.exeName} via ${rs.data.discovery})` : ""}` : rs.error ? "backend unavailable" : "checking…"}. Discovery only checks that a file exists.
            Passing the module path on the command line has not been verified to import it; follow the checklist.
          </p>
        </Card>

        <Card title="Offline evidence package" icon="inventory_2">
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            A ZIP with the source bytes, configuration, stored targets, orientation check, diagnostics, the exact module and a
            manifest of SHA-256 hashes, plus a RobotStudio validation sheet marked NOT RUN. Verify it independently with
            <span className="font-mono"> node scripts/verify-evidence-package.mjs</span>. It is not a validation result.
          </p>
          <button type="button" onClick={doPackage} disabled={!packageAllowed || (pkg && pkg.status === "working")} className="mt-2 w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white rounded-lg py-2.5 text-xs font-bold uppercase flex items-center justify-center gap-1.5">
            <Icon name="folder_zip" className="text-[16px]" />{pkg && pkg.status === "working" ? "Building package…" : "Download offline evidence package"}
          </button>
          {!packageAllowed && gates.package && <ul className="list-disc pl-5 mt-2 text-[11px] text-amber-900">{gates.package.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>}
          {pkg && pkg.status === "started" && (
            <p className="mt-2 text-[11px] text-emerald-800" aria-live="polite">
              Package download started: <span className="font-mono">{pkg.fileName}</span> · SHA-256 <span className="font-mono" title={pkg.sha256}>{shortHash(pkg.sha256)}</span>
              {pkg.checked ? " (bytes hashed in this browser and matched)" : " (browser hashing unavailable; hash as reported by the backend)"}
            </p>
          )}
          <InlineError error={pkg && pkg.error} />
        </Card>

        <Card title="Manual RobotStudio validation checklist" icon="checklist">
          <ol className="list-decimal pl-5 text-[11px] flex flex-col gap-1">{CHECKLIST.map((c) => <li key={c}>{c}</li>)}</ol>
        </Card>

        <ValidationPanel gates={gates} />
        <ClearancePanel record={record} />

        <Card title="Record RobotStudio evidence (operator-reported)" icon="assignment_turned_in">
          <form onSubmit={submitEvidence} className="grid grid-cols-2 gap-2 text-[11px]">
            <label className="flex flex-col gap-1 font-bold">Result
              <select value={evidence.result} onChange={(e) => setEvidence({ ...evidence, result: e.target.value })} className="font-normal border border-outline-variant rounded px-2 py-1 bg-surface-container-highest">
                <option value="not_run">Not run</option><option value="pass">Pass</option><option value="fail">Fail</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 font-bold">Robot variant
              <input value={evidence.robotVariant} maxLength={80} onChange={(e) => setEvidence({ ...evidence, robotVariant: e.target.value })} className="font-normal border border-outline-variant rounded px-2 py-1 bg-surface-container-highest" />
            </label>
            <label className="flex flex-col gap-1 font-bold">RobotStudio version
              <input value={evidence.robotStudioVersion} maxLength={80} onChange={(e) => setEvidence({ ...evidence, robotStudioVersion: e.target.value })} className="font-normal border border-outline-variant rounded px-2 py-1 bg-surface-container-highest" />
            </label>
            <label className="flex flex-col gap-1 font-bold">RobotWare version
              <input value={evidence.robotWareVersion} maxLength={80} onChange={(e) => setEvidence({ ...evidence, robotWareVersion: e.target.value })} className="font-normal border border-outline-variant rounded px-2 py-1 bg-surface-container-highest" />
            </label>
            <label className="col-span-2 flex flex-col gap-1 font-bold">Notes (syntax result, faults, tool/wobj used)
              <textarea rows={3} maxLength={2000} value={evidence.notes} onChange={(e) => setEvidence({ ...evidence, notes: e.target.value })} className="font-normal border border-outline-variant rounded px-2 py-1 bg-surface-container-highest" />
            </label>
            <div className="col-span-2"><InlineError error={evidenceError} /></div>
            <button type="submit" disabled={evidenceBusy || !configurationSha256} className="col-span-2 bg-primary text-on-primary rounded-lg py-2 font-bold uppercase disabled:opacity-50">
              Record for output {record.output.sha256.slice(0, 12)}… · configuration {configurationSha256 ? `${configurationSha256.slice(0, 12)}…` : "—"}
            </button>
          </form>
          {review.externalEvidence.length > 0 && (
            <ul className="mt-2 text-[10px] flex flex-col gap-1">
              {review.externalEvidence.map((ev, i) => <li key={i} className="border-t border-outline-variant/30 pt-1">{new Date(ev.reportedAt).toLocaleString()} · {ev.reportedBy} · {ev.result} · RS {ev.robotStudioVersion || "?"} · config {ev.configurationSha256 ? shortHash(ev.configurationSha256) : "not bound"} · {ev.notes}</li>)}
            </ul>
          )}
        </Card>

        {review.exports.length > 0 && (
          <Card title="Export log for this revision" icon="history">
            <ul className="text-[10px] flex flex-col gap-1">
              {review.exports.map((x, i) => <li key={i}>{new Date(x.at).toLocaleString()} · {x.by} · {x.action}{x.saved ? ` · save ${x.saved}` : ""}{x.launch ? ` · launch ${x.launch}` : ""}{x.packageSha256 ? ` · package ${shortHash(x.packageSha256)}` : ""}</li>)}
            </ul>
          </Card>
        )}
        <div className="pb-4" />
      </aside>

      <div className="flex-1 h-full relative bg-slate-950 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 relative min-h-0">
          <WeldSimulation3D record={record} clock={clock} fallback={<TargetTable record={record} />} />
        </div>
        <div className="p-3 flex flex-col gap-2">
          <PlaybackControls clock={clock} record={record} />
          <div className="bg-surface rounded-xl p-3 max-h-[220px] overflow-auto"><TargetTable record={record} compact caption="Same revision as the module (robot base frame, mm)" /></div>
        </div>
      </div>
    </div>
  );
}
