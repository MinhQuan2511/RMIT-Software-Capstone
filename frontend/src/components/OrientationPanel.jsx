"use client";

import React, { useMemo, useState } from "react";
import { Card, Icon, StateBadge } from "./StatusPanels";
import { recomputeOrientation, isJointRelative } from "@/lib/orientationCheck";
import { AXES, DEFAULT_LIMITS, JOINT_PROFILE_ID, buildJointParameters, draftFromRecord, validateJointDraft } from "@/lib/jointInput";

const fmt = (v, dp = 4) => (Number.isFinite(v) ? v.toFixed(dp) : "—");
const vec = (v) => (Array.isArray(v) ? `[${v.map((c) => fmt(c, 4)).join(", ")}]` : "—");
const seamOf = (record) => {
  const g = record.geometry;
  const p = (pt) => [pt.x, pt.y, pt.z];
  return g && g.startPoint && g.endPoint ? { start: p(g.startPoint), end: p(g.endPoint) } : null;
};
const inputCls = "font-mono text-xs bg-surface-container-highest border border-outline-variant rounded px-2 py-1.5";
const labelCls = "text-[10px] font-bold text-on-surface-variant flex flex-col gap-1";

/** Unmistakable marker for synthetic fixtures and synthetic station profiles. */
export function SyntheticBanner({ record }) {
  const source = !!(record.source.provenance && record.source.provenance.value === "synthetic_fixture");
  const config = !!(record.profile.station && record.profile.station.provenance === "synthetic_fixture");
  if (!source && !config) return null;
  const what = source && config ? "fixture and station profile" : source ? "fixture" : "station profile";
  return (
    <p role="note" className="text-[11px] font-extrabold text-amber-950 bg-amber-200 border-2 border-amber-500 rounded px-2 py-1.5 uppercase tracking-wide">
      Synthetic {what}: offline evidence package only. Not for any controller.
    </p>
  );
}

/** Requested versus recovered angles for the stored revision. */
export function OrientationSummary({ record }) {
  const browser = useMemo(() => recomputeOrientation(record), [record]);
  if (!isJointRelative(record)) {
    return (
      <Card title="Torch orientation" icon="explore">
        <p className="text-[11px] text-on-surface-variant leading-relaxed">
          {record.mode === "testing"
            ? "Orientation comes from the point-list columns chosen during mapping."
            : "Legacy profile: one fixed base-frame weld quaternion (rotated about the arc normal for arcs). No work or push angle relative to the joint is computed."}
        </p>
      </Card>
    );
  }
  const o = record.orientation;
  const rec = o.recovered;
  const tc = o.toolConvention;
  const rows = [
    ["Joint frame source", `${o.jointFrame.source} — declared by the operator, not measured from the seam file`],
    [`Plate A (${o.jointFrame.plateLabels.A}) normal`, vec(o.jointFrame.normalA)],
    [`Plate B (${o.jointFrame.plateLabels.B}) normal`, vec(o.jointFrame.normalB)],
    ["Travel (start → end)", vec(o.jointFrame.travel)],
    ["Station / tool profile", `${o.station.label} (${o.station.id}@${o.station.version})`],
    ["Tool convention", `approach = tool ${tc.approachAxis}; roll = tool ${tc.rollAxis} ${tc.rollReference === "travel" ? "along" : "against"} travel`],
    ["Requested", `work ${fmt(o.requested.workAngleDeg, 3)}° · push ${fmt(o.requested.pushAngleDeg, 3)}°`],
    ["Recovered by the backend", `work ${fmt(rec.workAngleDeg, 6)}° · push ${fmt(rec.pushAngleDeg, 6)}° · roll error ${rec.rollErrorDeg.toExponential(1)}°`],
    ["Recomputed in this browser", browser ? `work ${fmt(browser.workAngleDeg, 6)}° · push ${fmt(browser.pushAngleDeg, 6)}° · ${browser.agrees ? "agrees" : "DOES NOT AGREE"} within ${browser.toleranceDeg}°` : "—"],
  ];
  return (
    <Card title="Joint-relative orientation (experimental)" icon="explore">
      <div className="flex flex-col gap-2">
        <SyntheticBanner record={record} />
        <div className="flex flex-wrap gap-2 items-center text-[11px]">
          <span className="font-bold">Mathematical check:</span><StateBadge value={rec.status} />
          <span className="font-bold ml-2">Configuration:</span><StateBadge value={o.station.provenance} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {rows.map(([k, v]) => (<React.Fragment key={k}><dt className="font-bold text-on-surface-variant">{k}</dt><dd className="font-mono break-words">{v}</dd></React.Fragment>))}
        </dl>
        <p className="text-[10px] text-on-surface-variant leading-relaxed">
          Work angle: measured perpendicular to the seam from plate A towards plate B. Push angle: positive when the torch tip leans
          towards the travel direction. Both come from the stored target quaternion; this is a mathematical check, not robot
          verification. RobotStudio validation: not run. Every target of this straight seam holds the same orientation
          {browser && browser.sameOrientationOnAllTargets ? " (confirmed from the stored targets)" : ""}.
        </p>
      </div>
    </Card>
  );
}

function VectorInput({ label, value, onChange }) {
  const num = (v) => (v === "" ? NaN : Number(v));
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-[10px] font-bold text-on-surface-variant">{label}</legend>
      <div className="grid grid-cols-3 gap-1">
        {["x", "y", "z"].map((axis, i) => (
          <input key={axis} type="number" step="any" aria-label={`${label} ${axis}`} value={Number.isFinite(value[i]) ? value[i] : ""}
            onChange={(e) => { const next = value.slice(); next[i] = num(e.target.value); onChange(next); }} className={inputCls} />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Orientation mode, station/tool profile, joint declaration and angles. Parent keys
 * it by revision so it starts from exactly what produced the stored revision.
 */
export function JointOrientationForm({ record, profilesData, disabled, busy, onReprocess }) {
  const isJoint = record.profile.id === JOINT_PROFILE_ID;
  const [mode, setMode] = useState(isJoint ? "joint" : "legacy");
  const [draft, setDraft] = useState(() => draftFromRecord(record));
  const [touched, setTouched] = useState(false);
  const limits = { ...DEFAULT_LIMITS, ...(profilesData.orientationLimits || {}) };
  const isArc = record.geometry.plannedType === "arc";
  const errors = mode === "joint" ? validateJointDraft(draft, seamOf(record), limits) : [];
  const set = (patch) => { setTouched(true); setDraft((d) => ({ ...d, ...patch })); };
  const setDeclared = (patch) => { setTouched(true); setDraft((d) => ({ ...d, declared: { ...d.declared, ...patch } })); };
  const num = (v) => (v === "" ? NaN : Number(v));
  const stations = profilesData.stationProfiles || [];
  const templates = profilesData.jointTemplates || {};
  const selected = stations.find((s) => s.id === draft.stationId);

  const legacyParameters = () => ({
    profileId: "fixed-base-quaternion",
    motion: record.parameters.motion,
    ...(record.parameters.calibrationReference ? { calibrationReference: record.parameters.calibrationReference } : {}),
  });
  const baseline = isJoint ? JSON.stringify(buildJointParameters(draftFromRecord(record), record)) : null;
  const changed = mode === "legacy" ? isJoint : !isJoint || JSON.stringify(buildJointParameters(draft, record)) !== baseline;

  const submit = () => onReprocess(mode === "legacy" ? legacyParameters() : buildJointParameters(draft, record));

  return (
    <Card title="Torch orientation mode" icon="explore">
      <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
        The seam file has no joint geometry. Joint-relative orientation needs a joint you declare here and a station/tool profile
        that says which tool axis is the torch axis. Changing anything creates a new revision; reviews and evidence do not carry over.
      </p>
      <fieldset disabled={disabled || busy} className="flex flex-col gap-3">
        <label className={labelCls}>Orientation mode
          <select aria-label="Orientation mode" value={mode} onChange={(e) => { setTouched(true); setMode(e.target.value); }} className={inputCls}>
            <option value="legacy">Legacy fixed base-frame quaternion</option>
            <option value="joint" disabled={isArc}>Joint-relative straight fillet (experimental){isArc ? " — straight seams only" : ""}</option>
          </select>
        </label>
        {isArc && <p className="text-[10px] text-on-surface-variant -mt-2">Curved joint-relative planning is not implemented; arcs keep the legacy profile.</p>}

        {mode === "joint" && (
          <>
            <label className={labelCls}>Station / tool profile
              <select aria-label="Station profile" value={draft.stationId} onChange={(e) => set({ stationId: e.target.value })} className={inputCls}>
                <option value="">Choose…</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.usableForJointRelative}>{s.label}{s.usableForJointRelative ? "" : " — blocked: tool convention unknown"}</option>
                ))}
                <option value="operator-declared">Operator-declared tool convention (not verified by this app)</option>
              </select>
            </label>
            {selected && (
              <p className="text-[10px] text-on-surface-variant -mt-2">
                {selected.description} Tool {selected.toolName} / work object {selected.wobjName}. Provenance: {selected.provenance}.
                {selected.provenance === "synthetic_fixture" ? " Ordinary download, save and RobotStudio launch will be blocked; the offline evidence package stays available." : ""}
              </p>
            )}
            {draft.stationId === "operator-declared" && (
              <div className="grid grid-cols-2 gap-2 border border-outline-variant/50 rounded p-2">
                <label className={labelCls}>Tool name<input aria-label="Declared tool name" value={draft.declared.toolName} onChange={(e) => setDeclared({ toolName: e.target.value })} className={inputCls} /></label>
                <label className={labelCls}>Work object<input aria-label="Declared work object" value={draft.declared.wobjName} onChange={(e) => setDeclared({ wobjName: e.target.value })} className={inputCls} /></label>
                <label className={labelCls}>Approach (torch) axis
                  <select aria-label="Declared approach axis" value={draft.declared.approachAxis} onChange={(e) => setDeclared({ approachAxis: e.target.value })} className={inputCls}>{AXES.map((a) => <option key={a}>{a}</option>)}</select>
                </label>
                <label className={labelCls}>Roll reference axis
                  <select aria-label="Declared roll axis" value={draft.declared.rollAxis} onChange={(e) => setDeclared({ rollAxis: e.target.value })} className={inputCls}>{AXES.map((a) => <option key={a}>{a}</option>)}</select>
                </label>
                <label className={`${labelCls} col-span-2`}>Roll axis points
                  <select aria-label="Declared roll reference" value={draft.declared.rollReference} onChange={(e) => setDeclared({ rollReference: e.target.value })} className={inputCls}>
                    <option value="travel">Along travel (projected perpendicular to the torch axis)</option>
                    <option value="against_travel">Against travel</option>
                  </select>
                </label>
                <label className={`${labelCls} col-span-2`}>Where does this convention come from? (required)
                  <input aria-label="Declaration note" maxLength={300} value={draft.declared.note} onChange={(e) => setDeclared({ note: e.target.value })} className={inputCls} />
                </label>
                <label className={`${labelCls} col-span-2`}>External evidence reference (optional, operator-reported)
                  <input aria-label="Evidence reference" maxLength={300} value={draft.declared.evidenceReference} onChange={(e) => setDeclared({ evidenceReference: e.target.value })} className={inputCls} />
                </label>
              </div>
            )}

            <label className={labelCls}>Joint declaration
              <select aria-label="Joint declaration kind" value={draft.jointKind} onChange={(e) => set({ jointKind: e.target.value })} className={inputCls}>
                <option value="template">Template (90° fillet, relative to the seam)</option>
                <option value="explicit_normals">Explicit plate normals (pointing into the open weld side)</option>
                <option value="explicit_frame">Explicit right-handed joint frame (Z = open-side bisector)</option>
              </select>
            </label>
            {draft.jointKind === "template" && (
              <>
                <label className={labelCls}>Template
                  <select aria-label="Joint template" value={draft.template} onChange={(e) => set({ template: e.target.value })} className={inputCls}>
                    {Object.entries(templates).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
                <VectorInput label="Floor reference normal (base frame)" value={draft.referenceNormal} onChange={(v) => set({ referenceNormal: v })} />
                <p className="text-[10px] text-on-surface-variant -mt-2">The floor normal is this reference made perpendicular to the seam; the wall is on the chosen side of travel.</p>
              </>
            )}
            {draft.jointKind === "explicit_normals" && (
              <>
                <VectorInput label="Plate A normal" value={draft.normalA} onChange={(v) => set({ normalA: v })} />
                <VectorInput label="Plate B normal" value={draft.normalB} onChange={(v) => set({ normalB: v })} />
              </>
            )}
            {draft.jointKind === "explicit_frame" && (
              <>
                <VectorInput label="Frame X axis" value={draft.xAxis} onChange={(v) => set({ xAxis: v })} />
                <VectorInput label="Frame Y axis" value={draft.yAxis} onChange={(v) => set({ yAxis: v })} />
                <VectorInput label="Frame Z axis" value={draft.zAxis} onChange={(v) => set({ zAxis: v })} />
                <p className="text-[10px] text-on-surface-variant -mt-2">Plate A normal = unit(Z + Y), plate B normal = unit(Z − Y).</p>
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>Work angle (°, {limits.workAngleDeg[0]}–{limits.workAngleDeg[1]})
                <input type="number" step="any" aria-label="Work angle" value={Number.isFinite(draft.workAngleDeg) ? draft.workAngleDeg : ""} onChange={(e) => set({ workAngleDeg: num(e.target.value) })} className={inputCls} />
              </label>
              <label className={labelCls}>Push angle (°, {limits.pushAngleDeg[0]}–{limits.pushAngleDeg[1]}; negative = drag)
                <input type="number" step="any" aria-label="Push angle" value={Number.isFinite(draft.pushAngleDeg) ? draft.pushAngleDeg : ""} onChange={(e) => set({ pushAngleDeg: num(e.target.value) })} className={inputCls} />
              </label>
            </div>
          </>
        )}

        {touched && errors.length > 0 && (
          <ul className="text-[11px] text-red-800 bg-red-50 border border-red-300 rounded p-2 list-disc pl-5" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        <button type="button" onClick={submit} disabled={!changed || errors.length > 0} className="bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-1.5">
          <Icon name={busy ? "progress_activity" : "refresh"} className={`text-[16px] ${busy ? "animate-spin" : ""}`} />
          {changed ? `Apply orientation as revision ${record.revision + 1}` : "No orientation changes"}
        </button>
      </fieldset>
    </Card>
  );
}
