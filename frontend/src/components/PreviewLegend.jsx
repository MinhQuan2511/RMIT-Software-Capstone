"use client";

import React from "react";
import { StateBadge } from "./StatusPanels";
import { SEGMENT_COLOR, PLATE_COLOR, FINDING_COLOR, ENVELOPE_COLOR, TARGET_COLOR } from "./weldScene";
import { CONNECTOR_LABEL, segmentRows, workpieceMode } from "@/lib/clearanceView";

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;
const Swatch = ({ color, dashed = false, round = false }) => (
  <span aria-hidden="true" className={`inline-block shrink-0 ${round ? "w-2.5 h-2.5 rounded-full" : "w-5 h-0 border-t-[3px]"}`} style={round ? { background: hex(color) } : { borderColor: hex(color), borderTopStyle: dashed ? "dashed" : "solid" }} />
);

/** Legend for the 3D preview. Colours are never the only cue: every entry has text. */
export function PreviewLegend({ record }) {
  const wp = workpieceMode(record);
  const envelope = record.toolEnvelope && record.toolEnvelope.definition && record.toolEnvelope.definition.kind === "tool_frame_capsules";
  const items = [
    [<Swatch key="w" color={SEGMENT_COLOR.weld} />, "Weld (MoveL, stored targets)"],
    [<Swatch key="a" color={SEGMENT_COLOR.approach} />, "Approach (linear TCP path)"],
    [<Swatch key="r" color={SEGMENT_COLOR.retract} />, "Retract (linear TCP path)"],
    [<Swatch key="t" color={SEGMENT_COLOR.air} />, "Transfer (linear TCP path)"],
    [<Swatch key="s" color={SEGMENT_COLOR.air} dashed />, "Dashed = schematic joint-space connector (MoveJ): real path unknown, not assessed"],
    [<Swatch key="z" color={0x94a3b8} round />, "Wire sphere = fly-by zone: corner path not reconstructed"],
    [<Swatch key="ws" color={TARGET_COLOR.weld_start} round />, "Weld start / end (green / red); approach yellow; retract purple; standby cyan"],
    ...(wp.mode !== "unavailable" ? [[<Swatch key="p" color={PLATE_COLOR.plateA} round />, `Plate A (darker) and plate B — ${wp.label}`]] : []),
    [<Swatch key="fi" color={FINDING_COLOR.intersection_detected} round />, "Red marker = intersection finding; amber = inconclusive"],
    ...(envelope ? [[<Swatch key="e" color={ENVELOPE_COLOR} round />, "Magenta wireframe = declared torch envelope (tool frame)"]] : []),
    [<span key="d" aria-hidden="true" className="inline-block w-2.5 h-2.5 bg-amber-600 shrink-0" />, "Orange/grey torch = decorative mesh only, never used for checks"],
  ];
  return (
    <ul className="grid grid-cols-1 gap-0.5 text-[10px] text-slate-200" aria-label="3D preview legend">
      {items.map(([sw, text]) => <li key={text} className="flex items-center gap-2">{sw}<span>{text}</span></li>)}
    </ul>
  );
}

/** Stored segments with identifiers, instructions and stored clearance results; selecting one highlights it in 3D. */
export function SegmentList({ record, selected, onSelect }) {
  const rows = segmentRows(record);
  const current = rows.find((r) => r.index === selected) || null;
  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <ul className="flex flex-col gap-1" aria-label="Stored motion segments">
        {rows.map((r) => (
          <li key={r.index}>
            <button type="button" aria-pressed={selected === r.index} onClick={() => onSelect(selected === r.index ? null : r.index)}
              className={`w-full text-left border rounded px-2 py-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${selected === r.index ? "border-sky-500 bg-sky-50" : "border-outline-variant/50 bg-surface"}`}>
              <span className="font-mono font-bold">{r.id}</span>
              <span className="font-mono">{r.instruction}</span>
              <span>{r.roleLabel}</span>
              <span className="font-mono text-[10px]">{r.from || "(program start)"} → {r.to}</span>
              <span className="font-mono text-[10px] text-on-surface-variant">{r.speed} · {r.zone}</span>
              <span className="ml-auto flex gap-1"><StateBadge value={r.tcpPath} compact /></span>
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border border-sky-300 rounded p-2 bg-sky-50/50" aria-live="polite">
          <dt className="font-bold">Segment</dt><dd className="font-mono">{current.id} · {current.instruction} {current.from || "(start)"} → {current.to}{current.via ? ` via ${current.via}` : ""}</dd>
          <dt className="font-bold">Drawn as</dt><dd>{CONNECTOR_LABEL[current.connector]}</dd>
          <dt className="font-bold">TCP path</dt><dd><StateBadge value={current.tcpPath} /> <StateBadge value={current.tcpCoverage} compact /></dd>
          <dt className="font-bold">Torch envelope</dt><dd><StateBadge value={current.toolEnvelope} /></dd>
          {current.reason && <><dt className="font-bold">Reason</dt><dd className="font-mono text-[10px]">{current.reason}</dd></>}
          {current.findings.length > 0 && <><dt className="font-bold">Findings</dt><dd>{current.findings.map((f) => `${f.id} ${f.part} ${f.result}`).join("; ")}</dd></>}
        </dl>
      )}
    </div>
  );
}
