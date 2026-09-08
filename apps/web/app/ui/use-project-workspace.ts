"use client";

import type { AgentManifest, Dashboard, ProjectSummary } from "@hiveswarm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceClient, type WorkspaceCommand, type WorkspaceConnection } from "./workspace-client";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export function useProjectWorkspace() {
  const client = useRef<WorkspaceClient | null>(null);
  client.current ??= new WorkspaceClient(apiUrl);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [agents, setAgents] = useState<AgentManifest[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<WorkspaceConnection>("connecting");
  const selection = useRef<{ projectId?: string; generation: number; navigating: boolean }>({ generation: 0, navigating: false });

  const refresh = useCallback(async (projectId?: string) => {
    if (selection.current.navigating) return;
    if (projectId !== undefined && projectId !== selection.current.projectId) {
      selection.current.generation++;
      selection.current.projectId = projectId;
    }
    const generation = selection.current.generation;
    try {
      const snapshot = await client.current!.load(selection.current.projectId);
      if (!snapshot || generation !== selection.current.generation) return;
      selection.current.projectId = snapshot.dashboard.engagement.id;
      setDashboard(snapshot.dashboard);
      setAgents(snapshot.agents);
      setProjects(snapshot.projects);
      setActiveProjectId(snapshot.dashboard.engagement.id);
      setError("");
    } catch (cause) {
      if (generation !== selection.current.generation) return;
      setError(cause instanceof Error ? cause.message : "Unable to load the evaluation.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      selection.current.generation++;
      client.current!.invalidate();
    };
  }, [refresh]);
  const runId = dashboard?.agents[0]?.runId ?? dashboard?.engagement.id;
  useEffect(() => {
    if (!runId) return;
    const subscription = client.current!.subscribe(runId, () => void refresh(), setConnection);
    return () => subscription.close();
  }, [runId, refresh]);

  const execute = useCallback(async (command: WorkspaceCommand) => {
    const navigates = command.type === "switch-project" || command.type === "create-project";
    if (navigates) {
      selection.current.generation++;
      selection.current.navigating = true;
      client.current!.invalidate();
    }
    const generation = selection.current.generation;
    try {
      const result = await client.current!.execute(command);
      if (generation !== selection.current.generation) return result;
      if (navigates) selection.current.navigating = false;
      // Mutation ownership stays in the command; completion is not navigation.
      await refresh(navigates ? result.projectId : undefined);
      return result;
    } catch (cause) {
      if (navigates && generation === selection.current.generation) selection.current.navigating = false;
      throw cause;
    }
  }, [refresh]);

  const loadReport = useCallback((projectId: string) => client.current!.loadReport(projectId), []);

  return { dashboard, agents, projects, activeProjectId, error, connection, refresh, execute, loadReport };
}
