"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { acquireTrajectory } from "@/services/tracerStudioTcpBridge";
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
    rawPayload,
    connectionStatus,
    workflowMode,
  } = useTcpWorkflow();

  const [requestType, setRequestType] = useState("011 Single Trajectory");
  const [templateNumber, setTemplateNumber] = useState("03");
  const [watchFolder, setWatchFolder] = useState("C:\\TracerBridge\\Inbound\\");
  const [acquiring, setAcquiring] = useState(false);
  const [acquisitionComplete, setAcquisitionComplete] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("log");

  // Terminal streaming logs simulation
  useEffect(() => {
    if (acquiring) {
      const logs = [
        `[${new Date().toLocaleTimeString()}] INITIATING ${acquisitionMethod.toUpperCase()} ACQUISITION...`,
        `[${new Date().toLocaleTimeString()}] SOCKET CONNECTED: ${bridgeConfig?.ip || "localhost"}:7001`,
        `[${new Date().toLocaleTimeString()}] SENDING REQUEST: ${requestType}`,
      ];
      setTerminalLogs(logs);

      const interval = setInterval(() => {
        setTerminalLogs((prev) =>
          [
            ...prev,
            `[${new Date().toLocaleTimeString()}] RECEIVING PACKET: ${Math.floor(Math.random() * 1000)} BYTES...`,
            `[${new Date().toLocaleTimeString()}] DATA BUFFER STATUS: ${Math.floor(Math.random() * 100)}%`,
          ].slice(-10)
        );
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [acquiring, acquisitionMethod, bridgeConfig, requestType]);

  useEffect(() => {
    if (acquisitionComplete && rawPayload) {
      setTerminalLogs((prev) =>
        [
          ...prev,
          `[${new Date().toLocaleTimeString()}] ACQUISITION SUCCESSFUL.`,
          `[${new Date().toLocaleTimeString()}] TOTAL POINTS: ${rawPayload.totalPoints}`,
        ].slice(-10)
      );
    }
  }, [acquisitionComplete, rawPayload]);

  // Scan watched folder automatically if selected
  useEffect(() => {
    if (acquisitionMethod === "watched-folder" && acquisitionQueue.length === 0) {
      scanWatchedFolder();
    }
  }, [acquisitionMethod]);

  // Trigger backend scan for watched folder
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
      }
    } catch (e) {
      console.warn("Failed scanning watched folder:", e.message);
    }
  };

  // Upload staged files to Express backend and process pipeline kinematics
  const handleAcquisition = async () => {
    setAcquiring(true);
    try {
      let resultPayload = null;

      if (acquisitionMethod === "live-tcp") {
        const [type] = requestType.split(" ");
        const result = await acquireTrajectory(bridgeConfig, { requestType: type, templateNumber });
        if (result.success) resultPayload = result.payload;
      } else {
        // 1. Upload staged files to Express Backend (/api/ingest-files) if manual import is used
        if (selectedFiles.length > 0) {
          const formData = new FormData();
          selectedFiles.forEach((file) => {
            formData.append("files", file);
          });
          await axiosClient.post("/ingest-files", formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        }

        // 2. Trigger pipeline transformation using newly uploaded files
        const pipelineRes = await axiosClient.post("/process-pipeline");
        if (pipelineRes.data && pipelineRes.data.success) {
          const pipeline = pipelineRes.data.pipeline;
          resultPayload = {
            source: pipeline.sourceFile || (acquisitionMethod === "watched-folder" ? "Watched Folder" : "Manual Import"),
            totalPoints: pipeline.totalWaypoints,
            waypoints: pipeline.waypoints,
            timestamp: new Date().toISOString(),
          };

          setCanonicalPath({
            id: `canonical_${Date.now()}`,
            source: pipeline.sourceFile || selectedFiles[0]?.name || "Feature.txt",
            waypoints: pipeline.waypoints,
            totalWaypoints: pipeline.totalWaypoints,
          });
        }
      }

      if (resultPayload) {
        setRawPayloadData(resultPayload);
        updateProgress({ acquisitionComplete: true });
        setAcquisitionComplete(true);

        // Update queue item status to Completed
        setAcquisitionQueue((prev) =>
          prev.map((q) => ({
            ...q,
            status: "Completed",
            lastUpdate: new Date().toLocaleTimeString(),
          }))
        );

        showToast("✓ Ingested", `Trajectory points processed successfully.`, "success");
      }
    } catch (err) {
      console.error("Acquisition process error:", err);
      showToast("❌ Error", "Failed to acquire data from backend.", "error");
    } finally {
      setAcquiring(false);
    }
  };

  // Stage selected local files
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    if (files.length > 0) {
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

  // Navigate to Parse & Map page
  const handleNextStep = async () => {
    if (!acquisitionComplete) {
      await handleAcquisition();
    }
    router.push("/parse-map");
  };

  return (
    <div className="flex-1 flex w-full h-full relative bg-slate-950">
      {/* Left Control Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-3 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">Acquisition Method</h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">Choose whether weld data is acquired from a live TCP stream or output files.</p>
        </div>

        {/* Stepper Progress */}
        <div className="w-full overflow-visible">
          <StepperProgress />
        </div>

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>
        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* Card 1: Input Method Selection */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">input</span>Input Method Selection
            </h3>
            <div className="flex flex-col gap-3">
              {[
                { value: "live-tcp", label: "Live TCP Stream" },
                { value: "watched-folder", label: "Watched Folder" },
                { value: "manual", label: "Manual Import" },
              ].map((m) => (
                <label key={m.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${acquisitionMethod === m.value ? "border-primary bg-primary/5" : "border-outline-variant hover:border-outline"}`}>
                  <input type="radio" name="acquisition-method" value={m.value} checked={acquisitionMethod === m.value} onChange={() => setAcquisition(m.value)} className="w-4 h-4 mt-0.5" />
                  <span className="text-xs font-bold text-on-surface">{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Configuration Card */}
          {acquisitionMethod === "live-tcp" ? (
            <div className="bg-surface border border-outline-variant rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
              <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
                <span className="material-symbols-outlined text-[18px] text-primary">tune</span>Stream Configuration
              </h3>
              <div className="flex flex-col gap-4">
                <select value={requestType} onChange={(e) => setRequestType(e.target.value)} className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-semibold">
                  <option>011 Single Trajectory</option>
                  <option>012 Fused Trajectory</option>
                </select>
                <input type="text" value={templateNumber} readOnly className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono font-semibold" />
              </div>
            </div>
          ) : (
            <div className="bg-surface border border-outline-variant rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
              <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
                <span className="material-symbols-outlined text-[18px] text-primary">folder_copy</span>File Ingestion
              </h3>
              {acquisitionMethod === "watched-folder" ? (
                <div className="flex gap-2">
                  <input type="text" value={watchFolder} readOnly className="flex-1 bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs font-mono" />
                  <button onClick={scanWatchedFolder} className="bg-primary/10 text-primary px-3 py-2 rounded-md font-bold text-xs cursor-pointer">Scan</button>
                </div>
              ) : (
                <input type="file" multiple onChange={handleFileSelect} className="w-full text-xs text-on-surface-variant file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary file:text-on-primary cursor-pointer" />
              )}
            </div>
          )}

          {/* Acquisition Queue */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">queue</span>Queue ({acquisitionQueue.length})
            </h3>
            <div className="overflow-x-auto max-h-[120px]">
              <table className="w-full text-[11px]">
                <tbody>
                  {acquisitionQueue.map((q) => (
                    <tr key={q.id} className="border-t border-outline-variant/30">
                      <td className="py-2 font-mono font-bold text-on-surface truncate max-w-[150px]">{q.item}</td>
                      <td className="py-2 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${q.status === 'Completed' ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'}`}>
                          {q.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button onClick={handleAcquisition} disabled={acquiring} className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-sm">
            {acquiring ? <span className="material-symbols-outlined animate-spin">progress_activity</span> : <span className="material-symbols-outlined">play_arrow</span>}
            {acquiring ? "Processing..." : acquisitionComplete ? "Complete" : "Start Acquisition"}
          </button>

          <div className="flex gap-4 select-none">
            <Link href={workflowMode === "file" ? "/bridge-setup" : "/connect"} className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase flex items-center justify-center gap-2 shadow-sm">
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>Back
            </Link>
            <button onClick={handleNextStep} className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2 shadow-sm cursor-pointer">
              Next Step <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right Panel: Live Ingestion Hub */}
      <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(#475569 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>

        {/* 1. Live Stream Metrics */}
        <div className="p-6 grid grid-cols-3 gap-5 relative z-10">
          <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="material-symbols-outlined text-blue-400 text-lg">settings_input_component</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${connectionStatus === "connected" ? "bg-green-500/10 text-green-400" : "bg-slate-700 text-slate-400"}`}>
                {connectionStatus === "connected" ? "CONNECTED" : "IDLE"}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">TCP Socket</p>
            <p className="text-xl font-mono font-black text-slate-100">7001</p>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <span className="material-symbols-outlined text-blue-400 text-lg">memory</span>
              <span className="text-[10px] font-mono text-blue-400 font-bold">{acquiring ? "SYNCING" : "100%"}</span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Data Buffer</p>
            <div className="w-full h-1 bg-slate-800 rounded-full mt-2 overflow-hidden">
              <div className={`h-full bg-blue-500 transition-all duration-1000 ${acquiring ? "w-2/3 animate-pulse" : "w-full"}`}></div>
            </div>
          </div>

          <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="material-symbols-outlined text-blue-400 text-lg">quick_reference_all</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold">READY</span>
            </div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Incoming Packet</p>
            <p className="text-sm font-mono font-bold text-slate-100 truncate">{acquisitionMethod === "live-tcp" ? "tcp_stream_packet.bin" : selectedFiles[0]?.name || "Feature.txt"}</p>
          </div>
        </div>

        {/* 2. Visual Data Pipeline Canvas */}
        <div className="flex-1 flex items-center justify-center relative px-10">
          <div className="w-full max-w-4xl relative flex items-center justify-between">
            {/* Source Node */}
            <div className={`flex flex-col items-center gap-3 transition-all duration-500 ${acquiring ? "scale-110" : ""}`}>
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 shadow-2xl transition-all duration-500 ${acquiring ? "bg-blue-500 border-blue-400 animate-pulse" : "bg-slate-900 border-slate-700"}`}>
                <span className="material-symbols-outlined text-3xl text-white">
                  {acquisitionMethod === "live-tcp" ? "sensors" : "upload_file"}
                </span>
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Source Inbound</span>
            </div>

            {/* Connecting Line 1 */}
            <div className="flex-1 h-[2px] bg-slate-800 mx-4 relative overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-blue-500 to-transparent w-full transition-transform duration-[1500ms] ${acquiring ? "translate-x-full repeat-infinite" : "-translate-x-full"}`} style={{ animation: acquiring ? "slide 2s linear infinite" : "none" }}></div>
            </div>

            {/* Bridge Node */}
            <div className="flex flex-col items-center gap-3">
              <div className="w-20 h-20 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center shadow-[0_0_40px_rgba(30,41,59,0.5)]">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-500 ${acquiring ? "bg-blue-500/20 border-blue-500/50" : "bg-slate-800 border-slate-700"}`}>
                  <span className={`material-symbols-outlined text-2xl ${acquiring ? "text-blue-400" : "text-slate-500"}`}>hub</span>
                </div>
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">TCP Bridge 7001</span>
            </div>

            {/* Connecting Line 2 */}
            <div className="flex-1 h-[2px] bg-slate-800 mx-4 relative overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-blue-500 to-transparent w-full transition-transform duration-[1500ms] ${acquiring ? "translate-x-full repeat-infinite" : "-translate-x-full"}`} style={{ animation: acquiring ? "slide 2s linear infinite" : "none" }}></div>
            </div>

            {/* Buffer Node */}
            <div className="flex flex-col items-center gap-3">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border-2 transition-all duration-500 ${acquisitionComplete ? "bg-green-500 border-green-400 shadow-[0_0_30px_rgba(34,197,94,0.3)]" : "bg-slate-900 border-slate-700"}`}>
                <span className="material-symbols-outlined text-3xl text-white">inventory_2</span>
              </div>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">WeldPath Buffer</span>
            </div>
          </div>
        </div>

        {/* 3. Mini Console Log */}
        <div className="mx-6 mb-6 h-[180px] bg-slate-900/80 backdrop-blur-xl border border-slate-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl relative z-10">
          <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800 flex items-center justify-between">
            <div className="flex gap-4">
              <button onClick={() => setActiveTab("log")} className={`text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${activeTab === "log" ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}`}>Stream Log</button>
              <button onClick={() => setActiveTab("json")} className={`text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${activeTab === "json" ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}`}>Parsed JSON Preview</button>
            </div>
            <div className="flex gap-2">
              <button className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-500 cursor-pointer" title="Copy Data"><span className="material-symbols-outlined text-sm">content_copy</span></button>
              <button onClick={() => setTerminalLogs([])} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-500 cursor-pointer" title="Clear Log"><span className="material-symbols-outlined text-sm">delete_sweep</span></button>
            </div>
          </div>

          <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed custom-scrollbar">
            {activeTab === "log" ? (
              <div className="flex flex-col gap-1">
                {terminalLogs.length === 0 ? (
                  <p className="text-slate-600 italic">Listening for incoming data packets...</p>
                ) : (
                  terminalLogs.map((log, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="text-slate-600 shrink-0">[{i + 1}]</span>
                      <span className={log.includes("SUCCESSFUL") ? "text-green-400" : "text-blue-400/80"}>{log}</span>
                    </div>
                  ))
                )}
                {acquiring && <div className="w-1 h-3 bg-blue-500 animate-pulse inline-block ml-6"></div>}
              </div>
            ) : (
              <div className="text-slate-400 whitespace-pre">
                {rawPayload ? (
                  <div className="flex flex-col gap-1">
                    <p><span className="text-blue-400">"status"</span>: <span className="text-green-400">"VALIDATED"</span>,</p>
                    <p><span className="text-blue-400">"points"</span>: <span className="text-amber-400">{rawPayload.totalPoints}</span>,</p>
                    <p><span className="text-blue-400">"source"</span>: <span className="text-amber-400">"{rawPayload.source}"</span>,</p>
                    <p><span className="text-blue-400">"integrity_check"</span>: <span className="text-green-400">true</span></p>
                  </div>
                ) : (
                  <p className="text-slate-600 italic">No parsed data available yet.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <style jsx>{`
          @keyframes slide {
            from { transform: translateX(-100%); }
            to { transform: translateX(100%); }
          }
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        `}</style>
      </div>
    </div>
  );
}