"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { acquireTrajectory, acquireFromFile } from "@/services/tracerStudioTcpBridge";

export default function AcquirePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    bridgeConfig,
    acquisitionMethod,
    setAcquisition,
    acquisitionQueue,
    setAcquisitionQueue,
    setRawPayloadData,
    updateProgress,
  } = useTcpWorkflow();

  const [requestType, setRequestType] = useState("011 Single Trajectory");
  const [templateNumber, setTemplateNumber] = useState("03");
  const [poseSource, setPoseSource] = useState("Active Controller Pose");
  const [pullMode, setPullMode] = useState("On Demand");
  const [retryAttempts, setRetryAttempts] = useState("3");
  const [watchFolder, setWatchFolder] = useState("C:\\TracerBridge\\Inbound\\");
  const [autoDetect, setAutoDetect] = useState(true);
  const [importOnStable, setImportOnStable] = useState(true);
  const [acquiring, setAcquiring] = useState(false);
  const [acquisitionComplete, setAcquisitionComplete] = useState(false);

  const handleAcquisition = async () => {
    setAcquiring(true);
    setAcquisitionQueue((prev) => [
      ...prev,
      {
        id: `item_${Date.now()}`,
        item: `acquisition_${Date.now()}`,
        source: acquisitionMethod === "live-tcp" ? "Live TCP Stream" : acquisitionMethod === "watched-folder" ? "Watched Folder" : "Manual Import",
        status: "Processing",
        lastUpdate: new Date().toLocaleTimeString(),
      },
    ]);

    try {
      let result;
      if (acquisitionMethod === "live-tcp") {
        const [type] = requestType.split(" ");
        result = await acquireTrajectory(bridgeConfig, { requestType: type, templateNumber });
      } else {
        result = await acquireFromFile(watchFolder + "output_" + Date.now() + ".json");
      }

      if (result.success) {
        setRawPayloadData(result.payload);
        updateProgress({ acquisitionComplete: true });
        setAcquisitionComplete(true);

        // Update queue
        setAcquisitionQueue((prev) =>
          prev.map((item, i) =>
            i === prev.length - 1 ? { ...item, status: "Completed", lastUpdate: new Date().toLocaleTimeString() } : item
          )
        );

        showToast(
          "✓ Acquisition Complete",
          `Response ${result.responseCode}: ${result.payload.totalPoints} points received.`,
          "success"
        );
      }
    } catch {
      setAcquisitionQueue((prev) =>
        prev.map((item, i) =>
          i === prev.length - 1 ? { ...item, status: "Failed", lastUpdate: new Date().toLocaleTimeString() } : item
        )
      );
      showToast("❌ Acquisition Error", "Failed to acquire trajectory data.", "error");
    } finally {
      setAcquiring(false);
    }
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      showToast(
        "✓ File Selected",
        `Importing ${file.name} for prototype testing.`,
        "info"
      );
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            Acquisition Method & Input Source
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Choose whether weld data is acquired from a live TCP stream or from TracerStudio output files.
          </p>
        </div>

        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* Card 1: Input Method Selection */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">input</span>
              Input Method Selection
            </h3>
            <div className="flex flex-col gap-3">
              {[
                { value: "live-tcp", label: "Live TCP Stream", desc: "Pull trajectory data through a TCP bridge request." },
                { value: "watched-folder", label: "Watched Folder", desc: "Monitor the configured bridge folder for new TracerStudio output files." },
                { value: "manual", label: "Manual Import", desc: "Select a local file for prototype testing." },
              ].map((method) => (
                <label
                  key={method.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    acquisitionMethod === method.value
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant hover:border-outline"
                  }`}
                >
                  <input
                    type="radio"
                    name="acquisition-method"
                    value={method.value}
                    checked={acquisitionMethod === method.value}
                    onChange={() => setAcquisition(method.value)}
                    className="w-4 h-4 mt-0.5 border-outline-variant text-primary focus:ring-primary bg-surface cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-on-surface">{method.label}</span>
                    <p className="text-[11px] text-on-surface-variant mt-0.5">{method.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Card 2: Stream Request Configuration */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
              Stream Request Configuration
            </h3>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="acq-request" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Request Type
                </label>
                <select
                  id="acq-request"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>011 Single Trajectory</option>
                  <option>012 Fused Trajectory</option>
                  <option>021 Program Editor Trajectory</option>
                </select>
              </div>
              <div>
                <label htmlFor="acq-template" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Template Number
                </label>
                <input
                  id="acq-template"
                  type="text"
                  value={templateNumber}
                  onChange={(e) => setTemplateNumber(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-mono font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div>
                <label htmlFor="acq-pose" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Robot Pose Source
                </label>
                <select
                  id="acq-pose"
                  value={poseSource}
                  onChange={(e) => setPoseSource(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>Active Controller Pose</option>
                  <option>Saved Scan Pose</option>
                  <option>Manual Pose</option>
                </select>
              </div>
              <div>
                <label htmlFor="acq-pull" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Pull Mode
                </label>
                <select
                  id="acq-pull"
                  value={pullMode}
                  onChange={(e) => setPullMode(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>On Demand</option>
                  <option>Session Trigger</option>
                  <option>Mock Polling</option>
                </select>
              </div>
              <div>
                <label htmlFor="acq-retry" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Retry Attempts
                </label>
                <input
                  id="acq-retry"
                  type="number"
                  value={retryAttempts}
                  onChange={(e) => setRetryAttempts(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-mono font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
            </div>
          </div>

          {/* Card 3: File Watch Fallback */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">folder_copy</span>
              File Watch Fallback
            </h3>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="acq-folder" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Watch Folder
                </label>
                <input
                  id="acq-folder"
                  type="text"
                  value={watchFolder}
                  onChange={(e) => setWatchFolder(e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-mono font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="acq-autodetect"
                  type="checkbox"
                  checked={autoDetect}
                  onChange={(e) => setAutoDetect(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary bg-surface cursor-pointer"
                />
                <label htmlFor="acq-autodetect" className="text-xs font-bold text-on-surface-variant">
                  Auto-detect new packets
                </label>
              </div>
              <div>
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Supported Types</span>
                <div className="flex gap-2 mt-1">
                  {[".json", ".bin", ".pcd", ".ply"].map((ext) => (
                    <span key={ext} className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                      {ext}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-on-surface-variant mt-1">
                  Placeholder extensions — confirm actual TracerStudio output format when installed.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="acq-stable"
                  type="checkbox"
                  checked={importOnStable}
                  onChange={(e) => setImportOnStable(e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary bg-surface cursor-pointer"
                />
                <label htmlFor="acq-stable" className="text-xs font-bold text-on-surface-variant">
                  Import on stable write
                </label>
              </div>
              {acquisitionMethod === "manual" && (
                <div>
                  <label htmlFor="acq-file" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                    Select File
                  </label>
                  <input
                    id="acq-file"
                    type="file"
                    onChange={handleFileImport}
                    className="w-full text-xs text-on-surface-variant file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:text-xs file:font-bold file:bg-primary file:text-on-primary file:border-transparent cursor-pointer"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Card 4: Acquisition Queue */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">queue</span>
              Acquisition Queue
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-on-surface-variant font-bold uppercase tracking-wider text-[10px]">
                    <th className="text-left pb-2">Item</th>
                    <th className="text-left pb-2">Source</th>
                    <th className="text-left pb-2">Status</th>
                    <th className="text-left pb-2">Last Update</th>
                    <th className="text-left pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-outline-variant/30">
                    <td className="py-2 font-mono font-bold text-on-surface">tcp_request_011</td>
                    <td className="py-2 text-on-surface-variant">Live TCP Stream</td>
                    <td className="py-2"><span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 text-[10px] font-bold">Ready</span></td>
                    <td className="py-2 text-on-surface-variant font-mono">—</td>
                    <td className="py-2 text-primary cursor-pointer font-bold">Queue</td>
                  </tr>
                  <tr className="border-t border-outline-variant/30">
                    <td className="py-2 font-mono font-bold text-on-surface">scan_packet_2026_07_13.bin</td>
                    <td className="py-2 text-on-surface-variant">Watched Folder</td>
                    <td className="py-2"><span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">Waiting</span></td>
                    <td className="py-2 text-on-surface-variant font-mono">—</td>
                    <td className="py-2 text-primary cursor-pointer font-bold">Queue</td>
                  </tr>
                  <tr className="border-t border-outline-variant/30">
                    <td className="py-2 font-mono font-bold text-on-surface">manual_import_weld03.json</td>
                    <td className="py-2 text-on-surface-variant">Manual Import</td>
                    <td className="py-2"><span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-[10px] font-bold">Completed</span></td>
                    <td className="py-2 text-on-surface-variant font-mono">14:22:10</td>
                    <td className="py-2 text-primary cursor-pointer font-bold">View</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Start Acquisition Button */}
          <button
            onClick={handleAcquisition}
            disabled={acquiring || acquisitionComplete}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            {acquiring ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Acquiring...
              </>
            ) : acquisitionComplete ? (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Acquisition Complete
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Start Acquisition
              </>
            )}
          </button>

          {/* Bottom Navigation */}
          <div className="flex gap-4 select-none">
            <Link
              href="/connect"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Connect
            </Link>
            <Link
              href="/parse-map"
              className={`flex-1 bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm ${!acquisitionComplete ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Viewport */}
      <Active3DViewport
        title="Acquisition Monitor"
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[650px] px-8">
            {/* Two Input Paths */}
            <div className="flex items-start justify-between mb-6">
              {/* Route 1: Live TCP */}
              <div className="flex-1 flex flex-col items-center">
                <div className="w-full h-20 border-2 border-teal-400/60 rounded-xl bg-teal-900/20 flex flex-col items-center justify-center gap-1 backdrop-blur-sm">
                  <span className="text-[10px] font-bold text-teal-300 font-mono">Live TCP Packet</span>
                  <span className="text-[10px] font-mono text-teal-400/70">TCP 011</span>
                  <span className="text-[10px] font-bold text-teal-300">142 pts</span>
                </div>
              </div>

              {/* Route 2: File */}
              <div className="flex-1 flex flex-col items-center">
                <div className="w-full h-20 border-2 border-orange-400/60 rounded-xl bg-orange-900/20 flex flex-col items-center justify-center gap-1 backdrop-blur-sm">
                  <span className="text-[10px] font-bold text-orange-300 font-mono">Detected Output File</span>
                  <span className="text-[10px] font-mono text-orange-400/70">scan_packet_2026_07_13.bin</span>
                  <span className="text-[10px] font-bold text-orange-300">98 pts</span>
                </div>
              </div>
            </div>

            {/* Converging Arrows */}
            <div className="flex justify-center mb-4">
              <div className="flex flex-col items-center">
                <div className="flex gap-16">
                  <div className="w-px h-6 bg-teal-400/40"></div>
                  <div className="w-px h-6 bg-orange-400/40"></div>
                </div>
                <div className="w-px h-4 bg-green-400/40"></div>
              </div>
            </div>

            {/* Unified Input Buffer */}
            <div className="w-full max-w-[400px] mx-auto mb-4">
              <div className="border-2 border-green-400/60 rounded-xl bg-green-900/20 flex flex-col items-center justify-center gap-1 py-4 backdrop-blur-sm">
                <span className="text-[10px] font-bold text-green-300 uppercase tracking-wider">Unified Input Buffer</span>
                <span className="text-lg font-mono font-bold text-green-400">240 pts</span>
              </div>
            </div>

            {/* Floating Status Chip */}
            <div className="mx-auto bg-surface/90 border border-outline-variant/30 rounded-lg px-4 py-2 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 glowing-badge"></div>
              <span className="text-[10px] font-mono font-bold text-on-surface">
                Latest source: TCP 011 | 142 points received
              </span>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
