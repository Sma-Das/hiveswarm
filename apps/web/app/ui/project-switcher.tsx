"use client";

import type { ProjectSummary } from "@hiveswarm/contracts";
import { Check, FolderKanban, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function ProjectSwitcher({ open, projects, activeProjectId, onClose, onSelect, onNew }: {
  open: boolean;
  projects: ProjectSummary[];
  activeProjectId: string;
  onClose: () => void;
  onSelect: (projectId: string) => Promise<void>;
  onNew: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      searchRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const visible = useMemo(() => projects.filter((project) => !query.trim() || `${project.name} ${project.target}`.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);
  return (
    <dialog ref={ref} className="dialog project-dialog" onClose={onClose} onCancel={onClose} aria-labelledby="project-switcher-title">
      <div className="dialog__surface">
        <div className="dialog__header">
          <div><p className="eyebrow">Workspace</p><h2 id="project-switcher-title">Switch project</h2><p className="dialog-copy">Each project keeps its own scope, swarm, evidence graph, findings, and report.</p></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} aria-hidden="true" /></button>
        </div>
        <label className="project-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search projects</span><input ref={searchRef} type="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="project-list">
          {visible.map((project) => <button type="button" key={project.id} className={`project-row${project.id === activeProjectId ? " is-active" : ""}`} disabled={Boolean(busyId)} onClick={async () => {
            if (project.id === activeProjectId) { onClose(); return; }
            setError("");
            setBusyId(project.id);
            try { await onSelect(project.id); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open the project."); } finally { setBusyId(""); }
          }}>
            <span className="project-row__icon"><FolderKanban size={17} aria-hidden="true" /></span>
            <span className="project-row__copy"><strong>{project.name}</strong><small><bdi>{project.target}</bdi></small></span>
            <span className="project-row__meta"><small>{project.agentCount} agents · {project.metrics.findings} findings</small>{project.id === activeProjectId ? <Check size={16} aria-label="Current project" /> : <i className={`project-state project-state--${project.status}`}>{busyId === project.id ? "Opening" : project.status.replace("_", " ")}</i>}</span>
          </button>)}
          {!visible.length ? <div className="empty-inline">No projects match that search.</div> : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog__actions dialog__actions--between"><span>{projects.length} projects</span><button type="button" className="button button--primary" onClick={() => { onClose(); onNew(); }}><Plus size={16} aria-hidden="true" />New project</button></div>
      </div>
    </dialog>
  );
}
