"use client";

import React from "react";
import Link from "next/link";
import { Icon } from "./StatusPanels";

/** Honest placeholder for a capability that is not implemented in this build. */
export default function UnavailableFeature({ title, summary, reasons, prerequisites }) {
  return (
    <div className="flex-1 overflow-y-auto bg-background p-8">
      <div className="max-w-2xl mx-auto flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Icon name="block" className="text-4xl text-on-surface-variant" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Not available in this build</p>
            <h1 className="text-2xl font-extrabold text-on-surface">{title}</h1>
          </div>
        </div>
        <p className="text-sm text-on-surface-variant leading-relaxed">{summary}</p>
        <section className="bg-surface border border-outline-variant rounded-xl p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2">Why it is unavailable</h2>
          <ul className="list-disc pl-5 text-sm flex flex-col gap-1">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
        <section className="bg-surface border border-outline-variant rounded-xl p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2">What would be needed</h2>
          <ul className="list-disc pl-5 text-sm flex flex-col gap-1">{prerequisites.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>
        <p className="text-xs text-on-surface-variant">The gated roadmap is documented in <span className="font-mono">docs/IMPLEMENTATION_HANDOFF.md</span>.</p>
        <Link href="/projects" className="self-start bg-primary text-on-primary px-4 py-2 rounded-lg text-xs font-bold uppercase">Back to Projects</Link>
      </div>
    </div>
  );
}
