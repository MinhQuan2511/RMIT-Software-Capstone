"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import {
  pingEndpoint,
  startService,
  stopService,
  sendTestRequest,
  requestCapabilities,
  clearSession,
} from "@/services/tracerStudioTcpBridge";

export default function ConnectPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    bridgeConfig,
    connectionStatus,
    setConnection,
    sessionEvents,
    addSessionEvent,
    clearSessionEvents,
    lastResponse,
    setLastResponse,
    updateProgress,
  } = useTcpWorkflow();

  const [pinging, setPinging] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connectionConfirmed, setConnectionConfirmed] = useState(false);
  const logRef = useRef(null);

  // Auto-scroll event log
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [sessionEvents, autoScroll]);

  const formatTimestamp = (isoStr) => {
    const d = new Date(isoStr);
    return d.toTimeString().split(" ")[0] + "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  const eventColor = (type) => {
    if (type === "success" || type === "connected") return "bg-green-500";
    if (type === "warning" || type === "amber") return "bg-amber-500";
    if (type === "error") return "bg-error";
    return "bg-gray-400";
  };

  const mockPing = async () => {
    setPinging(true);
    try {
      const result = await pingEndpoint(bridgeConfig);
      if (result.success) {
        addSessionEvent({ type: "success", message: `Pinged ${result.endpoint} — ${result.latency}ms latency` });
        setLastResponse({ code: "900", latency: result.latency });
        showToast("✓ Ping Successful", `${result.endpoint} responded in ${result.latency}ms`, "success");
      }
    } catch {
      addSessionEvent({ type: "error", message: `Ping failed: ${bridgeConfig.host}:${bridgeConfig.port}` });
      showToast("❌ Ping Failed", "Could not reach the bridge endpoint.", "error");
    } finally {
      setPinging(false);
    }
  };

  const mockAction = async (action, command, label) => {
    setActionLoading(action);
    try {
      let result;
      switch (action) {
        case "start": result = await startService(bridgeConfig); break;
        case "stop": result = await stopService(bridgeConfig); break;
        case "test": result = await sendTestRequest(bridgeConfig, "011"); break;
        case "capabilities": result = await requestCapabilities(bridgeConfig); break;
        case "clear": result = await clearSession(bridgeConfig); break;
        default: return;
      }
      if (result.success) {
        addSessionEvent({ type: "success", message: `${label}: ${result.message || result.command}` });
        if (result.responseCode) {
          setLastResponse({ code: result.responseCode, latency: Math.floor(Math.random() * 50) + 20 });
        }
        showToast("✓ " + label, result.message || `Command ${result.command} executed.`, "success");
      }
    } catch {
      addSessionEvent({ type: "error", message: `${label} failed` });
      showToast("❌ " + label, "Action failed.", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmConnection = async () => {
    setActionLoading("confirm");
    await new Promise((r) => setTimeout(r, 600));
    setConnection("connected");
    setConnectionConfirmed(true);
    updateProgress({ connectionComplete: true });
    addSessionEvent({ type: "connected", message: `Connected to ${bridgeConfig.host}:${bridgeConfig.port}` });
    showToast("✓ Connected to TracerStudio Bridge", "Bridge connection established successfully.", "success");
    setTimeout(() => router.push("/acquire"), 800);
    setActionLoading(null);
  };

  // Mock initial events
  useEffect(() => {
    if (sessionEvents.length === 0) {
      addSessionEvent({ type: "info", message: `Waiting for connection to ${bridgeConfig.host}:${bridgeConfig.port}` });
    }
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            TracerStudio Bridge Connection Center
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Validate the TCP bridge, test the handshake, and monitor live session status.
          </p>
        </div>

        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        <div className="flex-1 flex flex-col gap-5 pb-6">
          {/* Card 1: Live Connection Status */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">signal_cellular_alt</span>
              Live Connection Status
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Bridge Endpoint</span>
                  <span className="text-xs font-mono font-bold text-on-surface">{bridgeConfig?.host || "127.0.0.1"}:{bridgeConfig?.port || 7001}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-[10px] font-bold text-green-600">Online</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">TracerStudio Service</span>
                  <span className="text-xs font-mono font-bold text-on-surface">TCP Bridge v2.0.1</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-[10px] font-bold text-green-600">Running</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">RobotStudio Session</span>
                  <span className="text-xs font-mono font-bold text-on-surface">RobotStudio Add-in</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-[10px] font-bold text-green-600">Connected</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Last Heartbeat</span>
                  <span className="text-xs font-mono font-bold text-on-surface">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-green-500/10">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-[10px] font-bold text-green-600">OK ({lastResponse?.latency || 42} ms)</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Session ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-on-surface">a3f7b2c1-4d8e-4f9a-b123-0e5f6a7b8c9d</span>
                    <button
                      onClick={() => navigator.clipboard.writeText("a3f7b2c1-4d8e-4f9a-b123-0e5f6a7b8c9d")}
                      className="text-primary hover:text-on-primary p-1 rounded hover:bg-surface-container-high transition-colors"
                      aria-label="Copy session ID"
                      title="Copy Session ID"
                    >
                      <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Handshake & Test Actions */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">handshake</span>
              Handshake & Test Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={mockPing}
                disabled={pinging || actionLoading !== null}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                {pinging ? (
                  <>
                    <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                    Pinging...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[14px]">my_location</span>
                    Ping Endpoint
                  </>
                )}
              </button>
              <button
                onClick={() => mockAction("start", "000,1", "Start Service")}
                disabled={!!actionLoading}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                Start (000,1)
              </button>
              <button
                onClick={() => mockAction("stop", "000,0", "Stop Service")}
                disabled={!!actionLoading}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">stop</span>
                Stop (000,0)
              </button>
              <button
                onClick={() => mockAction("test", "011", "Test Request")}
                disabled={!!actionLoading}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">send</span>
                Test Req 011
              </button>
              <button
                onClick={() => mockAction("capabilities", "caps", "Capabilities")}
                disabled={!!actionLoading}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">info</span>
                Capabilities
              </button>
              <button
                onClick={() => mockAction("clear", "clear", "Clear Session")}
                disabled={!!actionLoading}
                className="bg-surface-container-high hover:bg-surface-container border border-outline-variant text-on-surface-variant hover:text-on-surface disabled:bg-surface-container-lowest disabled:text-on-surface-variant/50 px-3 py-2.5 rounded-lg text-[11px] font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                Clear Session
              </button>
            </div>
          </div>

          {/* Card 3: Session Event Log */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-xs text-on-surface flex items-center gap-2 select-none uppercase tracking-wide">
                <span className="material-symbols-outlined text-[18px] text-primary">terminal</span>
                Session Event Log
              </h3>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="w-3 h-3 rounded border-outline-variant text-primary focus:ring-primary bg-surface cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-on-surface-variant">Auto-scroll</span>
                </label>
                <button
                  onClick={clearSessionEvents}
                  className="text-[10px] font-bold text-on-surface-variant hover:text-error transition-colors"
                  aria-label="Clear event log"
                >
                  Clear
                </button>
              </div>
            </div>
            <div
              ref={logRef}
              className="bg-[#1e222b] rounded-lg p-3 overflow-y-auto max-h-[180px] font-mono text-[11px] leading-relaxed code-scroll"
              aria-live="polite"
            >
              {sessionEvents.length === 0 ? (
                <span className="text-on-surface-variant/50">No events yet. Start a connection test.</span>
              ) : (
                sessionEvents.map((evt, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`${eventColor(evt.type)} w-1.5 h-1.5 rounded-full mt-1.5 shrink-0`}></span>
                    <span className="text-on-surface-variant/60">{formatTimestamp(evt.timestamp)}</span>
                    <span className="text-on-surface">{evt.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Card 4: Response Inspector */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">insights</span>
              Response Inspector
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Last Response Code</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{lastResponse?.code || "—"}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Protocol</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{bridgeConfig?.transport || "TCP String"}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Round Trip</span>
                <span className="block font-mono font-bold text-on-surface mt-0.5">{lastResponse?.latency || "—"} ms</span>
              </div>
              <div className="p-2.5 rounded-lg border border-surface-container bg-surface-container-lowest">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Status</span>
                <span className="block font-mono font-bold text-[#10b981] mt-0.5">Ready</span>
              </div>
            </div>
          </div>

          {/* Confirm Button */}
          <button
            onClick={handleConfirmConnection}
            disabled={!!actionLoading || connectionConfirmed}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            {actionLoading === "confirm" ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Confirming...
              </>
            ) : connectionConfirmed ? (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Connected — Redirecting...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Confirm Connection & Continue
              </>
            )}
          </button>

          {/* Bottom Navigation */}
          <div className="flex gap-4 select-none">
            <Link
              href="/bridge-setup"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Bridge Setup
            </Link>
            <Link
              href="/acquire"
              className="flex-1 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm opacity-50 cursor-not-allowed"
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Right Viewport */}
      <Active3DViewport
        title="Connection Topology & Live Session"
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          <div className="relative z-10 w-full max-w-[650px] px-8">
            {/* Topology Nodes */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-col items-center gap-2">
                <div className="w-36 h-24 border-2 border-blue-400/60 rounded-xl bg-blue-900/20 flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-blue-400 text-xl">robot</span>
                  <span className="text-[9px] font-bold text-blue-300 font-mono">RobotStudio Add-in</span>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
              </div>
              <div className="flex-1 mx-3 flex flex-col items-center">
                <div className="w-full h-px bg-green-400/40 relative">
                  <div className="absolute right-0 -top-1 w-2 h-2 border-t-2 border-r-2 border-green-400/60 rotate-45"></div>
                </div>
                <span className="text-[9px] font-mono text-green-400/70 mt-1">Heartbeat OK</span>
                <span className="text-[9px] font-mono text-green-400/70">{lastResponse?.latency || 42}ms</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-36 h-24 border-2 border-teal-400/60 rounded-xl bg-teal-900/20 flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-teal-400 text-xl">hub</span>
                  <span className="text-[9px] font-bold text-teal-300 font-mono">TCP Bridge v2.0.1</span>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
              </div>
              <div className="flex-1 mx-3 flex flex-col items-center">
                <div className="w-full h-px bg-green-400/40 relative">
                  <div className="absolute right-0 -top-1 w-2 h-2 border-t-2 border-r-2 border-green-400/60 rotate-45"></div>
                </div>
                <span className="text-[9px] font-mono text-green-400/70 mt-1">900 ACK</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="w-36 h-24 border-2 border-purple-400/60 rounded-xl bg-purple-900/20 flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-purple-400 text-xl">dns</span>
                  <span className="text-[9px] font-bold text-purple-300 font-mono">TracerStudio</span>
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                </div>
              </div>
            </div>

            {/* Bridge Health Panel */}
            <div className="bg-surface/80 border border-outline-variant/30 rounded-xl p-4 mb-6">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Bridge Health</span>
              <div className="grid grid-cols-4 gap-3 mt-2">
                <div>
                  <span className="text-[9px] text-on-surface-variant">Uptime</span>
                  <span className="block text-xs font-mono font-bold text-on-surface">00:12:34</span>
                </div>
                <div>
                  <span className="text-[9px] text-on-surface-variant">Messages In</span>
                  <span className="block text-xs font-mono font-bold text-on-surface">1,247</span>
                </div>
                <div>
                  <span className="text-[9px] text-on-surface-variant">Messages Out</span>
                  <span className="block text-xs font-mono font-bold text-on-surface">1,198</span>
                </div>
                <div>
                  <span className="text-[9px] text-on-surface-variant">Errors</span>
                  <span className="block text-xs font-mono font-bold text-green-500">0</span>
                </div>
              </div>
            </div>

            {/* Live Packet Console */}
            <div className="bg-[#1e222b] rounded-xl p-3 border border-outline-variant/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Live Packet Console</span>
                <div className="flex items-center gap-2">
                  <button className="text-[10px] font-bold text-on-surface-variant hover:text-on-surface transition-colors" aria-label="Pause console">
                    Pause
                  </button>
                  <button className="text-[10px] font-bold text-on-surface-variant hover:text-error transition-colors" aria-label="Clear console">
                    Clear
                  </button>
                </div>
              </div>
              <div className="font-mono text-[11px] leading-relaxed code-scroll max-h-[120px] overflow-y-auto">
                <div className="flex gap-2"><span className="text-on-surface-variant/50">20:45:28.910</span><span className="text-teal-400">{'>>'}  000,1</span></div>
                <div className="flex gap-2"><span className="text-on-surface-variant/50">20:45:28.953</span><span className="text-green-400">{'<<'}  900</span></div>
                <div className="flex gap-2"><span className="text-on-surface-variant/50">20:45:29.102</span><span className="text-teal-400">{'>>'}  011,03,...</span></div>
                <div className="flex gap-2"><span className="text-on-surface-variant/50">20:45:29.145</span><span className="text-blue-400">{'<<'}  002,...</span></div>
                <div className="flex gap-2"><span className="text-on-surface-variant/50">20:45:29.312</span><span className="text-green-400">{'<<'}  Heartbeat OK</span></div>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
