"use client";

import React, { useEffect, useState } from "react";
import { api } from "@/services/apiClient";
import { Card, Icon, InlineError } from "@/components/StatusPanels";
import CalibrationImport from "@/components/CalibrationImport";

const STEPS = [
  "Obtain approval to operate the cell and follow its commissioning procedure; this page does not authorise motion.",
  "Open the archived station in RobotStudio and confirm it matches your robot, tool and calibration target setup.",
  "Check the tooldata tWeldGun in CalibData against your physical torch calibration before any use.",
  "Run the routine only in simulation first. At each 3 s dwell, capture an image with your camera software.",
  "Record each capture together with the robot pose read from the controller or RobotStudio.",
  "Solve the hand-eye transform and its error in your calibration software, and keep that evidence with the job.",
];

export default function CalibrationRoutinePage() {
  const [info, setInfo] = useState({ data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const [done, setDone] = useState({});

  useEffect(() => {
    let cancelled = false;
    api.calibrationRoutine().then((d) => { if (!cancelled) setInfo({ data: d, error: null }); }).catch((err) => { if (!cancelled) setInfo({ data: null, error: err }); });
    return () => { cancelled = true; };
  }, [nonce]);

  const d = info.data;

  return (
    <div className="flex-1 overflow-y-auto bg-background p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-5">
        <header>
          <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Tool · independent of the workflow</p>
          <h1 className="text-2xl font-extrabold text-on-surface">Calibration pose routine (archived station)</h1>
          <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
            A pre-existing, station-specific RobotStudio Pack&amp;Go that moves the robot through a set of poses with dwell times,
            for operator-assisted camera calibration. This application does not generate the routine, capture images, read robot
            poses, solve a hand-eye transform or compute calibration error.
          </p>
        </header>

        <CalibrationImport />

        {info.error && <InlineError error={info.error} onRetry={() => setNonce((n) => n + 1)} />}
        {!info.error && !d && <p className="text-xs text-on-surface-variant">Reading the archive…</p>}

        {d && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Facts read from the archive" icon="inventory">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="font-bold text-on-surface-variant">Robtargets declared</dt><dd>{d.routine.robtargetCount} (home + {d.routine.nonHomePoseCount} poses)</dd>
                <dt className="font-bold text-on-surface-variant">Motion statements</dt><dd>{d.routine.motionStatementCount} ({Object.entries(d.routine.motionInstructions).map(([k, v]) => `${v}× ${k}`).join(", ")})</dd>
                <dt className="font-bold text-on-surface-variant">Distinct destinations</dt><dd>{d.routine.distinctDestinations}{d.routine.repeatedDestinations.length ? ` · repeated: ${d.routine.repeatedDestinations.map((r) => `${r.target} ×${r.visits}`).join(", ")}` : ""}</dd>
                <dt className="font-bold text-on-surface-variant">Dwell statements</dt><dd>{d.routine.waitStatementCount} × WaitTime {d.routine.waitSeconds.join("/")} s = {d.routine.programmedDwellSeconds} s programmed dwell</dd>
                <dt className="font-bold text-on-surface-variant">Tool / work object</dt><dd className="font-mono">{d.routine.tools.join(", ")} / {d.routine.workObjects.join(", ")}</dd>
                <dt className="font-bold text-on-surface-variant">Speeds</dt><dd className="font-mono">{d.routine.speeds.join(", ")}</dd>
                <dt className="font-bold text-on-surface-variant">Configurations used</dt><dd className="font-mono">{d.routine.configurationsUsed.join(" ")}</dd>
                <dt className="font-bold text-on-surface-variant">Archive</dt><dd className="font-mono break-all">{d.archive.fileName} · {(d.archive.sizeBytes / 1024).toFixed(1)} KB · SHA-256 {d.archive.sha256.slice(0, 16)}…</dd>
              </dl>
              <p className="text-[11px] text-on-surface-variant mt-2">{d.routine.dwellNote}</p>
            </Card>

            <Card title="Tool data stored in the archive" icon="build">
              {d.tooldata ? (
                <>
                  <p className="text-[12px] font-mono">PERS tooldata {d.tooldata.name}: TCP [{d.tooldata.translationMm.join(", ")}] mm · orientation [{d.tooldata.orientation.join(", ")}] · mass {d.tooldata.massKg} kg</p>
                  <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-300 rounded p-2 mt-2">{d.tooldata.note}</p>
                </>
              ) : <p className="text-xs">No tooldata found.</p>}
              <div className="mt-4 border-t border-outline-variant/40 pt-3">
                <p className="text-[11px] text-on-surface-variant mb-2">{d.archive.sensitiveNote}</p>
                <a href="/stations/auto_calib.rspag" download className="inline-flex items-center gap-2 bg-primary text-on-primary rounded-lg px-3 py-2 text-xs font-bold uppercase">
                  <Icon name="download" className="text-[16px]" />Download the archived station
                </a>
              </div>
            </Card>

            <Card title="Programmed sequence (PROC main)" icon="format_list_numbered" className="lg:col-span-2">
              <div className="overflow-x-auto max-h-[320px]">
                <table className="w-full text-[11px] font-mono">
                  <thead><tr className="text-left text-on-surface-variant border-b border-outline-variant/40"><th scope="col" className="pr-3">#</th><th scope="col" className="pr-3">Statement</th><th scope="col" className="pr-3">Target / seconds</th><th scope="col">Speed · zone</th></tr></thead>
                  <tbody>
                    {d.routine.steps.map((s) => (
                      <tr key={s.index} className="border-b border-outline-variant/15">
                        <td className="pr-3">{s.index}</td>
                        <td className="pr-3">{s.kind === "move" ? s.instruction : s.kind === "wait" ? "WaitTime" : "other"}</td>
                        <td className="pr-3">{s.kind === "move" ? s.target : s.kind === "wait" ? `${s.seconds} s` : s.text}</td>
                        <td>{s.kind === "move" ? `${s.speed} · ${s.zone}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Operator checklist (this page only; not saved)" icon="checklist" className="lg:col-span-2">
              <ol className="flex flex-col gap-2">
                {STEPS.map((s, i) => (
                  <li key={s}>
                    <label className="flex items-start gap-2 text-[12px]">
                      <input type="checkbox" checked={!!done[i]} onChange={(e) => setDone((x) => ({ ...x, [i]: e.target.checked }))} className="mt-0.5" />
                      <span>{i + 1}. {s}</span>
                    </label>
                  </li>
                ))}
              </ol>
              <p className="text-[11px] text-on-surface-variant mt-3">Automatic capture, pose readback, hand-eye solving and error measurement are not implemented. External calibration evidence produced elsewhere remains valid evidence; it simply is not produced by this application.</p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
