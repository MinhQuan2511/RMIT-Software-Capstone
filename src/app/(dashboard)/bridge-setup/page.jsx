"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepperProgress from "@/components/StepperProgress";
import Active3DViewport from "@/components/Active3DViewport";
import { useToast } from "@/components/ToastContext";
import { useTcpWorkflow } from "@/components/TcpWorkflowContext";
import { saveBridgeConfig } from "@/services/tracerStudioTcpBridge";

export default function BridgeSetupPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { bridgeConfig, updateBridgeConfig, updateProgress } = useTcpWorkflow();

  // Initialize form state from config or defaults
  const [config, setConfig] = useState(
    bridgeConfig || {
      host: "127.0.0.1",
      port: 7001,
      transport: "TCP String",
      timeout: 3000,
      autoReconnect: true,
      protocolPreset: "TracerStudio 2.0",
      messageDelimiter: "CRLF",
      encoding: "UTF-8",
      heartbeatInterval: 5,
      keepalive: true,
      tracerStudioMode: "Local Workstation",
      autoLaunchTracerStudio: true,
      defaultSessionFolder: "C:\\TracerBridge\\Sessions\\",
      saveDiagnosticLogs: true,
    }
  );

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const validate = () => {
    const newErrors = {};
    if (!config.host.trim()) newErrors.host = "Host / IP Address is required";
    const portNum = parseInt(config.port);
    if (!config.port || isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      newErrors.port = "Port must be a positive integer (1-65535)";
    }
    const timeoutNum = parseInt(config.timeout);
    if (!config.timeout || isNaN(timeoutNum) || timeoutNum <= 0) {
      newErrors.timeout = "Timeout must be a positive number";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      const result = await saveBridgeConfig(config);
      if (result.success) {
        updateBridgeConfig(config);
        updateProgress({ bridgeConfigSaved: true });
        setConfigSaved(true);
        showToast(
          "✓ Bridge Configuration Saved",
          "Endpoint and protocol settings have been stored locally.",
          "success"
        );
      }
    } catch {
      showToast("❌ Save Error", "Failed to save bridge configuration.", "error");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field, value) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden w-full h-full relative">
      {/* Left Panel */}
      <div className="bg-surface-container-low border-r border-outline-variant shadow-sm flex flex-col w-[45%] h-full pt-6 px-5 gap-4 shrink-0 z-40 overflow-y-auto">
        <div className="px-1 select-none">
          <h2 className="text-xl font-extrabold text-on-surface tracking-tight">
            TracerStudio TCP Bridge Setup
          </h2>
          <p className="text-xs text-on-surface-variant font-medium mt-1.5 leading-relaxed">
            Configure a direct TCP bridge to TracerStudio when the native API is unavailable.
          </p>
        </div>

        <StepperProgress />

        <div className="h-px w-full bg-outline-variant/60 my-1 opacity-50"></div>

        <form onSubmit={handleSave} className="flex-1 flex flex-col gap-5 pb-6">
          {/* Card 1: Bridge Endpoint Configuration */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">settings_ethernet</span>
              Bridge Endpoint Configuration
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label htmlFor="bs-host" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Host / IP Address
                </label>
                <input
                  id="bs-host"
                  type="text"
                  value={config.host}
                  onChange={(e) => updateField("host", e.target.value)}
                  className={`w-full bg-surface-container-highest border rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none ${errors.host ? "border-error" : "border-outline-variant"}`}
                />
                {errors.host && <p className="text-[10px] text-error mt-1 font-semibold">{errors.host}</p>}
              </div>
              <div>
                <label htmlFor="bs-port" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Port
                </label>
                <input
                  id="bs-port"
                  type="number"
                  value={config.port}
                  onChange={(e) => updateField("port", e.target.value)}
                  className={`w-full bg-surface-container-highest border rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none ${errors.port ? "border-error" : "border-outline-variant"}`}
                />
                {errors.port && <p className="text-[10px] text-error mt-1 font-semibold">{errors.port}</p>}
              </div>
              <div>
                <label htmlFor="bs-transport" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Transport
                </label>
                <select
                  id="bs-transport"
                  value={config.transport}
                  onChange={(e) => updateField("transport", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>TCP String</option>
                  <option>TCP Raw Data</option>
                  <option>Modbus TCP</option>
                </select>
              </div>
              <div>
                <label htmlFor="bs-timeout" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Timeout (ms)
                </label>
                <input
                  id="bs-timeout"
                  type="number"
                  value={config.timeout}
                  onChange={(e) => updateField("timeout", e.target.value)}
                  className={`w-full bg-surface-container-highest border rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none ${errors.timeout ? "border-error" : "border-outline-variant"}`}
                />
                {errors.timeout && <p className="text-[10px] text-error mt-1 font-semibold">{errors.timeout}</p>}
              </div>
              <div className="flex items-center gap-3 pt-5">
                <input
                  id="bs-autoreconnect"
                  type="checkbox"
                  checked={config.autoReconnect}
                  onChange={(e) => updateField("autoReconnect", e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
                <label htmlFor="bs-autoreconnect" className="text-xs font-bold text-on-surface-variant">
                  Auto Reconnect
                </label>
              </div>
            </div>
          </div>

          {/* Card 2: Protocol Profile */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">language</span>
              Protocol Profile
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="bs-preset" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Protocol Preset
                </label>
                <input
                  id="bs-preset"
                  type="text"
                  value={config.protocolPreset}
                  onChange={(e) => updateField("protocolPreset", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div>
                <label htmlFor="bs-delimiter" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Message Delimiter
                </label>
                <select
                  id="bs-delimiter"
                  value={config.messageDelimiter}
                  onChange={(e) => updateField("messageDelimiter", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>None</option>
                  <option>CRLF</option>
                  <option>LF</option>
                  <option>Custom</option>
                </select>
              </div>
              <div>
                <label htmlFor="bs-encoding" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Encoding
                </label>
                <input
                  id="bs-encoding"
                  type="text"
                  value={config.encoding}
                  onChange={(e) => updateField("encoding", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div>
                <label htmlFor="bs-heartbeat" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Heartbeat Interval (s)
                </label>
                <input
                  id="bs-heartbeat"
                  type="number"
                  value={config.heartbeatInterval}
                  onChange={(e) => updateField("heartbeatInterval", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div className="flex items-center gap-3 pt-5">
                <input
                  id="bs-keepalive"
                  type="checkbox"
                  checked={config.keepalive}
                  onChange={(e) => updateField("keepalive", e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
                <label htmlFor="bs-keepalive" className="text-xs font-bold text-on-surface-variant">
                  Keepalive
                </label>
              </div>
            </div>
          </div>

          {/* Card 3: Session Routing */}
          <div className="bg-surface border border-outline-variant rounded-xl p-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <h3 className="font-bold text-xs text-on-surface mb-3.5 flex items-center gap-2 select-none uppercase tracking-wide">
              <span className="material-symbols-outlined text-[18px] text-primary">route</span>
              Session Routing
            </h3>
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="bs-mode" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  TracerStudio Mode
                </label>
                <select
                  id="bs-mode"
                  value={config.tracerStudioMode}
                  onChange={(e) => updateField("tracerStudioMode", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-semibold focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option>Local Workstation</option>
                  <option>Remote Workstation</option>
                  <option>Native Bridge Host</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="bs-autolaunch"
                  type="checkbox"
                  checked={config.autoLaunchTracerStudio}
                  onChange={(e) => updateField("autoLaunchTracerStudio", e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
                <div>
                  <label htmlFor="bs-autolaunch" className="text-xs font-bold text-on-surface-variant">
                    Auto-Launch TracerStudio
                  </label>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">Mock capability — no actual launch in prototype</p>
                </div>
              </div>
              <div>
                <label htmlFor="bs-sessionfolder" className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">
                  Default Session Folder
                </label>
                <input
                  id="bs-sessionfolder"
                  type="text"
                  value={config.defaultSessionFolder}
                  onChange={(e) => updateField("defaultSessionFolder", e.target.value)}
                  className="w-full bg-surface-container-highest border border-outline-variant rounded-md px-3 py-2 text-xs text-on-surface font-mono font-semibold focus:outline-none focus:border-primary appearance-none"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="bs-logs"
                  type="checkbox"
                  checked={config.saveDiagnosticLogs}
                  onChange={(e) => updateField("saveDiagnosticLogs", e.target.checked)}
                  className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary focus:ring-offset-background bg-surface cursor-pointer"
                />
                <label htmlFor="bs-logs" className="text-xs font-bold text-on-surface-variant">
                  Save diagnostic packet logs
                </label>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            type="submit"
            disabled={saving}
            className="w-full bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            {saving ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                Saving...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">save</span>
                Save Bridge Configuration
              </>
            )}
          </button>

          {/* Bottom Navigation */}
          <div className="flex gap-4 select-none">
            <Link
              href="/projects"
              className="flex-1 bg-surface border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl py-3.5 font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
              Back to Project
            </Link>
            <Link
              href="/connect"
              className={`flex-1 bg-primary hover:bg-on-primary-fixed-variant disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary px-4 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 shadow-sm ${!configSaved ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Next Step
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </form>
      </div>

      {/* Right Viewport */}
      <Active3DViewport
        title="Bridge Architecture Visualizer"
        showSolidControls
      >
        <div className="w-full h-full flex flex-col items-center justify-center relative">
          {/* Dark viewport with grid */}
          <div className="absolute inset-0 bg-3d-viewport"></div>
          <div className="absolute inset-0 viewport-grid"></div>

          {/* Architecture Diagram */}
          <div className="relative z-10 w-full max-w-[700px] px-8">
            {/* Three Nodes Row */}
            <div className="flex items-center justify-between mb-12">
              {/* Node 1: RobotStudio Add-in */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-40 h-28 border-2 border-blue-400/60 rounded-xl bg-blue-900/20 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-blue-400 text-2xl">robot</span>
                  <span className="text-[10px] font-bold text-blue-300 font-mono">RobotStudio Add-in</span>
                </div>
              </div>

              {/* Arrow 1 */}
              <div className="flex-1 mx-4 flex flex-col items-center">
                <div className="w-full h-px bg-teal-400/40 relative">
                  <div className="absolute right-0 -top-1 w-2 h-2 border-t-2 border-r-2 border-teal-400/60 rotate-45"></div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[9px] font-mono text-teal-400/70">Pose Stream</span>
                  <span className="text-[9px] font-mono text-teal-400/70">Controller State</span>
                  <span className="text-[9px] font-mono text-teal-400/70">Commands</span>
                </div>
              </div>

              {/* Node 2: TCP Bridge */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-40 h-28 border-2 border-teal-400/60 rounded-xl bg-teal-900/20 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-teal-400 text-2xl">hub</span>
                  <span className="text-[10px] font-bold text-teal-300 font-mono">TCP Bridge</span>
                </div>
              </div>

              {/* Arrow 2 */}
              <div className="flex-1 mx-4 flex flex-col items-center">
                <div className="w-full h-px bg-purple-400/40 relative">
                  <div className="absolute right-0 -top-1 w-2 h-2 border-t-2 border-r-2 border-purple-400/60 rotate-45"></div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[9px] font-mono text-purple-400/70">Commands 011</span>
                  <span className="text-[9px] font-mono text-purple-400/70">012 / 021</span>
                </div>
              </div>

              {/* Node 3: TracerStudio Service */}
              <div className="flex flex-col items-center gap-3">
                <div className="w-40 h-28 border-2 border-purple-400/60 rounded-xl bg-purple-900/20 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-purple-400 text-2xl">dns</span>
                  <span className="text-[10px] font-bold text-purple-300 font-mono">TracerStudio</span>
                </div>
              </div>
            </div>

            {/* Return Arrow */}
            <div className="flex items-center justify-between mx-8 mb-8">
              <div className="flex-1 mx-4 flex flex-col items-center">
                <div className="w-full h-px bg-green-400/30 relative">
                  <div className="absolute left-0 -top-1 w-2 h-2 border-b-2 border-l-2 border-green-400/60 -rotate-45"></div>
                </div>
                <div className="flex flex-col gap-0.5 mt-1">
                  <span className="text-[9px] font-mono text-green-400/70">Acknowledgements</span>
                  <span className="text-[9px] font-mono text-green-400/70">Status</span>
                  <span className="text-[9px] font-mono text-green-400/70">Parsed Path</span>
                </div>
              </div>
            </div>

            {/* Small Panels */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">Controller Pose</span>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[9px] font-mono text-primary">World</span>
                  <span className="text-[9px] font-mono text-primary">Tool</span>
                  <span className="text-[9px] font-mono text-primary">Joint</span>
                </div>
                <span className="text-[9px] text-on-surface-variant">Real-time Stream</span>
              </div>
              <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">Forwarded Commands</span>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[9px] font-mono text-teal-400">011</span>
                  <span className="text-[9px] font-mono text-teal-400">012</span>
                  <span className="text-[9px] font-mono text-teal-400">021</span>
                </div>
              </div>
              <div className="bg-surface/80 border border-outline-variant/30 rounded-lg p-3">
                <span className="text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">Trajectory Response</span>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[9px] font-mono text-purple-400">002</span>
                  <span className="text-[9px] font-mono text-purple-400">900</span>
                  <span className="text-[9px] font-mono text-purple-400">999</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Active3DViewport>
    </div>
  );
}
