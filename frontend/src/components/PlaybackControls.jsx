"use client";

import React, { useEffect, useMemo, useState } from "react";
import { SPEEDS, buildTimeline, sampleTimeline } from "@/lib/playback";
import { Icon } from "./StatusPanels";

/** 10 Hz UI snapshot of the playback clock (the clock itself is not advanced here). */
export function usePlaybackSnapshot(clock) {
  const [snap, setSnap] = useState(() => clock.snapshot());
  useEffect(() => {
    const id = setInterval(() => setSnap(clock.snapshot()), 100);
    return () => clearInterval(id);
  }, [clock]);
  return snap;
}

const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export default function PlaybackControls({ clock, record, showToolAxes, onToggleToolAxes }) {
  const snap = usePlaybackSnapshot(clock);
  const timeline = useMemo(() => (record ? buildTimeline(record.path, record.geometry.arc, snap.durationS) : null), [record, snap.durationS]);
  const sample = timeline ? sampleTimeline(timeline, snap.time) : null;

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-3 shadow-2xl text-slate-200">
      <button type="button" onClick={() => (snap.playing ? clock.pause() : clock.play())} className="p-1.5 rounded-full hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400" aria-label={snap.playing ? "Pause preview" : snap.ended ? "Play preview from start" : "Play preview"}>
        <Icon name={snap.playing ? "pause" : "play_arrow"} className="text-[26px]" />
      </button>
      <button type="button" onClick={() => clock.replay()} className="p-1.5 rounded-full hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400" aria-label="Replay preview">
        <Icon name="replay" className="text-[22px]" />
      </button>
      <label className="flex items-center gap-2 text-[11px]">
        <span className="sr-only">Seek</span>
        <input
          type="range"
          min={0}
          max={snap.durationS}
          step={0.05}
          value={snap.time}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-valuetext={`${fmt(snap.time)} of ${fmt(snap.durationS)}`}
          className="w-48 accent-sky-400"
        />
      </label>
      <span className="font-mono text-[11px] min-w-[120px]">{fmt(snap.time)} / {fmt(snap.durationS)}</span>
      <label className="flex items-center gap-1 text-[11px]">
        Speed
        <select value={snap.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))} className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
      {onToggleToolAxes && (
        <label className="flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={showToolAxes} onChange={(e) => onToggleToolAxes(e.target.checked)} />
          Tool axes
        </label>
      )}
      {sample && (
        <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/30">
          {sample.phaseLabel}{snap.playing && sample.inWeld ? " · effects on" : ""}
        </span>
      )}
      <span className="text-[10px] text-slate-400 basis-full">
        Preview duration is a fixed browser-animation length, not a cycle time. Linear/slerp interpolation between targets does not reproduce MoveJ joint motion, zone blending or controller orientation interpolation. Sparks are shown only while playing along the weld path.
      </span>
    </div>
  );
}
