"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { acquireTrajectory, acquireFromFile } from "@/services/tracerStudioTcpBridge";
import axiosClient from "@/services/axiosClient";

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
    setCanonicalPath,
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
  const [selectedFiles, setSelectedFiles] = useState([]);

  // Auto-load staging files when entering Watched Folder mode
  useEffect(() => {
    if (acquisitionMethod === "watched-folder" && acquisitionQueue.length === 0) {
      scanWatchedFolder();
    }
  }, [acquisitionMethod]);

  const scanWatchedFolder = async () => {
    try {
      const res = await axiosClient.post("/ingest-files");
      if (res.data && res.data.success) {
        const data = res.data.data;
        const newItems = data.filesFound.map((file) => ({
          id: `file_${file}_${Date.now()}`,
          item: file,
          source: "Watched Folder",
          status: "Ready",
          lastUpdate: new Date().toLocaleTimeString(),
        }));

        setAcquisitionQueue(newItems);
        showToast(
          "✓ Watched Folder Scanned",
          `Detected ${data.filesFound.length} test scan files in staging folder (${data.rawCurvePoints.length} points).`,
          "info"
        );
      }
    } catch (e) {
      console.warn("Failed scanning watched folder:", e.message);
    }
  };

  const handleAcquisition = async () => {
    setAcquiring(true);

    try {
      let resultPayload = null;

      if (acquisitionMethod === "live-tcp") {
        const [type] = requestType.split(" ");
        const result = await acquireTrajectory(bridgeConfig, { requestType: type, templateNumber });
        if (result.success) {
          resultPayload = result.payload;
        }
      } else if (acquisitionMethod === "watched-folder") {
        // Trigger ingestion & pipeline execution on backend
        const ingestRes = await axiosClient.post("/ingest-files");
        const pipelineRes = await axiosClient.post("/process-pipeline");

        if (pipelineRes.data && pipelineRes.data.success) {
          const pipeline = pipelineRes.data.pipeline;
          resultPayload = {
            source: "Watched Folder",
            responseCode: "002",
            weldType: "Fillet Weld",
            pathCount: 1,
            totalPoints: pipeline.totalPoints,
            plateThicknessMm: 3.0,
            weldGapMm: 0.8,
            pathPoints: pipeline.robotTargets,
            rapidCode: pipeline.rapidCode,
            pipeline,
            timestamp: new Date().toISOString(),
          };
          setCanonicalPath({
            id: `canonical_${Date.now()}`,
            source: "Feature.txt",
            coordinateFrame: "WorkObject Frame",
            pathPoints: pipeline.robotTargets,
            rapidCode: pipeline.rapidCode,
            totalPoints: pipeline.totalPoints,
            status: pipeline.matrixStatus,
          });
        }
      } else {
        // Manual Import Mode
        if (selectedFiles.length > 0) {
          const formData = new FormData();
          for (const file of selectedFiles) {
            formData.append("files", file);
          }
          await axiosClient.post("/ingest-files", formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }

        const pipelineRes = await axiosClient.post("/process-pipeline");
        if (pipelineRes.data && pipelineRes.data.success) {
          const pipeline = pipelineRes.data.pipeline;
          resultPayload = {
            source: "Manual Import",
            responseCode: "002",
            weldType: "Fillet Weld",
            pathCount: 1,
            totalPoints: pipeline.totalPoints,
            plateThicknessMm: 3.0,
            weldGapMm: 0.8,
            pathPoints: pipeline.robotTargets,
            rapidCode: pipeline.rapidCode,
            pipeline,
            timestamp: new Date().toISOString(),
          };
          setCanonicalPath({
            id: `canonical_${Date.now()}`,
            source: selectedFiles[0]?.name || "Feature.txt",
            coordinateFrame: "WorkObject Frame",
            pathPoints: pipeline.robotTargets,
            rapidCode: pipeline.rapidCode,
            totalPoints: pipeline.totalPoints,
            status: pipeline.matrixStatus,
          });
        }
      }

      if (resultPayload) {
        setRawPayloadData(resultPayload);
        updateProgress({ acquisitionComplete: true });
        setAcquisitionComplete(true);

        // Populate Acquisition Queue
        setAcquisitionQueue((prev) => [
          ...prev,
          {
            id: `acq_${Date.now()}`,
            item: acquisitionMethod === "live-tcp" ? "tcp_stream_packet.bin" : "Feature.txt",
            source: acquisitionMethod === "live-tcp" ? "Live TCP Stream" : acquisitionMethod === "watched-folder" ? "Watched Folder" : "Manual Import",
            status: "Completed",
            lastUpdate: new Date().toLocaleTimeString(),
          },
        ]);

        showToast(
          "✓ Acquisition Complete",
          `Ingested seam data successfully: ${resultPayload.totalPoints} 3D trajectory points ready for Parse & Map.`,
          "success"
        );
      }
    } catch (err) {
      console.error("Acquisition error:", err);
      showToast("❌ Acquisition Error", "Failed to acquire trajectory data from source.", "error");
    } finally {
      setAcquiring(false);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    if (files.length > 0) {
      showToast(
        "✓ Files Selected",
        `Selected ${files.length} test files (${files.map((f) => f.name).join(", ")}).`,
        "info"
      );
      setAcquisitionQueue(
        files.map((f) => ({
          id: `file_${f.name}_${Date.now()}`,
          item: f.name,
          source: "Manual Import",
          status: "Staged",
          lastUpdate: new Date().toLocaleTimeString(),
        }))
      );
    }
  };

  const handleNextStep = () => {
    if (!acquisitionComplete) {
      handleAcquisition();
    }
    router.push("/parse-map");
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
                { value: "watched-folder", label: "Watched Folder", desc: "Monitor backend uploads staging folder for test scan files." },
                { value: "manual", label: "Manual Import", desc: "Select local Feature.txt, handeye_result.yaml, Cfig, or CamerDepth.txt files." },
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

          {/* Card 2: Stream Request Configuration (Live TCP Only) */}
          {acquisitionMethod === "live-tcp" && (
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
              </div>
            </div>
          )}

          {/* Card 3: File Watch & Fallback Ingestion (Watched Folder & Manual) */}
          {acquisitionMethod !== "live-tcp" && (
            <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
              <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
                <span className="material-symbols-outlined text-[18px] text-primary">folder_copy</span>
                {acquisitionMethod === "watched-folder" ? "Watched Folder Ingestion" : "Manual File Import"}
              </h3>
              <div className="flex flex-col gap-4">
                {acquisitionMethod === "watched-folder" ? (
                  <>
                    <div>
                      <label htmlFor="acq-folder" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                        Target Folder Location
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="acq-folder"
                          type="text"
                          value={watchFolder}
                          onChange={(e) => setWatchFolder(e.target.value)}
                          className="flex-1 bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-mono font-semibold focus:outline-none focus:border-primary appearance-none"
                        />
                        <button
                          type="button"
                          onClick={scanWatchedFolder}
                          className="bg-primary/10 hover:bg-primary/20 text-primary px-3 py-2 rounded-md font-bold text-xs uppercase cursor-pointer"
                        >
                          Scan
                        </button>
                      </div>
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
                        Auto-detect scan files (Feature.txt, handeye_result.yaml, Cfig, CamerDepth.txt)
                      </label>
                    </div>
                  </>
                ) : (
                  <div>
                    <label htmlFor="acq-file" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                      Select Files (Feature.txt, handeye_result.yaml, Cfig, CamerDepth.txt)
                    </label>
                    <input
                      id="acq-file"
                      type="file"
                      multiple
                      accept=".txt,.yaml,.yml,.json,*/*"
                      onChange={handleFileSelect}
                      className="w-full text-xs text-on-surface-variant file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-primary file:text-on-primary file:hover:bg-primary/90 cursor-pointer"
                    />
                  </div>
                )}

                <div>
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Supported Scan File Formats</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {[
                      { ext: ".txt", label: "Feature.txt / CamerDepth.txt" },
                      { ext: ".yaml", label: "handeye_result.yaml" },
                      { ext: ".json", label: "Cfig Setup" },
                    ].map((fmt) => (
                      <span key={fmt.ext} className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                        {fmt.ext} ({fmt.label})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Card 4: Acquisition Queue */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">queue</span>
              Acquisition Queue ({acquisitionQueue.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-on-surface-variant font-bold uppercase tracking-wider text-[10px]">
                    <th className="text-left pb-2">Item</th>
                    <th className="text-left pb-2">Source</th>
                    <th className="text-left pb-2">Status</th>
                    <th className="text-left pb-2">Last Update</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisitionQueue.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="py-3 text-center text-on-surface-variant text-xs">
                        No files in queue. Click "Start Acquisition" or scan folder to ingest.
                      </td>
                    </tr>
                  ) : (
                    acquisitionQueue.map((q) => (
                      <tr key={q.id} className="border-t border-outline-variant/30">
                        <td className="py-2 font-mono font-bold text-on-surface">{q.item}</td>
                        <td className="py-2 text-on-surface-variant">{q.source}</td>
                        <td className="py-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            q.status === "Completed" || q.status === "Ready"
                              ? "bg-green-500/10 text-green-600"
                              : q.status === "Staged"
                              ? "bg-blue-500/10 text-blue-600"
                              : "bg-amber-500/10 text-amber-600"
                          }`}>
                            {q.status}
                          </span>
                        </td>
                        <td className="py-2 text-on-surface-variant font-mono">{q.lastUpdate}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Start Acquisition Button */}
          <button
            onClick={handleAcquisition}
            disabled={acquiring}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            {acquiring ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Processing Ingestion...
              </>
            ) : acquisitionComplete ? (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Acquisition Complete — Ready for Parse & Map
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Start Acquisition & Process Pipeline
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
            <button
              onClick={handleNextStep}
              className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm cursor-pointer"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
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
            <div className="flex items-start justify-between mb-6">
              {/* Route 1: Live TCP */}
              <div className="flex-1 flex flex-col items-center">
                <div className={`w-full h-20 border-2 rounded-xl flex flex-col items-center justify-center gap-1 backdrop-blur-sm transition-all ${
                  acquisitionMethod === "live-tcp" ? "border-teal-400 bg-teal-900/40" : "border-outline-variant/30 bg-surface/40 opacity-60"
                }`}>
                  <span className="text-[10px] font-bold text-teal-300 font-mono">Live TCP Stream</span>
                  <span className="text-[10px] font-mono text-teal-400/70">Port 7001</span>
                </div>
              </div>

              {/* Route 2: Watched Folder / Manual */}
              <div className="flex-1 flex flex-col items-center">
                <div className={`w-full h-20 border-2 rounded-xl flex flex-col items-center justify-center gap-1 backdrop-blur-sm transition-all ${
                  acquisitionMethod !== "live-tcp" ? "border-orange-400 bg-orange-900/40" : "border-outline-variant/30 bg-surface/40 opacity-60"
                }`}>
                  <span className="text-[10px] font-bold text-orange-300 font-mono">Scan Files (Feature.txt, handeye)</span>
                  <span className="text-[10px] font-mono text-orange-400/70">{acquisitionMethod === "watched-folder" ? "backend/uploads" : "Browser Upload"}</span>
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
                <span className="text-[10px] font-bold text-green-300 uppercase tracking-wider">Active Dataset Buffer</span>
                <span className="text-lg font-mono font-bold text-green-400">
                  {acquisitionComplete ? "Dataset Active & Matrix Transformed" : "Ready for Ingestion"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
