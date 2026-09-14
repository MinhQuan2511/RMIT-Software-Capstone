"use client";

import React, { useMemo } from "react";
import { buildScene25d, polylineToPath, ROLE_STYLE, TARGET_STYLE, SVG } from "@/lib/projection25d";

function Shape({ shape, x, y, r, fill }) {
  const common = { fill, stroke: "#ffffff", strokeWidth: 1.5 };
  if (shape === "square") return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} {...common} />;
  if (shape === "diamond") return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} {...common} />;
  if (shape === "triangle") return <polygon points={`${x},${y - r - 2} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
}

const MARKERS = [
  ["arrowGrey", "#64748b"], ["arrowYellow", "#eab308"], ["arrowCyan", "#22d3ee"], ["arrowPurple", "#a855f7"],
];

/** 2.5D isometric view of the canonical revision. */
export default function Toolpath25D({ record }) {
  const scene = useMemo(() => buildScene25d(record), [record]);
  if (!scene) {
    return <p className="text-xs text-on-surface-variant italic p-6">No geometry to draw for the current selection.</p>;
  }
  const arc = record.geometry.arc;
  const roles = [...new Set(scene.segments.map((s) => s.role))];
  const types = [...new Set(scene.points.map((p) => p.type))];

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${SVG.W} ${SVG.H}`} className="w-full bg-surface-container-lowest/60 rounded-lg border border-outline-variant/30" style={{ height: "330px" }} role="img" aria-labelledby="tp-title tp-desc">
        <title id="tp-title">Isometric toolpath projection</title>
        <desc id="tp-desc">{`${scene.points.length} targets and ${scene.segments.length} motion segments of revision ${record.revision}. ${arc ? "The weld path is a circular arc drawn from the fitted circle." : "The weld path is a straight line."}`}</desc>
        <defs>
          <filter id="cyanGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {MARKERS.map(([id, color]) => (
            <marker key={id} id={id} markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto" markerUnits="strokeWidth">
              <polygon points="0 0, 7 2.5, 0 5" fill={color} />
            </marker>
          ))}
        </defs>

        {scene.seamBand && (
          <path d={polylineToPath(scene.seamBand.polyline)} fill="none" stroke="#22d3ee" strokeWidth={scene.seamBand.strokePx} strokeLinecap="round" strokeLinejoin="round" opacity="0.12" />
        )}

        {scene.segments.map((seg) => (
          <path
            key={seg.index}
            d={polylineToPath(seg.polyline)}
            fill="none"
            stroke={seg.style.color}
            strokeWidth={seg.style.width}
            strokeDasharray={seg.style.dash || undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd={`url(#${seg.style.marker})`}
            filter={seg.style.glow ? "url(#cyanGlow)" : undefined}
          >
            <title>{`${seg.instruction} ${seg.from} → ${seg.to}${seg.via ? ` via ${seg.via}` : ""} (${ROLE_STYLE[seg.role].label})`}</title>
          </path>
        ))}

        {scene.labels.map((l) => {
          const style = TARGET_STYLE[l.type] || TARGET_STYLE.point;
          return (
            <g key={`label-${l.name}`}>
              <line x1={l.anchorX} y1={l.anchorY} x2={l.x} y2={l.y} stroke={style.fill} strokeWidth="1" strokeDasharray="2,2" opacity="0.7" />
              <rect x={l.x - l.w / 2} y={l.y - l.h / 2} width={l.w} height={l.h} rx={l.h / 2} fill="#0f172a" fillOpacity="0.9" stroke={style.fill} strokeWidth="1" />
              <text x={l.x} y={l.y + 3.5} textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontFamily="JetBrains Mono, monospace" fontWeight="bold">{l.text}</text>
            </g>
          );
        })}

        {scene.points.map((p) => {
          const style = TARGET_STYLE[p.type] || TARGET_STYLE.point;
          return (
            <g key={`pt-${p.name}`}>
              <Shape shape={style.shape} x={p.x} y={p.y} r={p.type === "home" ? 6 : 5} fill={style.fill} />
              <title>{`${p.name}: [${p.pos.map((v) => v.toFixed(3)).join(", ")}] mm`}</title>
            </g>
          );
        })}

        <g transform={`translate(${SVG.PAD_X - 55}, ${SVG.H - 22})`} aria-hidden="true">
          <line x1="0" y1="0" x2="22" y2="0" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="0" y1="0" x2="0" y2="-22" stroke="#22d3ee" strokeWidth="1.5" />
          <line x1="0" y1="0" x2="12" y2="-10" stroke="#a3e635" strokeWidth="1.5" />
          <text x="26" y="3" fill="#ef4444" fontSize="8" fontFamily="monospace">X</text>
          <text x="-2" y="-26" fill="#22d3ee" fontSize="8" fontFamily="monospace">Z</text>
          <text x="14" y="-12" fill="#65a30d" fontSize="8" fontFamily="monospace">Y</text>
        </g>
      </svg>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-on-surface-variant" aria-label="Legend">
        {roles.map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <svg width="26" height="6" aria-hidden="true"><line x1="0" y1="3" x2="26" y2="3" stroke={ROLE_STYLE[r].color} strokeWidth={Math.min(ROLE_STYLE[r].width, 3)} strokeDasharray={ROLE_STYLE[r].dash || undefined} /></svg>
            {ROLE_STYLE[r].label}
          </li>
        ))}
        {types.map((t) => (
          <li key={t} className="flex items-center gap-1.5">
            <svg width="12" height="12" aria-hidden="true"><Shape shape={(TARGET_STYLE[t] || TARGET_STYLE.point).shape} x={6} y={6} r={4} fill={(TARGET_STYLE[t] || TARGET_STYLE.point).fill} /></svg>
            {(TARGET_STYLE[t] || { label: t }).label}
          </li>
        ))}
      </ul>
      {scene.seamBand && <p className="text-[10px] text-on-surface-variant">{scene.seamBand.note} Physical seam width: {scene.seamBand.physicalWidthMm} mm (display only; it does not affect motion).</p>}
    </div>
  );
}
