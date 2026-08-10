"use client";

import type { AgentManifest, Dashboard, ProjectSummary } from "@hiveswarm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceClient, type WorkspaceCommand } from "./workspace-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export function useProjectWorkspace() {
  const client = useRef<WorkspaceClient | null>(null);
  client.current ??= new WorkspaceClient(apiUrl);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<AgentManifest[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (projectId?: string) => {
    try {
      const snapshot = await client.current!.load(projectId);
      if (!snapshot) return;
      setDashboard(snapshot.dashboard);
      setAgents(snapshot.agents);
      setProjects(snapshot.projects);
      setActiveProjectId(snapshot.activeProjectId);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the evaluation.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!dashboard) return;
    const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
    const projectId = dashboard.engagement.id;
    const subscription = client.current!.subscribe(runId, () => void refresh(projectId));
    return () => subscription.close();
  }, [dashboard?.engagement.id, refresh]);

  const execute = useCallback(async (command: WorkspaceCommand) => {
    const result = await client.current!.execute(command);
    await refresh(result.projectId ?? dashboard?.engagement.id);
    return result;
  }, [dashboard?.engagement.id, refresh]);

  const loadReport = useCallback((projectId: string) => client.current!.loadReport(projectId), []);

  return { dashboard, agents, projects, activeProjectId, error, refresh, execute, loadReport };
}
