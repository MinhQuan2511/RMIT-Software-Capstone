"use client";

import React from "react";
import Link from "next/link";
import { useBackendHealth } from "@/components/useBackendHealth";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";

function StatusRow({ icon, label, value, tone, detail }) {
  const tones = { ok: "bg-emerald-100 text-emerald-800", bad: "bg-red-100 text-red-800", neutral: "bg-slate-100 text-slate-700" };
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-surface-container bg-surface-container-lowest gap-3">
      <div className="flex items-center gap-3 text-on-surface-variant">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{icon}</span>
        <div className="flex flex-col">
          <span className="font-medium text-sm">{label}</span>
          {detail && <span className="text-[10px]">{detail}</span>}
        </div>
      </div>
      <span className={`px-2.5 py-1 rounded-full font-bold text-[10px] uppercase ${tones[tone]}`}>{value}</span>
    </div>
  );
}

export default function WelcomePage() {
  const health = useBackendHealth();
  const { operator } = useWorkflowSession();

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center relative overflow-y-auto bg-background py-10">
      <div className="absolute inset-0 z-0 tech-grid opacity-60" aria-hidden="true"></div>
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-surface-bright via-background to-surface-container-low opacity-90" aria-hidden="true"></div>

      <main className="relative z-10 w-full max-w-[1400px] px-6 md:px-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 flex flex-col gap-5">
          <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-[0.1em]">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">school</span>
            <span>RMIT University Capstone 2026 · 3D Vision for Automated Structural Welding</span>
          </div>
          <h1 className="text-4xl md:text-[52px] md:leading-[1.1] font-extrabold text-on-surface tracking-tight">
            Vertex Dynamics: <br />
            <span className="text-primary">Scan-to-Path Hub</span>
          </h1>
          <p className="text-base sm:text-lg text-on-surface-variant max-w-2xl">
            A local, single-operator tool that imports seam descriptor files, validates them, and generates a candidate
            motion-only ABB RAPID module for manual validation in RobotStudio.
          </p>
          <ul className="text-sm text-on-surface-variant list-disc pl-5 max-w-2xl flex flex-col gap-1">
            <li>No camera, TracerStudio or robot-controller connection is part of this application.</li>
            <li>No reachability, collision, singularity or welding-process checks are performed.</li>
            <li>A downloaded module is not approval for physical execution.</li>
          </ul>
          <div>
            <Link href={operator ? "/projects" : "/login"} className="inline-flex items-center gap-3 bg-primary hover:bg-on-primary-fixed-variant text-on-primary px-7 py-3.5 rounded-lg shadow-lg font-bold text-xs tracking-wider uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
              {operator ? `Continue as ${operator}` : "Start local session"}
              <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </Link>
          </div>
        </div>

        <section className="lg:col-span-5 w-full max-w-md justify-self-end bg-surface rounded-xl border border-outline-variant shadow-sm overflow-hidden" aria-label="System status">
          <div className="px-6 py-4 border-b border-surface-variant bg-surface-container-lowest">
            <h2 className="font-bold text-on-surface text-base">System status</h2>
            <p className="text-[11px] text-on-surface-variant">Only the backend row is measured; the other rows describe what is integrated.</p>
          </div>
          <div className="p-6 flex flex-col gap-3">
            <StatusRow
              icon="dns"
              label="Backend API"
              detail={health.checkedAt ? `Checked ${health.checkedAt.toLocaleTimeString()} via GET /api/health` : "Checking…"}
              value={health.status === "online" ? "Online" : health.status === "offline" ? "Disconnected" : "Checking"}
              tone={health.status === "online" ? "ok" : health.status === "offline" ? "bad" : "neutral"}
            />
            <StatusRow icon="photo_camera" label="Camera / TracerStudio" detail="Seam data arrives as exported files" value="Not integrated" tone="neutral" />
            <StatusRow icon="precision_manufacturing" label="Robot controller" detail="No controller connection exists" value="Not integrated" tone="neutral" />
          </div>
        </section>
      </main>
    </div>
  );
}
