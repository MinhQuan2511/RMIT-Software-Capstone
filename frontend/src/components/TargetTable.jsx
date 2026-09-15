"use client";

import React from "react";
import { TARGET_STYLE } from "@/lib/projection25d";

const fmt = (n, dp) => (Number.isFinite(n) ? n.toFixed(dp) : "—");

/** Canonical waypoint table. Also the non-WebGL fallback for the 3D view. */
export default function TargetTable({ record, compact = false, caption = "Targets of the current revision (robot base frame, mm)" }) {
  if (!record) return null;
  const into = new Map();
  for (const s of record.path.segments) {
    into.set(s.to, `${s.instruction}${s.from ? "" : " (from current position)"} · ${s.speed} · ${s.zone}`);
    if (s.via) into.set(s.via, `MoveC via (consumed by move to ${s.to})`);
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] font-mono border-collapse">
        <caption className="text-left text-[10px] font-sans font-bold text-on-surface-variant uppercase tracking-wider pb-1.5">{caption}</caption>
        <thead>
          <tr className="border-b border-outline-variant/40 text-on-surface-variant">
            <th scope="col" className="text-left py-1 pr-2">#</th>
            <th scope="col" className="text-left py-1 pr-2">Name</th>
            <th scope="col" className="text-left py-1 pr-2">Role</th>
            <th scope="col" className="text-right py-1 pr-2">X</th>
            <th scope="col" className="text-right py-1 pr-2">Y</th>
            <th scope="col" className="text-right py-1 pr-2">Z</th>
            {!compact && <th scope="col" className="text-left py-1 pr-2">Orientation q1–q4 [w,x,y,z]</th>}
            <th scope="col" className="text-left py-1">Motion into target</th>
          </tr>
        </thead>
        <tbody>
          {record.path.waypoints.map((w, i) => (
            <tr key={w.name} className="border-b border-outline-variant/15 align-top">
              <td className="py-1 pr-2">{i + 1}</td>
              <th scope="row" className="py-1 pr-2 text-left font-bold text-on-surface">{w.name}</th>
              <td className="py-1 pr-2 font-sans">{(TARGET_STYLE[w.type] || { label: w.type }).label}</td>
              <td className="py-1 pr-2 text-right">{fmt(w.pos[0], 3)}</td>
              <td className="py-1 pr-2 text-right">{fmt(w.pos[1], 3)}</td>
              <td className="py-1 pr-2 text-right">{fmt(w.pos[2], 3)}</td>
              {!compact && <td className="py-1 pr-2 whitespace-nowrap">[{w.orient.map((q) => fmt(q, 6)).join(", ")}]</td>}
              <td className="py-1 font-sans">{into.get(w.name) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
