"use client";

import React, { useState, useSyncExternalStore } from "react";
import { USABILITY_KEY, usabilityLog } from "@/lib/usabilityLog";
import { Card, Icon } from "./StatusPanels";

const noopSubscribe = () => () => {};
const readRaw = () => {
  try { return window.localStorage.getItem(USABILITY_KEY) || ""; } catch { return ""; }
};

/** Opt-in local capture of workflow timing events for a future human evaluation. */
export default function UsabilityCapture() {
  const [, bump] = useState(0);
  const raw = useSyncExternalStore(noopSubscribe, readRaw, () => null);
  if (raw === null) return null;
  const log = usabilityLog.get();
  const state = log.state();
  const act = (fn) => { fn(); bump((n) => n + 1); };

  const exportJson = () => {
    const blob = new Blob([log.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vd-usability-events.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <Card title="Workflow timing capture (optional, for evaluation sessions)" icon="timer">
      <p className="text-[11px] text-on-surface-variant leading-relaxed">
        Off unless you switch it on. It records only when workflow steps happen (source selected, job created, reviews, downloads)
        as milliseconds since capture started. No names, file names, coordinates or hashes. Data stay in this browser until you
        export or clear them. It does not measure robot, controller or preparation time.
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
        <span className="font-bold flex items-center gap-1"><Icon name={state.enabled ? "radio_button_checked" : "radio_button_unchecked"} className="text-[15px]" />{state.enabled ? "Capturing" : "Off"} · {state.events.length} event(s)</span>
        <button type="button" onClick={() => act(() => (state.enabled ? log.disable() : log.enable()))} className="border border-outline-variant rounded px-2 py-1 font-bold">{state.enabled ? "Stop capture" : "Start capture"}</button>
        <button type="button" onClick={exportJson} disabled={state.events.length === 0} className="border border-outline-variant rounded px-2 py-1 font-bold disabled:opacity-40">Export events (JSON)</button>
        <button type="button" onClick={() => act(() => log.clear())} disabled={state.events.length === 0} className="border border-outline-variant rounded px-2 py-1 font-bold disabled:opacity-40">Clear</button>
      </div>
    </Card>
  );
}
