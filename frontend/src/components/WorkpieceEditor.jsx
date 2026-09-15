"use client";

import React, { useMemo, useState } from "react";
import { Card, Icon } from "./StatusPanels";
import { JOINT_PROFILE_ID } from "@/lib/jointInput";
import {
  DEFAULT_DIMENSIONS, definitionsFromDraft, draftFromParameters, measuredSeam, requestParametersFromRecord,
  reverseTraversal, switchWeldingSide, validateWorkpieceDraft,
} from "@/lib/workpieceInput";

const inputCls = "font-mono text-xs bg-surface-container-highest border border-outline-variant rounded px-2 py-1.5";
const labelCls = "text-[10px] font-bold text-on-surface-variant flex flex-col gap-1";
const num = (v) => (v === "" ? NaN : Number(v));
const vec = (v) => (Array.isArray(v) ? `[${v.map((c) => (Number.isFinite(c) ? c.toFixed(4) : "—")).join(", ")}]` : "—");

function Triple({ label, value, onChange }) {
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
 * Workpiece declaration, tool envelope and traversal for the current revision.
 * Every change is sent to the backend as a new revision, which validates it,
 * derives the plates and reruns the clearance checks. Parent keys it by revision.
 */
export default function WorkpieceEditor({ record, profilesData, disabled, busy, onReprocess }) {
  const seam = measuredSeam(record);
  const base = useMemo(() => requestParametersFromRecord(record), [record]);
  const [draft, setDraft] = useState(() => draftFromParameters(record.parameters, seam));
  const [jointFromWorkpiece, setJointFromWorkpiece] = useState(() => !!(record.parameters.joint && record.parameters.joint.kind === "workpiece"));
  const [touched, setTouched] = useState(false);
  if (!base) return null;
  const isJoint = record.profile.id === JOINT_PROFILE_ID;
  const synthetic = profilesData && profilesData.toolEnvelope ? profilesData.toolEnvelope.syntheticZApproach : null;
  const errors = validateWorkpieceDraft(draft, seam);
  const set = (patch) => { setTouched(true); setDraft((d) => ({ ...d, ...patch })); };
  const setDim = (k, v) => set({ dims: { ...draft.dims, [k]: num(v) } });
  const preview = errors.length === 0 && (draft.mode === "unknown" || seam) ? definitionsFromDraft(draft, seam, synthetic) : null;
  const traversal = record.parameters.traversal || "as_measured";

  const buildParameters = () => {
    const next = { ...base, workpiece: preview.workpiece, toolEnvelope: preview.toolEnvelope };
    if (isJoint) {
      if (draft.mode !== "unknown" && jointFromWorkpiece) next.joint = { kind: "workpiece" };
      else if (next.joint && next.joint.kind === "workpiece") next.joint = { kind: "template", template: "fillet90_wall_left", referenceNormal: [0, 0, 1] };
    }
    return next;
  };
  const changed = preview ? JSON.stringify(buildParameters()) !== JSON.stringify(base) : false;
  const reversed = reverseTraversal(base);
  const setCapsule = (i, patch) => set({ capsules: draft.capsules.map((c, k) => (k === i ? { ...c, ...patch } : c)) });

  return (
    <Card title="Workpiece geometry and torch envelope" icon="deployed_code">
      <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
        Supported: finite straight 90° fillet joints of two plates (tee or corner). Butt, lap, non-90°, curved joints and imported CAD are
        not implemented. The seam file carries no plates: this is a declaration. Changes create a new revision; reviews and clearance
        evidence do not carry over.{record.profile.id !== JOINT_PROFILE_ID ? " Legacy fixed orientation: the torch attitude is not derived from this workpiece." : ""}
      </p>
      <fieldset disabled={disabled || busy} className="flex flex-col gap-3">
        <label className={labelCls}>Workpiece
          <select aria-label="Workpiece mode" value={draft.mode} onChange={(e) => set({ mode: e.target.value })} className={inputCls}>
            <option value="unknown">Workpiece geometry unavailable (seam-only)</option>
            <option value="illustrative" disabled={!seam}>Illustrative geometry (never assesses the real part)</option>
            <option value="operator_defined" disabled={!seam}>Operator-defined geometry (declared dimensions)</option>
          </select>
        </label>
        {!seam && <p className="text-[10px] text-on-surface-variant -mt-2">Plates can only be declared for a straight seam; this revision stays in seam-only mode.</p>}

        {draft.mode !== "unknown" && seam && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <label className={labelCls}>Arrangement
                <select aria-label="Arrangement" value={draft.arrangement} onChange={(e) => set({ arrangement: e.target.value })} className={inputCls}>
                  <option value="tee">Tee (plate A continues behind plate B)</option>
                  <option value="corner">Corner / L (plate A ends at plate B)</option>
                </select>
              </label>
              <label className={labelCls}>Wall (plate B) side of the measured travel
                <select aria-label="Welding side" value={draft.side} onChange={(e) => set({ side: e.target.value })} className={inputCls}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
            <button type="button" onClick={() => { setTouched(true); setDraft(switchWeldingSide(draft)); }} className="self-start border border-outline-variant rounded px-2 py-1 text-[11px] font-bold flex items-center gap-1">
              <Icon name="flip" className="text-[15px]" />Switch welding side (mirror the wall across the seam)
            </button>
            <Triple label="Floor (plate A) reference normal" value={draft.reference} onChange={(v) => set({ reference: v })} />
            <div className="grid grid-cols-3 gap-2">
              {[["tA", "Plate A thickness"], ["wA", "Plate A open-side width"], ["tB", "Plate B thickness"], ["hB", "Plate B open-side height"], ...(draft.arrangement === "tee" ? [["overhang", "Tee overhang behind B"]] : []), ["margin", "Extent past seam ends"]].map(([k, label]) => (
                <label key={k} className={labelCls}>{label} (mm)
                  <input type="number" step="any" aria-label={label} value={Number.isFinite(draft.dims[k]) ? draft.dims[k] : ""} onChange={(e) => setDim(k, e.target.value)} className={inputCls} />
                </label>
              ))}
            </div>
            <label className={labelCls}>Note (optional)
              <input aria-label="Workpiece note" maxLength={300} value={draft.note} onChange={(e) => set({ note: e.target.value })} className={inputCls} />
            </label>
            {isJoint && (
              <label className="text-[11px] flex items-start gap-2">
                <input type="checkbox" checked={jointFromWorkpiece} onChange={(e) => { setTouched(true); setJointFromWorkpiece(e.target.checked); }} className="mt-0.5" />
                <span>Take the joint plate normals from this workpiece (recommended: reversing travel then never moves the wall). Otherwise the declared joint must agree with the plates within 0.1°.</span>
              </label>
            )}
            {preview && preview.workpiece.kind === "fillet90_plates" && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono bg-surface-container-highest rounded p-2" aria-label="Explicit definition to be sent">
                <dt>origin</dt><dd>{vec(preview.workpiece.origin)}</dd>
                <dt>normal A</dt><dd>{vec(preview.workpiece.normalA)}</dd>
                <dt>normal B</dt><dd>{vec(preview.workpiece.normalB)}</dd>
                <dt>extent</dt><dd>{vec(preview.workpiece.extentAlongAxisMm)} mm along A×B</dd>
              </dl>
            )}
          </>
        )}

        <label className={labelCls}>Torch envelope (clearance of the nozzle and body)
          <select aria-label="Envelope mode" value={draft.envelopeMode} onChange={(e) => set({ envelopeMode: e.target.value, capsules: e.target.value === "operator_defined" && draft.capsules.length === 0 && synthetic ? synthetic.capsules.map((c) => ({ ...c, fromToolMm: c.fromToolMm.slice(), toToolMm: c.toToolMm.slice() })) : draft.capsules })} className={inputCls}>
            <option value="unknown">Unknown — torch body not assessed</option>
            <option value="synthetic_fixture" disabled={!synthetic}>SYNTHETIC capsules along tool −Z (invented dimensions)</option>
            <option value="operator_defined">Operator-defined capsules in the tool frame</option>
          </select>
        </label>
        {draft.envelopeMode === "operator_defined" && (
          <div className="flex flex-col gap-2 border border-outline-variant/50 rounded p-2">
            {draft.capsules.map((c, i) => (
              <div key={i} className="flex flex-col gap-1 border-b border-outline-variant/30 pb-2 last:border-0">
                <div className="flex items-center gap-2">
                  <input aria-label={`Capsule ${i + 1} id`} value={c.id} onChange={(e) => setCapsule(i, { id: e.target.value })} className={`${inputCls} w-24`} />
                  <label className="text-[10px] flex items-center gap-1">radius (mm)<input type="number" step="any" aria-label={`Capsule ${i + 1} radius`} value={Number.isFinite(c.radiusMm) ? c.radiusMm : ""} onChange={(e) => setCapsule(i, { radiusMm: num(e.target.value) })} className={`${inputCls} w-20`} /></label>
                  <button type="button" onClick={() => set({ capsules: draft.capsules.filter((_, k) => k !== i) })} className="ml-auto text-[10px] underline">Remove</button>
                </div>
                <Triple label={`Capsule ${i + 1} from (tool frame, mm)`} value={c.fromToolMm} onChange={(v) => setCapsule(i, { fromToolMm: v })} />
                <Triple label={`Capsule ${i + 1} to (tool frame, mm)`} value={c.toToolMm} onChange={(v) => setCapsule(i, { toToolMm: v })} />
              </div>
            ))}
            <button type="button" disabled={draft.capsules.length >= 8} onClick={() => set({ capsules: [...draft.capsules, { id: `c${draft.capsules.length + 1}`, fromToolMm: [0, 0, -20], toToolMm: [0, 0, -120], radiusMm: 10 }] })} className="self-start text-[11px] underline">Add capsule</button>
            <p className="text-[10px] text-on-surface-variant">Offsets are relative to the TCP in the tool frame, so the nozzle is not centred on the wire tip. Unknown physical dimensions cannot support a real clearance claim.</p>
          </div>
        )}

        {touched && errors.length > 0 && (
          <ul className="text-[11px] text-red-800 bg-red-50 border border-red-300 rounded p-2 list-disc pl-5" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        <button type="button" onClick={() => onReprocess(buildParameters())} disabled={!changed || errors.length > 0} className="bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-1.5">
          <Icon name={busy ? "progress_activity" : "refresh"} className={`text-[16px] ${busy ? "animate-spin" : ""}`} />
          {changed ? `Apply geometry as revision ${record.revision + 1}` : "No geometry changes"}
        </button>

        <div className="border-t border-outline-variant/40 pt-2 flex flex-col gap-1">
          <p className="text-[11px]">Traversal: <span className="font-bold">{traversal === "reversed" ? "reversed (measured end → measured start)" : "as measured (start → end)"}</span></p>
          <button type="button" disabled={record.geometry.plannedType !== "straight"} onClick={() => onReprocess(reversed.parameters)} className="self-start border border-outline-variant rounded px-2 py-1 text-[11px] font-bold flex items-center gap-1 disabled:opacity-40">
            <Icon name="swap_horiz" className="text-[15px]" />Reverse travel (plates and welding side stay put)
          </button>
          {reversed.templateRemapped && <p className="text-[10px] text-on-surface-variant">The joint template is relative to travel, so its side is remapped ({base.joint.template} → {reversed.parameters.joint.template}) to keep the wall physically in place.</p>}
        </div>
        <p className="text-[10px] text-on-surface-variant">Defaults: plate A {DEFAULT_DIMENSIONS.tA} × {DEFAULT_DIMENSIONS.wA} mm, plate B {DEFAULT_DIMENSIONS.tB} × {DEFAULT_DIMENSIONS.hB} mm. Approach/retract stand-offs are edited in the motion profile card.</p>
      </fieldset>
    </Card>
  );
}
