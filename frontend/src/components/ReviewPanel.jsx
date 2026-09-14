"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkflowSession } from "./WorkflowSessionContext";
import { useToast } from "./ToastContext";
import { api } from "@/services/apiClient";
import { Card, Icon, InlineError } from "./StatusPanels";

/**
 * Required acknowledgements plus the geometry review for the CURRENT revision.
 * The backend refuses the review until every acknowledgement is recorded, and
 * a new revision starts with none.
 */
export default function ReviewPanel({ nextPath = "/generate" }) {
  const router = useRouter();
  const { job, operator, applyJobView } = useWorkflowSession();
  const { showToast } = useToast();
  const [checked, setChecked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!job) return null;
  const { record, review, gates } = job;
  const given = review.acknowledgements;
  const pending = record.requiredAcknowledgements.filter((a) => !given[a.code]);
  const allChecked = pending.every((a) => checked[`${record.revision}:${a.code}`]);
  const reviewed = !!review.geometryReview;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      let view = job;
      const codes = pending.map((a) => a.code);
      if (codes.length) view = await api.acknowledge(record.jobId, record.revision, codes, operator);
      view = await api.review(record.jobId, record.revision, "geometry", operator);
      applyJobView(view);
      showToast("Geometry reviewed", `Revision ${record.revision} review recorded for ${operator}.`, "success");
      router.push(nextPath);
    } catch (err) {
      setError(err);
      if (err.status === 409) showToast("Revision changed", err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={`Review revision ${record.revision}`} icon="rule">
      {!gates.isLatest && (
        <p className="text-[11px] font-bold text-red-800 bg-red-50 border border-red-300 rounded px-2 py-1 mb-2">
          This revision is superseded by revision {gates.latestRevision}. Open the latest revision from Projects.
        </p>
      )}
      <ul className="flex flex-col gap-2 mb-3">
        {record.requiredAcknowledgements.map((a) => {
          const g = given[a.code];
          const id = `ack-${record.revision}-${a.code}`;
          return (
            <li key={a.code} className="text-[11px] leading-snug">
              <label htmlFor={id} className="flex items-start gap-2">
                <input
                  id={id}
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!g || !!checked[`${record.revision}:${a.code}`]}
                  disabled={!!g || busy || reviewed || !gates.isLatest}
                  onChange={(e) => setChecked((c) => ({ ...c, [`${record.revision}:${a.code}`]: e.target.checked }))}
                />
                <span>
                  <span className="font-bold">I acknowledge:</span> {a.message}
                  <span className="block font-mono text-[9px] text-on-surface-variant">{a.code}{g ? ` · acknowledged by ${g.by} at ${new Date(g.at).toLocaleString()}` : ""}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <InlineError error={error} />
      {reviewed ? (
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1 font-bold text-emerald-800"><Icon name="task_alt" className="text-[16px]" />Reviewed by {review.geometryReview.by}</span>
          <button type="button" onClick={() => router.push(nextPath)} className="bg-primary text-on-primary rounded-lg px-3 py-2 text-xs font-bold uppercase">Continue</button>
        </div>
      ) : (
        <button type="button" onClick={confirm} disabled={!allChecked || busy || !gates.isLatest} className="w-full bg-primary disabled:bg-surface-container-high disabled:text-on-surface-variant text-on-primary rounded-lg py-2.5 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2">
          <Icon name={busy ? "progress_activity" : "verified"} className={`text-[16px] ${busy ? "animate-spin" : ""}`} />
          {allChecked ? "Confirm geometry review and continue" : "Tick every acknowledgement to continue"}
        </button>
      )}
    </Card>
  );
}
