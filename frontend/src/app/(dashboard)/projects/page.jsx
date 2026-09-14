"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkflowSession } from "@/components/WorkflowSessionContext";
import { useToast } from "@/components/ToastContext";
import { api } from "@/services/apiClient";
import { Card, Icon, InlineError, SourceKindBadge } from "@/components/StatusPanels";
import { shortHash } from "@/lib/statusLabels";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function ProjectsPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { projectId, selectProject, openJob, job, mode } = useWorkflowSession();
  const [list, setList] = useState({ projects: null, error: null });
  const [detail, setDetail] = useState({ key: null, data: null, error: null });
  const [listNonce, setListNonce] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listProjects()
      .then((r) => { if (!cancelled) setList({ projects: r.projects, error: null }); })
      .catch((err) => { if (!cancelled) setList({ projects: null, error: err }); });
    return () => { cancelled = true; };
  }, [listNonce]);

  useEffect(() => {
    if (!projectId) return undefined;
    const controller = new AbortController();
    api.getProject(projectId, controller.signal)
      .then((r) => setDetail({ key: projectId, data: r, error: null }))
      .catch((err) => { if (!err.cancelled) setDetail({ key: projectId, data: null, error: err }); });
    return () => controller.abort();
  }, [projectId, listNonce]);

  const current = detail.key === projectId ? detail : { data: null, error: null };

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const { project } = await api.createProject(name, description);
      selectProject(project.id);
      setName("");
      setDescription("");
      setListNonce((n) => n + 1);
      showToast("Project created", `${project.name} is now the active project.`, "success");
    } catch (err) {
      setCreateError(err);
    } finally {
      setCreating(false);
    }
  };

  const choose = (id) => {
    if (id === projectId) return;
    if (job && !window.confirm("Open another project? The current job stays stored and can be reopened later.")) return;
    selectProject(id);
  };

  const resume = (j) => {
    const jobMode = j.mode === "testing" ? "testing" : "tcp";
    openJob(j.id, j.latestRevision, jobMode);
    router.push(jobMode === "testing" ? "/testing-preview" : "/parse-map");
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 w-full">
      <div className="max-w-[1400px] mx-auto w-full flex flex-col gap-6">
        <header>
          <h1 className="text-3xl font-extrabold text-on-surface mb-1 tracking-tight">Projects</h1>
          <p className="text-sm text-on-surface-variant">
            Local projects stored by the backend on this computer (<span className="font-mono">backend/data</span>). Each job keeps
            immutable revisions of its source, parameters, geometry and module.
          </p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Card title="New project" icon="add">
            <form onSubmit={create} className="flex flex-col gap-3">
              <label className="text-xs font-bold flex flex-col gap-1">Name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="bg-surface-container-highest border border-outline-variant rounded px-3 py-2 text-sm font-normal" />
              </label>
              <label className="text-xs font-bold flex flex-col gap-1">Description (optional)
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} className="bg-surface-container-highest border border-outline-variant rounded px-3 py-2 text-sm font-normal" />
              </label>
              <InlineError error={createError} />
              <button type="submit" disabled={creating || !name.trim()} className="bg-primary disabled:opacity-50 text-on-primary rounded-lg py-2.5 text-xs font-bold uppercase">
                {creating ? "Creating…" : "Create and select"}
              </button>
            </form>
          </Card>

          <Card title="Existing projects" icon="folder" className="xl:col-span-2" actions={<button type="button" onClick={() => setListNonce((n) => n + 1)} className="text-xs text-primary font-bold">Refresh</button>}>
            {list.error && <InlineError error={list.error} onRetry={() => setListNonce((n) => n + 1)} />}
            {!list.error && list.projects === null && <p className="text-xs text-on-surface-variant">Loading projects…</p>}
            {list.projects && list.projects.length === 0 && <p className="text-xs text-on-surface-variant italic">No projects yet. Create one to begin.</p>}
            {list.projects && list.projects.length > 0 && (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {list.projects.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => choose(p.id)} aria-pressed={p.id === projectId} className={`w-full text-left rounded-lg border p-3 flex flex-col gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${p.id === projectId ? "border-primary bg-primary/5" : "border-outline-variant hover:border-outline"}`}>
                      <span className="font-extrabold text-on-surface flex items-center gap-2">
                        {p.id === projectId && <Icon name="check_circle" className="text-primary text-[18px]" />}
                        <span className="break-words">{p.name}</span>
                      </span>
                      {p.description && <span className="text-xs text-on-surface-variant break-words">{p.description}</span>}
                      <span className="text-[10px] text-on-surface-variant font-mono">{p.jobCount} job(s) · updated {when(p.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {projectId && (
          <Card title="Jobs in the selected project" icon="work_history" actions={
            <button type="button" onClick={() => router.push(mode === "testing" ? "/testing-upload" : "/acquire")} className="bg-primary text-on-primary rounded-lg px-3 py-1.5 text-xs font-bold uppercase">
              New job ({mode === "testing" ? "Testing upload" : "Acquire"})
            </button>
          }>
            {current.error && <InlineError error={current.error} onRetry={() => setListNonce((n) => n + 1)} />}
            {!current.error && !current.data && <p className="text-xs text-on-surface-variant">Loading jobs…</p>}
            {current.data && current.data.jobs.length === 0 && <p className="text-xs text-on-surface-variant italic">No jobs yet in {current.data.project.name}.</p>}
            {current.data && current.data.jobs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-on-surface-variant border-b border-outline-variant/40">
                      <th scope="col" className="py-1.5 pr-3">Source</th>
                      <th scope="col" className="py-1.5 pr-3">Kind</th>
                      <th scope="col" className="py-1.5 pr-3">Mode / seam</th>
                      <th scope="col" className="py-1.5 pr-3">Revisions</th>
                      <th scope="col" className="py-1.5 pr-3">Output</th>
                      <th scope="col" className="py-1.5 pr-3">Updated</th>
                      <th scope="col" className="py-1.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.data.jobs.map((j) => (
                      <tr key={j.id} className="border-b border-outline-variant/15">
                        <td className="py-1.5 pr-3 font-mono break-all max-w-[260px]">{j.source ? j.source.displayName : "—"}</td>
                        <td className="py-1.5 pr-3">{j.source && <SourceKindBadge kind={j.source.kind} />}</td>
                        <td className="py-1.5 pr-3">{j.mode === "testing" ? "Testing" : "File import"} · {j.plannedType}</td>
                        <td className="py-1.5 pr-3 font-mono">{j.latestRevision}</td>
                        <td className="py-1.5 pr-3 font-mono" title={j.outputSha256}>{shortHash(j.outputSha256)}</td>
                        <td className="py-1.5 pr-3">{when(j.updatedAt)}</td>
                        <td className="py-1.5 text-right">
                          <button type="button" onClick={() => resume(j)} className="text-primary font-bold underline">Open r{j.latestRevision}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
