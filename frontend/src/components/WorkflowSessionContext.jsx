"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { sessionStore } from "@/lib/sessionStore";
import { createLatestRequestTracker } from "@/lib/latestRequest";
import { api } from "@/services/apiClient";

const WorkflowSessionContext = createContext(null);

/**
 * Session references (operator, mode, project, job revision, source) plus the
 * canonical job revision fetched from the backend for the current reference.
 * Completion is never stored here: stage access is derived from the fetched
 * record and gates.
 */
export function WorkflowSessionProvider({ children }) {
  const snap = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot, sessionStore.getServerSnapshot);
  const { session, hydrated, notice, persistent } = snap;
  const trackerRef = useRef(null);
  if (trackerRef.current === null) trackerRef.current = createLatestRequestTracker();

  const key = session.jobId && session.revision ? `${session.jobId}#${session.revision}` : null;
  const [jobState, setJobState] = useState({ key: null, view: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!hydrated || !key) return undefined;
    const tracker = trackerRef.current;
    const token = tracker.begin();
    const controller = new AbortController();
    const [jobId, revision] = key.split("#");
    api.getRevision(jobId, Number(revision), controller.signal)
      .then((view) => {
        if (token.isCurrent()) setJobState({ key, view, error: null });
      })
      .catch((err) => {
        if (err.cancelled || !token.isCurrent()) return;
        const message = err.status === 404
          ? "The saved job revision no longer exists in the backend store. It was cleared from this session."
          : err.message;
        setJobState({ key, view: null, error: { message, network: !!err.network, status: err.status } });
        if (err.status === 404) sessionStore.update({ jobId: null, revision: null });
      });
    return () => {
      controller.abort();
      tracker.invalidate();
    };
  }, [hydrated, key, reloadToken]);

  const job = key && jobState.key === key ? jobState.view : null;
  const jobError = key && jobState.key === key ? jobState.error : null;
  const jobLoading = hydrated && !!key && jobState.key !== key;

  /** Adopts a job view returned by any mutating request (create, reprocess, ack, review, export). */
  const applyJobView = useCallback((view) => {
    if (!view || !view.record) return;
    const nextKey = `${view.record.jobId}#${view.record.revision}`;
    trackerRef.current.invalidate();
    setJobState({ key: nextKey, view, error: null });
    sessionStore.update({ jobId: view.record.jobId, revision: view.record.revision, sourceId: view.record.source.id, projectId: view.record.projectId });
  }, []);

  const actions = useMemo(() => ({
    setOperator: (operator) => sessionStore.update({ operator }),
    clearOperator: () => sessionStore.update({ operator: null }),
    selectProject: (projectId) => {
      trackerRef.current.invalidate();
      sessionStore.update({ projectId, jobId: null, revision: null, sourceId: null });
    },
    setMode: (mode) => {
      trackerRef.current.invalidate();
      sessionStore.update({ mode, jobId: null, revision: null, sourceId: null });
    },
    selectSource: (sourceId) => sessionStore.update({ sourceId }),
    openJob: (jobId, revision, mode) => sessionStore.update({ jobId, revision, ...(mode ? { mode } : {}) }),
    closeJob: () => {
      trackerRef.current.invalidate();
      sessionStore.update({ jobId: null, revision: null });
    },
    reloadJob: () => setReloadToken((t) => t + 1),
    dismissNotice: () => sessionStore.dismissNotice(),
  }), []);

  const value = {
    hydrated,
    persistent,
    notice,
    operator: session.operator,
    mode: session.mode,
    projectId: session.projectId,
    sourceId: session.sourceId,
    jobId: session.jobId,
    revision: session.revision,
    job,
    jobLoading,
    jobError,
    applyJobView,
    ...actions,
  };

  return <WorkflowSessionContext.Provider value={value}>{children}</WorkflowSessionContext.Provider>;
}

export function useWorkflowSession() {
  const ctx = useContext(WorkflowSessionContext);
  if (!ctx) throw new Error("useWorkflowSession must be used inside WorkflowSessionProvider");
  return ctx;
}
