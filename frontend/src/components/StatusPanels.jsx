"use client";

import React from "react";
import Link from "next/link";
import { VALIDATION_ROWS, describeState, TONE_CLASSES, SOURCE_KIND_LABEL, SEVERITY, shortHash } from "@/lib/statusLabels";

export function Icon({ name, className = "" }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

export function Card({ title, icon, children, className = "", actions = null }) {
  return (
    <section className={`bg-surface border border-outline-variant rounded-xl p-4 shadow-sm relative overflow-hidden shrink-0 ${className}`}>
      <div className="absolute top-0 left-0 w-1 h-full bg-primary" aria-hidden="true"></div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="font-bold text-xs text-on-surface flex items-center gap-2 uppercase tracking-wide">
          {icon && <Icon name={icon} className="text-[18px] text-primary" />}
          {title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StateBadge({ value, compact = false }) {
  const d = describeState(value);
  return (
    <span className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-bold ${TONE_CLASSES[d.tone]}`}>
      <Icon name={d.icon} className="text-[13px]" />
      {compact ? d.text.split(" — ")[0] : d.text}
    </span>
  );
}

export function SourceKindBadge({ kind }) {
  const demo = kind === "demo";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide border ${demo ? "bg-amber-100 text-amber-900 border-amber-400" : "bg-slate-100 text-slate-700 border-slate-300"}`}>
      <Icon name={demo ? "science" : "description"} className="text-[13px]" />
      {SOURCE_KIND_LABEL[kind] || kind}
    </span>
  );
}

export function ValidationPanel({ gates }) {
  if (!gates) return null;
  return (
    <Card title="Validation status (separate states)" icon="fact_check">
      <ul className="flex flex-col gap-1.5 text-[11px]">
        {VALIDATION_ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 border-b border-outline-variant/30 pb-1 last:border-0">
            <span className="font-semibold text-on-surface-variant">{row.label}</span>
            <StateBadge value={gates.validation[row.key]} />
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-on-surface-variant mt-2 leading-relaxed">
        Application checks do not establish reachability, collision freedom or safe motion. A downloaded module is a
        candidate for manual RobotStudio validation, not approval for physical execution.
      </p>
    </Card>
  );
}

export function DiagnosticsList({ diagnostics, emptyText = "No diagnostics." }) {
  const list = Array.isArray(diagnostics) ? diagnostics : [];
  if (list.length === 0) return <p className="text-[11px] text-on-surface-variant italic">{emptyText}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((d, i) => {
        const sev = SEVERITY[d.severity] || SEVERITY.info;
        return (
          <li key={`${d.code}-${i}`} className={`border rounded-md px-2 py-1.5 text-[11px] leading-snug ${TONE_CLASSES[sev.tone]}`}>
            <div className="flex items-start gap-1.5">
              <Icon name={sev.icon} className="text-[15px] mt-px shrink-0" />
              <div className="min-w-0">
                <span className="font-bold">{sev.text}{d.line ? ` · line ${d.line}` : ""}: </span>
                <span className="break-words">{d.message}</span>
                <span className="block font-mono text-[9px] opacity-70 mt-0.5">{d.code}{d.requiresAcknowledgement ? " · acknowledgement required" : ""}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function JobIdentityCard({ record, gates }) {
  if (!record) return null;
  return (
    <Card title="Current job revision" icon="badge">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-on-surface-variant font-bold">Source</dt>
        <dd className="font-mono break-all">{record.source.displayName}</dd>
        <dt className="text-on-surface-variant font-bold">Source kind</dt>
        <dd><SourceKindBadge kind={record.source.kind} /></dd>
        <dt className="text-on-surface-variant font-bold">Source SHA-256</dt>
        <dd className="font-mono" title={record.source.sha256}>{shortHash(record.source.sha256)}</dd>
        <dt className="text-on-surface-variant font-bold">Job / revision</dt>
        <dd className="font-mono break-all" title={record.jobId}>{record.jobId.slice(0, 12)}… · r{record.revision}{gates && !gates.isLatest ? ` (superseded by r${gates.latestRevision})` : ""}</dd>
        <dt className="text-on-surface-variant font-bold">Profile</dt>
        <dd className="font-mono">{record.profile.id}@{record.profile.version}</dd>
        <dt className="text-on-surface-variant font-bold">Tool / wobj</dt>
        <dd className="font-mono">{record.profile.toolName} / {record.profile.wobjName}</dd>
        <dt className="text-on-surface-variant font-bold">Output SHA-256</dt>
        <dd className="font-mono" title={record.output.sha256}>{shortHash(record.output.sha256)}</dd>
      </dl>
      {record.source.kind === "demo" && (
        <p className="mt-2 text-[11px] font-bold text-amber-900 bg-amber-100 border border-amber-400 rounded px-2 py-1">
          Demo sample: inspection only. Download and RobotStudio launch are blocked for this revision.
        </p>
      )}
    </Card>
  );
}

export function LockedStage({ reason, fixPath, pending }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-background p-8">
      <div className="max-w-md text-center flex flex-col items-center gap-3" role="alert">
        <Icon name={pending ? "hourglass_top" : "lock"} className="text-5xl text-primary/50" />
        <h2 className="text-lg font-extrabold text-on-surface">{pending ? "Loading…" : "This stage is not available yet"}</h2>
        <p className="text-sm text-on-surface-variant">{reason}</p>
        {fixPath && !pending && (
          <Link href={fixPath} className="mt-2 bg-primary text-on-primary px-5 py-2.5 rounded-lg font-bold text-xs uppercase tracking-wider focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            Go to the required step
          </Link>
        )}
      </div>
    </div>
  );
}

export function InlineError({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="border border-red-300 bg-red-50 text-red-900 rounded-lg p-3 text-xs flex flex-col gap-2" role="alert">
      <div className="flex items-start gap-2">
        <Icon name={error.network ? "cloud_off" : "error"} className="text-[18px]" />
        <div>
          <p className="font-bold">{error.network ? "Backend disconnected" : "Request failed"}{error.code && !error.network ? ` (${error.code})` : ""}</p>
          <p className="break-words">{error.message}</p>
        </div>
      </div>
      {Array.isArray(error.diagnostics) && error.diagnostics.length > 0 && <DiagnosticsList diagnostics={error.diagnostics} />}
      {error.details && Array.isArray(error.details.reasons) && (
        <ul className="list-disc pl-5">{error.details.reasons.map((r) => <li key={r.code}>{r.message}</li>)}</ul>
      )}
      {onRetry && <button type="button" onClick={onRetry} className="self-start bg-red-700 text-white px-3 py-1.5 rounded font-bold">Retry</button>}
    </div>
  );
}
