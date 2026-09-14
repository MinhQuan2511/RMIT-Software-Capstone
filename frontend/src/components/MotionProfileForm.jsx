"use client";

import React, { useMemo, useState } from "react";
import { Card, Icon } from "./StatusPanels";

const CLEARANCE_LABELS = {
  approachBackoffMm: "Approach back-off",
  approachLateralMm: "Approach lateral",
  approachLiftMm: "Approach lift",
  retractForwardMm: "Retract forward",
  retractLateralMm: "Retract lateral",
  retractLiftMm: "Retract lift",
  homeLateralMm: "Standby lateral",
  homeLiftMm: "Standby lift above weld",
};

const MOTION_LABELS = {
  home: "Move to standby (first move)",
  approach: "Move to approach",
  weldStart: "Move to weld start",
  weld: "Weld path",
  retract: "Retract",
  returnHome: "Return to standby",
  firstTarget: "First target",
  target: "Other targets",
};

/**
 * Supported parameters only, wired end-to-end: form → validated profile →
 * new job revision → planner/compiler → previews → export. Parent should key
 * this component by revision so it re-initialises from the stored record.
 */
export default function MotionProfileForm({ record, speeds, zones, disabled, onReprocess, busy }) {
  const base = record.parameters;
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(base)));
  const [touched, setTouched] = useState(false);
  const isPoints = record.profile.id === "point-list-linear";

  const errors = useMemo(() => {
    const e = [];
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(draft.toolName || "")) e.push("Tool name must be a RAPID identifier.");
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(draft.wobjName || "")) e.push("Work object name must be a RAPID identifier.");
    for (const [k, v] of Object.entries(draft.clearances || {})) {
      if (!Number.isFinite(v) || v < 0 || v > 1000) e.push(`${CLEARANCE_LABELS[k]} must be 0–1000 mm.`);
    }
    return e;
  }, [draft]);

  const changed = JSON.stringify(draft) !== JSON.stringify(base);
  const setClear = (k, v) => { setTouched(true); setDraft((d) => ({ ...d, clearances: { ...d.clearances, [k]: v === "" ? NaN : Number(v) } })); };
  const setMotion = (k, f, v) => { setTouched(true); setDraft((d) => ({ ...d, motion: { ...d.motion, [k]: { ...d.motion[k], [f]: v } } })); };

  const submit = () => {
    const parameters = { toolName: draft.toolName, wobjName: draft.wobjName, motion: draft.motion };
    if (!isPoints) { parameters.clearances = draft.clearances; parameters.nearStraightArcPolicy = draft.nearStraightArcPolicy; }
    if (isPoints) parameters.profileId = "point-list-linear";
    onReprocess(parameters);
  };

  return (
    <Card title="Motion profile (supported parameters)" icon="tune">
      <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
        Profile <span className="font-mono">{record.profile.id}@{record.profile.version}</span>. Changing any value creates a new
        revision; reviews and acknowledgements of the current revision do not carry over. Clearance offsets are a fixed geometric
        heuristic and are not collision-checked. Seam width is display-only and has no effect on motion.
      </p>

      <fieldset disabled={disabled || busy} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide flex flex-col gap-1">Tool name
            <input value={draft.toolName} onChange={(e) => { setTouched(true); setDraft({ ...draft, toolName: e.target.value }); }} className="font-mono text-xs bg-surface-container-highest border border-outline-variant rounded px-2 py-1.5 normal-case" />
          </label>
          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide flex flex-col gap-1">Work object
            <input value={draft.wobjName} onChange={(e) => { setTouched(true); setDraft({ ...draft, wobjName: e.target.value }); }} className="font-mono text-xs bg-surface-container-highest border border-outline-variant rounded px-2 py-1.5 normal-case" />
          </label>
        </div>
        <p className="text-[10px] text-on-surface-variant -mt-1">Names only: the module references them; they must already be declared on the controller.</p>

        {!isPoints && (
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(draft.clearances).map((k) => (
              <label key={k} className="text-[10px] font-bold text-on-surface-variant flex flex-col gap-1">{CLEARANCE_LABELS[k]} (mm)
                <input type="number" min={0} max={1000} step={1} value={Number.isFinite(draft.clearances[k]) ? draft.clearances[k] : ""} onChange={(e) => setClear(k, e.target.value)} className="font-mono text-xs bg-surface-container-highest border border-outline-variant rounded px-2 py-1.5" />
              </label>
            ))}
          </div>
        )}

        <table className="w-full text-[11px]">
          <caption className="text-left text-[10px] font-bold text-on-surface-variant uppercase tracking-wide pb-1">Speed and zone per move</caption>
          <tbody>
            {Object.keys(draft.motion).map((k) => (
              <tr key={k}>
                <th scope="row" className="text-left font-semibold py-0.5 pr-2">{MOTION_LABELS[k] || k}</th>
                <td className="py-0.5 pr-1">
                  <select aria-label={`${MOTION_LABELS[k] || k} speed`} value={draft.motion[k].speed} onChange={(e) => setMotion(k, "speed", e.target.value)} className="font-mono bg-surface-container-highest border border-outline-variant rounded px-1 py-0.5">
                    {speeds.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </td>
                <td className="py-0.5">
                  <select aria-label={`${MOTION_LABELS[k] || k} zone`} value={draft.motion[k].zone} onChange={(e) => setMotion(k, "zone", e.target.value)} className="font-mono bg-surface-container-highest border border-outline-variant rounded px-1 py-0.5">
                    {zones.map((z) => <option key={z}>{z}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!isPoints && (
          <label className="text-[11px] flex flex-col gap-1">
            <span className="font-bold text-on-surface-variant">Near-straight arc handling</span>
            <select value={draft.nearStraightArcPolicy} onChange={(e) => { setTouched(true); setDraft({ ...draft, nearStraightArcPolicy: e.target.value }); }} className="bg-surface-container-highest border border-outline-variant rounded px-2 py-1">
              <option value="reject">Reject (default)</option>
              <option value="convert_to_line">Convert to a straight seam (requires acknowledgement)</option>
            </select>
          </label>
        )}

        {touched && errors.length > 0 && (
          <ul className="text-[11px] text-red-800 bg-red-50 border border-red-300 rounded p-2 list-disc pl-5" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={submit} disabled={!changed || errors.length > 0} className="flex-1 bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-1.5">
            <Icon name={busy ? "progress_activity" : "refresh"} className={`text-[16px] ${busy ? "animate-spin" : ""}`} />
            {changed ? `Reprocess as revision ${record.revision + 1}` : "No changes"}
          </button>
          <button type="button" onClick={() => { setDraft(JSON.parse(JSON.stringify(base))); setTouched(false); }} disabled={!changed} className="px-3 border border-outline-variant rounded-lg text-xs font-bold disabled:opacity-40">Reset</button>
        </div>
      </fieldset>
    </Card>
  );
}
