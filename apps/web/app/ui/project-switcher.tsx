"use client";

import type { ProjectSummary } from "@hiveswarm/contracts";
import { Check, FolderKanban, Plus, Search } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Status } from "./status";

type ProjectSwitcherProps = {
  open: boolean;
  projects: ProjectSummary[];
  activeProjectId: string;
  onClose: () => void;
  onSelect: (projectId: string) => Promise<void>;
  onNew: () => void;
};

export function ProjectSwitcher({ open, ...props }: ProjectSwitcherProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onClose();
      }}
    >
      {open ? <ProjectList {...props} /> : null}
    </Dialog>
  );
}

function ProjectList({
  projects,
  activeProjectId,
  onClose,
  onSelect,
  onNew,
}: Omit<ProjectSwitcherProps, "open">) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const visible = projects.filter((project) =>
    `${project.name} ${project.target}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Switch project</DialogTitle>
        <DialogDescription>
          Each project has its own scope, runs, findings, and report.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor={`${id}-search`} className="sr-only">
          Search projects
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            id={`${id}-search`}
            type="search"
            className="pl-9"
            placeholder="Search by project name or target"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <p className="sr-only" role="status">
        {visible.length} {visible.length === 1 ? "project" : "projects"} shown.
        {busyId ? " Opening project." : ""}
      </p>
      <div
        className="max-h-[50dvh] overflow-y-auto overscroll-contain"
        aria-busy={Boolean(busyId)}
      >
        {visible.length ? (
          <ul className="space-y-2" aria-label="Projects">
            {visible.map((project) => (
              <li key={project.id}>
                <Button
                  type="button"
                  variant="ghost"
                  className={`h-auto w-full justify-start gap-3 whitespace-normal rounded-md border p-4 text-left ${project.id === activeProjectId ? "border-ring bg-accent/50" : "border-border bg-background"}`}
                  disabled={Boolean(busyId)}
                  aria-current={
                    project.id === activeProjectId ? "true" : undefined
                  }
                  onClick={async () => {
                    if (project.id === activeProjectId) {
                      onClose();
                      return;
                    }
                    setError("");
                    setBusyId(project.id);
                    try {
                      await onSelect(project.id);
                      onClose();
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Unable to open the project.",
                      );
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  <FolderKanban
                    className="size-5 self-start text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-words text-base font-semibold">
                        {project.name}
                      </span>
                      {project.id === activeProjectId ? (
                        <Badge variant="outline" className="bg-background">
                          <Check aria-hidden="true" />
                          Current
                        </Badge>
                      ) : null}
                    </span>
                    <bdi className="break-all text-sm font-normal text-muted-foreground">
                      {project.target}
                    </bdi>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-normal text-muted-foreground">
                        {project.agentCount} agents / {project.metrics.findings}{" "}
                        findings
                      </span>
                      {busyId === project.id ? (
                        <span className="text-xs">Opening...</span>
                      ) : (
                        <Status value={project.status} />
                      )}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
            <h3 className="text-sm font-semibold">
              {projects.length ? "No matching projects" : "No projects yet"}
            </h3>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {projects.length
                ? `No project name or target matches "${query.trim()}".`
                : "Create a project to define the first assessment boundary."}
            </p>
            {query ? (
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                Clear search
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {error ? (
        <p
          className="break-words rounded-md bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <DialogFooter className="items-center border-t border-border pt-4 sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
        <Button
          type="button"
          disabled={Boolean(busyId)}
          onClick={() => {
            onClose();
            onNew();
          }}
        >
          <Plus aria-hidden="true" />
          New project
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
