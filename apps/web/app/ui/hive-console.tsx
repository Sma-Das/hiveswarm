"use client";

import type {
  Dashboard,
  GraphNode,
  Severity,
  SpawnAgentRequest,
} from "@hiveswarm/contracts";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  GitFork,
  Globe2,
  LayoutDashboard,
  List,
  Loader2,
  Menu,
  Network,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldEllipsis,
  Target,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { HiveMark } from "./brand";
import {
  ActivityList,
  AssetsTable,
  FindingsTable,
  SpecialistsTable,
} from "./evidence-views";
import { EngagementDialog } from "./engagement-dialog";
import { FindingDrawer } from "./finding-drawer";
import { ProjectSwitcher } from "./project-switcher";
import { RegistryView } from "./registry-view";
import { ReportView, reportDataSchema, type ReportData } from "./report-view";
import { ScopeView } from "./scope-view";
import { SecurityGraph, SwarmGraph } from "./security-graph";
import { SpawnDialog } from "./spawn-dialog";
import { SeverityBadge, Status } from "./status";
import { useProjectWorkspace } from "./use-project-workspace";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";
const pages = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    description: "Your assessment, from execution to evidence.",
  },
  {
    id: "assets",
    label: "Assets",
    icon: Network,
    description:
      "Explore discovered assets and the relationships between them.",
  },
  {
    id: "findings",
    label: "Findings",
    icon: ShieldCheck,
    description:
      "Prioritize issues and inspect the evidence behind each finding.",
  },
  {
    id: "specialists",
    label: "Specialists",
    icon: Bot,
    description: "Supervise specialist executions and their delegated work.",
  },
  {
    id: "activity",
    label: "Activity",
    icon: Activity,
    description: "A chronological record of specialist output.",
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldEllipsis,
    description:
      "Review requested actions, capability access, and scope changes.",
  },
  { id: "scope", label: "Scope", icon: Target, description: "" },
  { id: "report", label: "Report", icon: FileText, description: "" },
  { id: "registry", label: "Agent registry", icon: Package, description: "" },
] as const;
type Page = (typeof pages)[number]["id"];
const severityOrder: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function pageFromUrl(): Page {
  const value = new URL(window.location.href).searchParams.get("view");
  return pages.find((page) => page.id === value)?.id ?? "overview";
}

export function HiveConsole() {
  const workspace = useProjectWorkspace();
  if (!workspace.dashboard) {
    return (
      <main
        id="main"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
        aria-busy={!workspace.error}
      >
        <HiveMark />
        <h1 className="text-xl font-semibold tracking-tight">
          {workspace.error ? "Workspace unavailable" : "Opening your workspace"}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {workspace.error ||
            "Loading the project, specialist runs, and recorded evidence."}
        </p>
        {workspace.error ? (
          <Button onClick={() => void workspace.refresh()}>
            <RefreshCw />
            Try again
          </Button>
        ) : (
          <Loader2
            className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
      </main>
    );
  }
  // Project-local UI state must not survive a project switch.
  return (
    <ProjectConsole
      key={workspace.dashboard.engagement.id}
      workspace={{ ...workspace, dashboard: workspace.dashboard }}
    />
  );
}

function ProjectConsole({
  workspace,
}: {
  workspace: ReturnType<typeof useProjectWorkspace> & { dashboard: Dashboard };
}) {
  const {
    dashboard,
    agents,
    projects,
    activeProjectId,
    error,
    connection,
    refresh,
    execute,
    loadReport,
  } = workspace;
  const [page, setPage] = useState<Page>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [engagementOpen, setEngagementOpen] = useState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [selection, setSelection] = useState<{
    kind: "agent" | "node";
    id: string;
  } | null>(null);
  const [scopeNode, setScopeNode] = useState<GraphNode | null>(null);
  const [findingId, setFindingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [findingOrder, setFindingOrder] = useState("severity");
  const [presentation, setPresentation] = useState("list");
  const [approvalTab, setApprovalTab] = useState("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [terminateId, setTerminateId] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportRetry, setReportRetry] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const currentPage = pages.find((item) => item.id === page)!;
  const runId = dashboard.agents[0]?.runId ?? dashboard.engagement.id;
  const runStatus = dashboard.engagement.status;
  const terminalRun = ["completed", "failed", "cancelled"].includes(runStatus);
  const pending = dashboard.approvals.filter(
    (approval) => approval.status === "pending",
  );
  const selectedAgent =
    selection?.kind === "agent"
      ? dashboard.agents.find((agent) => agent.id === selection.id)
      : null;
  const selectedNode =
    selection?.kind === "node"
      ? (dashboard.graph.nodes.find((node) => node.id === selection.id) ??
        scopeNode)
      : null;
  const selectedFinding =
    dashboard.findings.find((finding) => finding.id === findingId) ?? null;
  const highPriority = dashboard.findings.filter(
    (finding) =>
      ["critical", "high"].includes(finding.severity) &&
      ["open", "confirmed"].includes(finding.status),
  );
  const sortedFindings = [...dashboard.findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const matches = (...values: string[]) =>
    !normalizedQuery ||
    values.join(" ").toLowerCase().includes(normalizedQuery);
  const visibleFindings = sortedFindings.filter(
    (finding) =>
      (severity === "all" || finding.severity === severity) &&
      matches(
        finding.title,
        finding.assetLabel,
        finding.summary,
        finding.severity,
      ),
  );
  if (findingOrder === "newest")
    visibleFindings.sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  const visibleNodes = dashboard.graph.nodes.filter((node) =>
    matches(node.label, node.kind, node.subtitle ?? ""),
  );
  const nodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleAgents = dashboard.agents.filter((agent) =>
    matches(agent.agentName, agent.task, agent.target, agent.status),
  );
  const visibleLogs = dashboard.logs.filter((log) =>
    matches(
      log.message,
      log.level,
      dashboard.agents.find((agent) => agent.id === log.agentRunId)
        ?.agentName ?? "",
    ),
  );
  const visibleApprovals = dashboard.approvals.filter(
    (approval) =>
      (approvalTab === "pending"
        ? approval.status === "pending"
        : approval.status !== "pending") &&
      matches(approval.title, approval.requestedAction, approval.requestedBy),
  );

  useEffect(() => {
    setPage(pageFromUrl());
    const onBack = () => {
      setPage(pageFromUrl());
      setQuery("");
      setSeverity("all");
      setMobileNav(false);
    };
    window.addEventListener("popstate", onBack);
    return () => window.removeEventListener("popstate", onBack);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(
          target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        ) &&
        !document.querySelector('[role="dialog"]')
      ) {
        if (searchRef.current) {
          event.preventDefault();
          searchRef.current.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Compare evidence content, not array identities replaced by every SSE refresh.
  const reportVersion = JSON.stringify(dashboard);
  useEffect(() => {
    if (page !== "report") return;
    let cancelled = false;
    setReportLoading(true);
    setReportError("");
    loadReport(dashboard.engagement.id)
      .then((value) => {
        if (!cancelled) setReport(reportDataSchema.parse(value));
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setReportError(
            cause instanceof Error
              ? cause.message
              : "Unable to load the report.",
          );
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, dashboard.engagement.id, reportVersion, reportRetry, loadReport]);

  function navigate(next: Page) {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.hash = "";
    if (next !== page) window.history.pushState(null, "", url);
    setPage(next);
    setQuery("");
    setSeverity("all");
    setMobileNav(false);
    mainRef.current?.scrollTo({ top: 0 });
  }

  async function act(id: string, command: Parameters<typeof execute>[0]) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(id);
    setNotice(null);
    try {
      const result = await execute(command);
      setNotice({ text: result.message, error: false });
    } catch (cause) {
      setNotice({
        text:
          cause instanceof Error
            ? cause.message
            : "The action could not be completed. Try again.",
        error: true,
      });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function inspectNode(node: GraphNode | null) {
    if (!node) {
      setSelection(null);
      setScopeNode(null);
      return;
    }
    if (
      typeof node.metadata.findingId === "string" &&
      dashboard.findings.some(
        (finding) => finding.id === node.metadata.findingId,
      )
    ) {
      setFindingId(node.metadata.findingId);
      return;
    }
    setScopeNode(
      dashboard.graph.nodes.some((item) => item.id === node.id) ? null : node,
    );
    setSelection({ kind: "node", id: node.id });
  }

  async function spawn(request: SpawnAgentRequest) {
    const result = await execute({ type: "spawn", runId, request });
    setNotice({ text: result.message, error: false });
  }

  const nav = (
    <div className="flex min-h-full flex-col gap-6">
      <div className="space-y-1">
        <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">
          Project workspace
        </p>
        <nav aria-label="Project navigation" className="grid gap-1">
          {pages
            .filter((item) => item.id !== "registry")
            .map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                asChild
                variant="ghost"
                className={cn(
                  "h-10 w-full justify-start gap-3 px-3 font-normal text-muted-foreground",
                  page === id &&
                    "bg-accent font-medium text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <a
                  href={`?view=${id}`}
                  aria-current={page === id ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    ) {
                      event.preventDefault();
                      navigate(id);
                    }
                  }}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                  {id === "approvals" && pending.length > 0 ? (
                    <span className="ml-auto min-w-5 rounded-md bg-[var(--warning-soft)] px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-[var(--warning-text)]">
                      {pending.length}
                    </span>
                  ) : id === "findings" && dashboard.findings.length > 0 ? (
                    <span className="ml-auto text-xs tabular-nums">
                      {dashboard.findings.length}
                    </span>
                  ) : null}
                </a>
              </Button>
            ))}
        </nav>
      </div>
      <div className="border-t pt-5">
        <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">
          Workspace
        </p>
        <Button
          variant="ghost"
          onClick={() => navigate("registry")}
          aria-current={page === "registry" ? "page" : undefined}
          className={cn(
            "h-10 w-full justify-start gap-3 px-3 font-normal text-muted-foreground",
            page === "registry" &&
              "bg-accent font-medium text-accent-foreground",
          )}
        >
          <Package className="size-4" />
          Agent registry
          <span className="ml-auto text-xs tabular-nums">{agents.length}</span>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setMobileNav(false);
            setEngagementOpen(true);
          }}
          className="h-10 w-full justify-start gap-3 px-3 font-normal text-muted-foreground"
        >
          <Plus className="size-4" />
          New project
        </Button>
      </div>
      <div className="mt-auto px-3 pb-1 pt-8">
        <div className="flex items-center gap-2 text-xs font-medium">
          <ShieldCheck
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          Human-governed by design
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Specialists propose.
          <br />
          You control the boundaries.
        </p>
      </div>
    </div>
  );

  const search = (
    <div className="relative min-w-0 flex-1 sm:max-w-sm">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={searchRef}
        type="search"
        aria-label={`Search ${currentPage.label.toLowerCase()}`}
        placeholder={`Search ${currentPage.label.toLowerCase()}...`}
        className="h-9 pl-9 pr-9"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!query && (
        <kbd
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border px-1.5 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          /
        </kbd>
      )}
    </div>
  );

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-background">
      <header className="z-20 flex min-h-16 items-center gap-3 border-b bg-background px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          aria-label="Open navigation"
          onClick={() => setMobileNav(true)}
        >
          <Menu />
        </Button>
        <a
          href="?view=overview"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
          className="hidden shrink-0 items-center gap-2.5 font-semibold tracking-tight md:flex md:w-48"
          aria-label="HiveSwarm overview"
        >
          <HiveMark small />
          <span className="text-base">HiveSwarm</span>
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-muted-foreground">
            Alpha
          </span>
        </a>
        <div className="hidden h-5 w-px bg-border md:block" />
        <Button
          variant="ghost"
          className="min-w-0 justify-start px-2 font-medium"
          aria-label={`Switch project, current project ${dashboard.engagement.name}`}
          onClick={() => setProjectSwitcherOpen(true)}
        >
          <span className="hidden size-6 shrink-0 items-center justify-center rounded-md border bg-muted text-xs sm:flex">
            {dashboard.engagement.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate">{dashboard.engagement.name}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-4">
          <span
            className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex"
            role="status"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connection === "connected"
                  ? "bg-[var(--success)]"
                  : "bg-[var(--warning)]",
              )}
            />
            {connection === "connected"
              ? "Live updates"
              : connection === "reconnecting"
                ? "Reconnecting"
                : "Connecting"}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("approvals")}
            className="gap-2"
          >
            <ShieldEllipsis className="size-4" />
            <span className="hidden sm:inline">Approvals</span>
            <span className="tabular-nums">{pending.length}</span>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 md:grid-cols-[224px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-y-auto border-r bg-sidebar px-3 py-6 md:block">
          {nav}
        </aside>
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="min-h-0 min-w-0 overflow-y-auto overscroll-contain outline-none"
        >
          <div className="mx-auto max-w-[1440px] space-y-7 px-4 py-6 sm:px-8 sm:py-8">
            {error || connection === "reconnecting" ? (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-text)]"
              >
                <span className="flex items-center gap-2">
                  <CircleAlert className="size-4 shrink-0" />
                  {error ||
                    "Live updates interrupted. Displayed evidence may be out of date."}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refresh()}
                >
                  <RefreshCw />
                  Retry connection
                </Button>
              </div>
            ) : null}

            <section
              aria-label="Current assessment"
              className="flex flex-col gap-3 border-b pb-5 xl:flex-row xl:items-center xl:justify-between"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-medium">
                  <Globe2
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <bdi className="break-all">{dashboard.engagement.target}</bdi>
                </span>
                <span className="hidden h-4 w-px bg-border sm:block" />
                <Status value={runStatus} />
                {dashboard.engagement.id === "eng_demo" ? (
                  <Badge
                    variant="outline"
                    title="This built-in project starts with demonstration evidence. Execution mode is configured by the API."
                  >
                    Sample project
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!terminalRun && runStatus !== "planning" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act("run-state", {
                        type: "set-run-state",
                        runId,
                        status: runStatus === "paused" ? "running" : "paused",
                      })
                    }
                  >
                    {busy === "run-state" ? (
                      <Loader2 className="animate-spin motion-reduce:animate-none" />
                    ) : runStatus === "paused" ? (
                      <Play />
                    ) : (
                      <Pause />
                    )}
                    {runStatus === "paused" ? "Resume run" : "Pause run"}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    Boolean(busy) || runStatus === "paused" || terminalRun
                  }
                  onClick={() => setSpawnOpen(true)}
                >
                  <Plus />
                  Start specialist
                </Button>
                <Button
                  size="sm"
                  disabled={
                    Boolean(busy) || runStatus === "paused" || terminalRun
                  }
                  onClick={() =>
                    void act("orchestrate", { type: "orchestrate", runId })
                  }
                >
                  {busy === "orchestrate" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Play />
                  )}
                  {busy === "orchestrate"
                    ? "Planning work..."
                    : "Run orchestrator"}
                </Button>
              </div>
            </section>

            {!["registry", "scope", "report"].includes(page) ? (
              <header className="flex items-start justify-between gap-4 sm:items-end">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    {currentPage.label}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {currentPage.description}
                  </p>
                </div>
                {page === "overview" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="View report"
                    onClick={() => navigate("report")}
                  >
                    <span className="hidden sm:inline">View report</span>
                    <ArrowUpRight />
                  </Button>
                ) : null}
              </header>
            ) : null}

            {page === "overview" ? (
              <>
                <section
                  aria-label="Assessment summary"
                  className="grid grid-cols-2 gap-y-5 border-b pb-6 lg:grid-cols-4"
                >
                  {[
                    {
                      label: "Mapped assets",
                      value: dashboard.metrics.assets,
                      detail: `${dashboard.graph.edges.length} relationships`,
                      to: "assets" as const,
                      icon: Network,
                    },
                    {
                      label: "Findings",
                      value: dashboard.findings.length,
                      detail: `${highPriority.length} open high priority`,
                      to: "findings" as const,
                      icon: ShieldCheck,
                    },
                    {
                      label: "Active specialists",
                      value: dashboard.metrics.activeAgents,
                      detail: `${dashboard.agents.length} total executions`,
                      to: "specialists" as const,
                      icon: Bot,
                    },
                    {
                      label: "Pending approvals",
                      value: pending.length,
                      detail: "One-time human decisions",
                      to: "approvals" as const,
                      icon: ShieldEllipsis,
                    },
                  ].map(({ label, value, detail, to, icon: Icon }, index) => (
                    <Button
                      key={label}
                      variant="ghost"
                      onClick={() => navigate(to)}
                      className={cn(
                        "h-auto flex-col items-start gap-2 whitespace-normal rounded-none px-0 py-1 text-left hover:bg-transparent",
                        index % 2 !== 0 && "border-l pl-5",
                        index > 1 && "lg:border-l lg:pl-5",
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Icon className="size-3.5" />
                        {label}
                      </span>
                      <span className="text-3xl font-semibold tracking-tight tabular-nums">
                        {value}
                      </span>
                      <span
                        className={cn(
                          "text-xs font-normal text-muted-foreground",
                          to === "findings" &&
                            highPriority.length > 0 &&
                            "text-[var(--danger-text)]",
                          to === "approvals" &&
                            pending.length > 0 &&
                            "text-[var(--warning-text)]",
                        )}
                      >
                        {detail}
                        <ChevronRight className="ml-1 inline size-3" />
                      </span>
                    </Button>
                  ))}
                </section>

                <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
                  <section
                    className="min-w-0 overflow-hidden rounded-xl border"
                    aria-labelledby="surface-title"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <Network
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <h2
                          id="surface-title"
                          className="text-sm font-semibold"
                        >
                          Attack surface
                        </h2>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7"
                        onClick={() => navigate("assets")}
                      >
                        Explore assets
                        <ArrowUpRight />
                      </Button>
                    </header>
                    <div className="relative h-80 sm:h-96">
                      {dashboard.graph.nodes.length ? (
                        <SecurityGraph
                          nodes={dashboard.graph.nodes}
                          edges={dashboard.graph.edges}
                          layoutId={dashboard.engagement.id}
                          onSelect={inspectNode}
                          selectedId={selectedNode?.id}
                        />
                      ) : (
                        <EmptyState
                          title="Your asset map starts here"
                          description="Run the orchestrator or start a specialist to discover authorized assets and their relationships."
                        />
                      )}
                    </div>
                    <footer className="flex items-center gap-2 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
                      <span
                        className="size-1.5 rounded-full bg-[var(--info)]"
                        aria-hidden="true"
                      />
                      Select an asset to inspect its provenance.
                    </footer>
                  </section>
                  <section
                    aria-labelledby="attention-title"
                    className="order-first flex min-w-0 flex-col xl:order-last"
                  >
                    <header className="mb-4 flex items-center justify-between">
                      <h2
                        id="attention-title"
                        className="text-sm font-semibold"
                      >
                        Needs your attention
                      </h2>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {pending.length + highPriority.length}
                      </span>
                    </header>
                    {pending.length > 0 ? (
                      <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--warning-text)]">
                          <ShieldEllipsis className="size-4" />
                          {pending.length}{" "}
                          {pending.length === 1 ? "decision" : "decisions"}{" "}
                          pending
                        </div>
                        <h3 className="mt-3 text-sm font-semibold leading-6">
                          {pending[0]!.title}
                        </h3>
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                          {pending[0]!.rationale}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-4 w-full justify-between bg-background"
                          onClick={() => navigate("approvals")}
                        >
                          Review {pending.length === 1 ? "request" : "requests"}
                          <ArrowRight />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 rounded-xl border p-4">
                        <Check className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                        <div>
                          <p className="text-sm font-medium">
                            No decisions waiting
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Requests for additional authority appear here.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="mt-4 divide-y">
                      {highPriority.slice(0, 2).map((finding) => (
                        <Button
                          key={finding.id}
                          variant="ghost"
                          className="h-auto w-full items-start justify-start whitespace-normal rounded-none px-0 py-4 text-left"
                          onClick={() => setFindingId(finding.id)}
                        >
                          <div className="min-w-0 space-y-2">
                            <SeverityBadge severity={finding.severity} />
                            <p className="text-sm font-medium leading-5">
                              {finding.title}
                            </p>
                            <p className="truncate text-xs font-normal text-muted-foreground">
                              {finding.assetLabel}
                            </p>
                          </div>
                          <ChevronRight className="ml-auto mt-1 shrink-0 text-muted-foreground" />
                        </Button>
                      ))}
                      {!highPriority.length && (
                        <p className="py-4 text-xs leading-5 text-muted-foreground">
                          No open high-priority findings recorded. Review
                          coverage before drawing conclusions.
                        </p>
                      )}
                    </div>
                  </section>
                </div>

                <section
                  className="min-w-0 space-y-3"
                  aria-labelledby="recent-findings-title"
                >
                  <header className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <h2
                        id="recent-findings-title"
                        className="text-sm font-semibold"
                      >
                        Priority findings
                      </h2>
                      <Badge variant="secondary">
                        {dashboard.findings.length}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("findings")}
                    >
                      View all findings
                      <ArrowRight />
                    </Button>
                  </header>
                  <div className="overflow-hidden rounded-xl border">
                    <FindingsTable
                      findings={sortedFindings.slice(0, 4)}
                      onSelect={(finding) => setFindingId(finding.id)}
                      compact
                    />
                  </div>
                </section>
              </>
            ) : page === "registry" ? (
              <RegistryView
                agents={agents}
                onInstall={async (manifest) => {
                  const result = await execute({
                    type: "install-manifest",
                    manifest,
                  });
                  setNotice({ text: result.message, error: false });
                }}
              />
            ) : page === "scope" ? (
              <ScopeView
                dashboard={dashboard}
                selectedNodeId={selectedNode?.id}
                onInspect={inspectNode}
                onAdd={async (rule) => {
                  await execute({
                    type: "add-scope-rule",
                    projectId: dashboard.engagement.id,
                    rule,
                  });
                }}
                onRemove={async (ruleId) => {
                  await execute({
                    type: "remove-scope-rule",
                    projectId: dashboard.engagement.id,
                    ruleId,
                  });
                }}
              />
            ) : page === "report" ? (
              <ReportView
                report={report}
                loading={reportLoading && !report}
                error={reportError}
                onRetry={() => setReportRetry((value) => value + 1)}
                apiUrl={apiUrl}
                projectId={dashboard.engagement.id}
                onSelectFinding={(finding) => setFindingId(finding.id)}
              />
            ) : (
              <section
                className="min-w-0 space-y-4"
                aria-label={`${currentPage.label} workspace`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  {search}
                  <div className="flex flex-wrap items-center gap-2">
                    {page === "findings" ? (
                      <>
                        <NativeSelect
                          className="h-9"
                          wrapperClassName="w-auto"
                          aria-label="Filter by severity"
                          value={severity}
                          onChange={(event) => setSeverity(event.target.value)}
                        >
                          <option value="all">All severities</option>
                          {Object.keys(severityOrder).map((value) => (
                            <option key={value} value={value}>
                              {value[0]!.toUpperCase() + value.slice(1)}
                            </option>
                          ))}
                        </NativeSelect>
                        <NativeSelect
                          className="h-9"
                          wrapperClassName="w-auto"
                          aria-label="Sort findings"
                          value={findingOrder}
                          onChange={(event) =>
                            setFindingOrder(event.target.value)
                          }
                        >
                          <option value="severity">Highest severity</option>
                          <option value="newest">Newest first</option>
                        </NativeSelect>
                      </>
                    ) : null}
                    {page === "assets" || page === "specialists" ? (
                      <ToggleGroup
                        type="single"
                        aria-label="Evidence presentation"
                        value={presentation}
                        onValueChange={(value) => {
                          if (value) setPresentation(value);
                        }}
                      >
                        <ToggleGroupItem value="list">
                          <List className="size-4" />
                          List
                        </ToggleGroupItem>
                        <ToggleGroupItem value="graph">
                          <GitFork className="size-4" />
                          Graph
                        </ToggleGroupItem>
                      </ToggleGroup>
                    ) : null}
                    {page === "approvals" ? (
                      <ToggleGroup
                        type="single"
                        aria-label="Approval status"
                        value={approvalTab}
                        onValueChange={(value) => {
                          if (value) setApprovalTab(value);
                        }}
                      >
                        <ToggleGroupItem value="pending">
                          Pending {pending.length}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="history">
                          History
                        </ToggleGroupItem>
                      </ToggleGroup>
                    ) : null}
                    {page === "activity" ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ArrowDown className="size-3.5" />
                        Newest first
                      </span>
                    ) : null}
                  </div>
                </div>
                {normalizedQuery || severity !== "all" ? (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <p role="status">
                      {page === "findings"
                        ? visibleFindings.length
                        : page === "assets"
                          ? visibleNodes.length
                          : page === "specialists"
                            ? visibleAgents.length
                            : page === "activity"
                              ? visibleLogs.length
                              : visibleApprovals.length}{" "}
                      results{normalizedQuery ? ` for "${query.trim()}"` : ""}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setSeverity("all");
                      }}
                    >
                      Clear filters
                      <X />
                    </Button>
                  </div>
                ) : null}
                {page === "findings" ? (
                  <div className="overflow-hidden rounded-xl border">
                    <FindingsTable
                      findings={visibleFindings}
                      onSelect={(finding) => setFindingId(finding.id)}
                    />
                  </div>
                ) : page === "assets" ? (
                  presentation === "graph" ? (
                    <div className="relative h-[min(65dvh,640px)] min-h-80 overflow-hidden rounded-xl border">
                      {visibleNodes.length ? (
                        <SecurityGraph
                          nodes={visibleNodes}
                          edges={dashboard.graph.edges.filter(
                            (edge) =>
                              nodeIds.has(edge.source) &&
                              nodeIds.has(edge.target),
                          )}
                          layoutId={dashboard.engagement.id}
                          selectedId={selectedNode?.id}
                          onSelect={inspectNode}
                        />
                      ) : (
                        <EmptyState
                          title="No matching assets"
                          description="Clear the search or run a specialist to record authorized assets."
                        />
                      )}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border">
                      <AssetsTable
                        nodes={visibleNodes}
                        onSelect={inspectNode}
                      />
                    </div>
                  )
                ) : page === "specialists" ? (
                  presentation === "graph" ? (
                    <div className="relative h-[min(65dvh,640px)] min-h-80 overflow-hidden rounded-xl border">
                      {visibleAgents.length ? (
                        <SwarmGraph
                          agents={visibleAgents}
                          findings={dashboard.findings}
                          layoutId={dashboard.engagement.id}
                          selectedId={selectedAgent?.id}
                          onSelectAgent={(id) =>
                            setSelection({ kind: "agent", id })
                          }
                          onSelectFinding={(finding) =>
                            setFindingId(finding.id)
                          }
                        />
                      ) : (
                        <EmptyState
                          title="No matching specialists"
                          description="Clear the search or start an enabled specialist from the catalog."
                        />
                      )}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border">
                      <SpecialistsTable
                        agents={visibleAgents}
                        onSelect={(agent) =>
                          setSelection({ kind: "agent", id: agent.id })
                        }
                      />
                    </div>
                  )
                ) : page === "activity" ? (
                  <div className="overflow-hidden rounded-xl border">
                    <ActivityList
                      logs={visibleLogs}
                      agents={dashboard.agents}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {visibleApprovals.map((approval) =>
                      approval.status === "pending" ? (
                        <ApprovalCard
                          key={approval.id}
                          approval={approval}
                          busy={Boolean(busy)}
                          onDecision={(decision) =>
                            void act(approval.id, {
                              type: "decide",
                              approvalId: approval.id,
                              decision,
                            })
                          }
                        />
                      ) : (
                        <article
                          key={approval.id}
                          className="rounded-xl border p-5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-sm font-semibold">
                              {approval.title}
                            </h2>
                            <Badge
                              variant={
                                approval.status === "denied"
                                  ? "destructive"
                                  : "secondary"
                              }
                              className="capitalize"
                            >
                              {approval.status.charAt(0).toUpperCase() +
                                approval.status.slice(1)}
                            </Badge>
                          </div>
                          <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
                            {approval.requestedAction}
                          </p>
                          <p className="mt-3 text-xs text-muted-foreground">
                            Requested by {approval.requestedBy}{" "}
                            <span aria-hidden="true">/</span>{" "}
                            <time dateTime={approval.createdAt}>
                              {new Date(approval.createdAt).toLocaleString()}
                            </time>
                          </p>
                        </article>
                      ),
                    )}
                    {!visibleApprovals.length ? (
                      <EmptyState
                        title={
                          normalizedQuery
                            ? "No matching requests"
                            : approvalTab === "pending"
                              ? "No approvals waiting"
                              : "No decisions recorded"
                        }
                        description={
                          normalizedQuery
                            ? "Try another search or clear the filter."
                            : approvalTab === "pending"
                              ? "When a specialist needs additional authority, its exact request will appear here for your review."
                              : "Approved, denied, and expired requests will remain here for review."
                        }
                      />
                    ) : null}
                  </div>
                )}
              </section>
            )}

            <footer className="flex flex-wrap items-center justify-between gap-2 border-t pt-5 text-xs text-muted-foreground">
              <span>
                HiveSwarm Alpha
                <span className="mx-2 text-border" aria-hidden="true">
                  /
                </span>
                Trusted-local-operator workspace
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-3" aria-hidden="true" />
                Project started{" "}
                <time dateTime={dashboard.engagement.startedAt}>
                  {new Date(
                    dashboard.engagement.startedAt,
                  ).toLocaleDateString()}
                </time>
              </span>
            </footer>
          </div>
        </main>
      </div>

      {notice ? (
        <div
          className="fixed inset-x-4 bottom-4 z-40 flex items-start gap-3 rounded-xl border bg-background p-4 shadow-lg sm:left-auto sm:max-w-md"
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? (
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <Check className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
          )}
          <p className="min-w-0 break-words text-sm leading-5">{notice.text}</p>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 ml-auto size-8 shrink-0"
            aria-label="Dismiss message"
            onClick={() => setNotice(null)}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-72 bg-sidebar px-3">
          <SheetHeader className="px-3">
            <SheetTitle className="flex items-center gap-2">
              <HiveMark small />
              HiveSwarm
            </SheetTitle>
            <SheetDescription>Navigate the current project.</SheetDescription>
          </SheetHeader>
          {nav}
        </SheetContent>
      </Sheet>
      <Sheet
        open={Boolean(selection)}
        onOpenChange={(open) => {
          if (!open) {
            setSelection(null);
            setScopeNode(null);
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <div className="mb-2 text-muted-foreground">
              {selectedNode ? (
                <Network className="size-5" />
              ) : (
                <Bot className="size-5" />
              )}
            </div>
            <SheetTitle className="break-words text-xl">
              {selectedNode?.label ??
                selectedAgent?.agentName ??
                "Selection unavailable"}
            </SheetTitle>
            <SheetDescription className="break-words">
              {selectedNode?.subtitle ??
                selectedAgent?.task ??
                "This item is no longer present in the current evidence."}
            </SheetDescription>
          </SheetHeader>
          {selectedNode ? (
            <>
              <dl className="divide-y text-sm">
                {[
                  ["Type", selectedNode.kind],
                  ["Status", selectedNode.status ?? "Observed"],
                  [
                    "Discovered by",
                    selectedNode.discoveredBy ?? "Not recorded",
                  ],
                  [
                    "Recorded",
                    new Date(selectedNode.createdAt).toLocaleString(),
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <section>
                <h3 className="text-sm font-semibold">Recorded metadata</h3>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-6">
                  {Object.keys(selectedNode.metadata).length
                    ? JSON.stringify(selectedNode.metadata, null, 2)
                    : "No additional metadata recorded."}
                </pre>
              </section>
              <section>
                <h3 className="mb-3 text-sm font-semibold">Relationships</h3>
                <div className="divide-y">
                  {dashboard.graph.edges
                    .filter(
                      (edge) =>
                        edge.source === selectedNode.id ||
                        edge.target === selectedNode.id,
                    )
                    .map((edge) => {
                      const related = dashboard.graph.nodes.find(
                        (node) =>
                          node.id ===
                          (edge.source === selectedNode.id
                            ? edge.target
                            : edge.source),
                      );
                      return related ? (
                        <Button
                          key={edge.id}
                          variant="ghost"
                          className="h-auto w-full justify-between whitespace-normal px-0 py-3 text-left"
                          onClick={() => inspectNode(related)}
                        >
                          <span className="min-w-0">
                            <span className="block text-xs font-normal text-muted-foreground">
                              {edge.relationship}
                            </span>
                            <span className="break-all">{related.label}</span>
                          </span>
                          <ChevronRight className="shrink-0" />
                        </Button>
                      ) : null;
                    })}
                </div>
                {!dashboard.graph.edges.some(
                  (edge) =>
                    edge.source === selectedNode.id ||
                    edge.target === selectedNode.id,
                ) && (
                  <p className="text-sm text-muted-foreground">
                    No relationships recorded.
                  </p>
                )}
              </section>
            </>
          ) : selectedAgent ? (
            <>
              <Status value={selectedAgent.status} />
              <dl className="divide-y text-sm">
                {[
                  ["Target", selectedAgent.target],
                  ["Lifecycle", selectedAgent.lifecycle],
                  ["Depth", `${selectedAgent.depth} of 5`],
                  [
                    "Parent",
                    dashboard.agents.find(
                      (agent) => agent.id === selectedAgent.parentAgentRunId,
                    )?.agentName ?? "Root execution",
                  ],
                  ["Events", String(selectedAgent.logCount)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 py-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <section>
                <h3 className="text-sm font-semibold">
                  Requested capabilities
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedAgent.requestedCapabilities.map((capability) => (
                    <Badge
                      key={capability}
                      variant="outline"
                      className="font-mono text-xs"
                    >
                      {capability}
                    </Badge>
                  ))}
                  {!selectedAgent.requestedCapabilities.length && (
                    <p className="text-sm text-muted-foreground">
                      No capabilities requested.
                    </p>
                  )}
                </div>
              </section>
              {selectedAgent.executionPlan.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold">
                    Reviewed command plan
                  </h3>
                  <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 font-mono text-xs leading-6">
                    {selectedAgent.executionPlan
                      .map((step) => step.command)
                      .join("\n")}
                  </pre>
                </section>
              )}
              <section>
                <h3 className="mb-3 text-sm font-semibold">Recent output</h3>
                <div className="space-y-3">
                  {dashboard.logs
                    .filter((log) => log.agentRunId === selectedAgent.id)
                    .slice(-5)
                    .reverse()
                    .map((log) => (
                      <p
                        key={log.id}
                        className="break-words rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5"
                      >
                        {log.message}
                      </p>
                    ))}
                  {!dashboard.logs.some(
                    (log) => log.agentRunId === selectedAgent.id,
                  ) && (
                    <p className="text-sm text-muted-foreground">
                      No output recorded yet.
                    </p>
                  )}
                </div>
              </section>
              {selectedAgent.depth > 0 &&
              !["completed", "failed", "terminated"].includes(
                selectedAgent.status,
              ) ? (
                <Button
                  variant="destructive"
                  className="mt-auto"
                  disabled={Boolean(busy)}
                  onClick={() => setTerminateId(selectedAgent.id)}
                >
                  Terminate specialist
                </Button>
              ) : null}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(terminateId)}
        onOpenChange={(open) => {
          if (!open) setTerminateId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terminate this specialist?</DialogTitle>
            <DialogDescription>
              {
                dashboard.agents.find((agent) => agent.id === terminateId)
                  ?.agentName
              }
              's current task will stop and cannot be resumed. Recorded evidence
              will remain available.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTerminateId(null)}>
              Keep running
            </Button>
            <Button
              variant="destructive"
              disabled={Boolean(busy)}
              onClick={() => {
                if (terminateId)
                  void act("terminate", {
                    type: "terminate-agent",
                    agentRunId: terminateId,
                  }).then(() => setTerminateId(null));
              }}
            >
              Terminate specialist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SpawnDialog
        open={spawnOpen}
        agents={agents}
        parentAgents={dashboard.agents}
        target={dashboard.engagement.target}
        onClose={() => setSpawnOpen(false)}
        onSpawn={spawn}
      />
      <EngagementDialog
        open={engagementOpen}
        onClose={() => setEngagementOpen(false)}
        onCreate={async (input) => {
          await execute({ type: "create-project", ...input });
        }}
      />
      <ProjectSwitcher
        open={projectSwitcherOpen}
        projects={projects}
        activeProjectId={activeProjectId}
        onClose={() => setProjectSwitcherOpen(false)}
        onSelect={async (projectId) => {
          await execute({ type: "switch-project", projectId });
        }}
        onNew={() => setEngagementOpen(true)}
      />
      <FindingDrawer
        finding={selectedFinding}
        dashboard={dashboard}
        onClose={() => setFindingId(null)}
      />
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
      <Network
        className="mb-4 size-6 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
