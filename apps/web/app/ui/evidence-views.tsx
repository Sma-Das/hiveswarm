"use client";

import type {
  AgentRun,
  Finding,
  GraphNode,
  LogEntry,
} from "@hiveswarm/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SeverityBadge, Status } from "./status";

export type FindingsTableProps = {
  findings: Finding[];
  onSelect: (finding: Finding) => void;
  compact?: boolean;
};

export type AssetsTableProps = {
  nodes: GraphNode[];
  onSelect: (node: GraphNode) => void;
};

export type SpecialistsTableProps = {
  agents: AgentRun[];
  onSelect: (agent: AgentRun) => void;
};

export type ActivityListProps = {
  logs: LogEntry[];
  agents: AgentRun[];
};

export function FindingsTable({
  findings,
  onSelect,
  compact = false,
}: FindingsTableProps) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden bg-background text-foreground">
      <Table
        className={compact ? "min-w-96 table-auto" : "min-w-[44rem] table-auto"}
      >
        <TableCaption className="sr-only">
          Findings. Select a title to inspect its evidence.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Severity</TableHead>
            <TableHead scope="col">Finding</TableHead>
            <TableHead scope="col">Asset</TableHead>
            {!compact && (
              <TableHead scope="col" className="text-right">
                Confidence
              </TableHead>
            )}
            {!compact && <TableHead scope="col">Status</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={compact ? 3 : 5}
                className="py-10 text-center"
              >
                <p className="font-medium">No findings to display</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review filters and run activity. An empty view does not
                  establish assessment coverage.
                </p>
              </TableCell>
            </TableRow>
          ) : (
            findings.map((finding) => (
              <TableRow key={finding.id}>
                <TableCell className="align-top">
                  <SeverityBadge severity={finding.severity} />
                </TableCell>
                <TableCell className="min-w-48 max-w-lg align-top">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left leading-6 [overflow-wrap:anywhere]"
                    onClick={() => onSelect(finding)}
                  >
                    {finding.title}
                  </Button>
                  {!compact && (
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {finding.summary}
                    </p>
                  )}
                </TableCell>
                <TableCell className="min-w-32 max-w-64 align-top text-muted-foreground [overflow-wrap:anywhere]">
                  {finding.assetLabel}
                </TableCell>
                {!compact && (
                  <TableCell className="align-top text-right tabular-nums">
                    {Math.round(finding.confidence * 100)}%
                  </TableCell>
                )}
                {!compact && (
                  <TableCell className="align-top">
                    <Badge variant="outline" className="capitalize">
                      {finding.status}
                    </Badge>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function AssetsTable({ nodes, onSelect }: AssetsTableProps) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden bg-background text-foreground">
      <Table className="min-w-[36rem] table-auto">
        <TableCaption className="sr-only">
          Assets. Select an asset to inspect its recorded details.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Asset</TableHead>
            <TableHead scope="col">Type</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Discovered by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="py-10 text-center">
                <p className="font-medium">No assets to display</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review filters and discovery activity for recorded assets.
                </p>
              </TableCell>
            </TableRow>
          ) : (
            nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell className="min-w-48 max-w-lg align-top">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left leading-6 [overflow-wrap:anywhere]"
                    onClick={() => onSelect(node)}
                  >
                    {node.label}
                  </Button>
                  {node.subtitle && (
                    <p className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                      {node.subtitle}
                    </p>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="secondary" className="capitalize">
                    {node.kind}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-48 align-top">
                  {node.status ? (
                    <Badge
                      variant="outline"
                      className="whitespace-normal break-words capitalize [overflow-wrap:anywhere]"
                    >
                      {node.status.replaceAll("_", " ")}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                </TableCell>
                <TableCell className="max-w-64 align-top text-muted-foreground [overflow-wrap:anywhere]">
                  {node.discoveredBy || "Not recorded"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function SpecialistsTable({ agents, onSelect }: SpecialistsTableProps) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <div className="min-w-0 max-w-full overflow-hidden bg-background text-foreground">
      <Table className="min-w-[48rem] table-auto">
        <TableCaption className="sr-only">
          Specialist executions, assignments, and lifecycle states. Select a
          name to inspect an agent run.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Specialist / Task</TableHead>
            <TableHead scope="col">Target</TableHead>
            <TableHead scope="col">Lifecycle</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Depth / Parent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center">
                <p className="font-medium">
                  No specialist executions to display
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review filters or start approved work to see specialist
                  assignments here.
                </p>
              </TableCell>
            </TableRow>
          ) : (
            agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="min-w-64 max-w-lg align-top">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left leading-6 [overflow-wrap:anywhere]"
                    onClick={() => onSelect(agent)}
                  >
                    {agent.agentName}
                  </Button>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                    {agent.task}
                  </p>
                </TableCell>
                <TableCell className="min-w-36 max-w-64 align-top text-muted-foreground [overflow-wrap:anywhere]">
                  {agent.target}
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline">
                    {agent.lifecycle === "session" ? "Session" : "Task"}
                  </Badge>
                </TableCell>
                <TableCell className="align-top">
                  <Status value={agent.status} />
                </TableCell>
                <TableCell className="min-w-36 max-w-56 align-top">
                  <p className="tabular-nums">Depth {agent.depth}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                    {agent.parentAgentRunId
                      ? `Parent: ${agentsById.get(agent.parentAgentRunId)?.agentName ?? agent.parentAgentRunId}`
                      : "Root agent run"}
                  </p>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function ActivityList({ logs, agents }: ActivityListProps) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const newestFirst = logs
    .map((log) => ({ log, time: Date.parse(log.timestamp) }))
    .sort(
      (a, b) =>
        (Number.isNaN(b.time) ? -Infinity : b.time) -
        (Number.isNaN(a.time) ? -Infinity : a.time),
    );
  const levelLabels = {
    debug: "Debug",
    info: "Info",
    warn: "Warning",
    error: "Error",
  };

  if (logs.length === 0) {
    return (
      <div className="bg-background px-4 py-10 text-center text-foreground">
        <p className="font-medium">No activity to display</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Review filters and run state. Logs appear here when execution reports
          activity.
        </p>
      </div>
    );
  }

  return (
    <ol
      aria-label="Execution activity, newest first"
      className="min-w-0 max-w-full divide-y divide-border bg-background text-foreground"
    >
      {newestFirst.map(({ log, time }) => (
        <li key={log.id} className="px-4 py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <Badge variant={log.level === "error" ? "destructive" : "outline"}>
              {levelLabels[log.level]}
            </Badge>
            <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              Source:{" "}
              {agentsById.get(log.agentRunId)?.agentName ??
                (log.agentRunId || "Not recorded")}
            </span>
            {Number.isNaN(time) ? (
              <span className="text-muted-foreground">Time unavailable</span>
            ) : (
              <time
                dateTime={log.timestamp}
                className="text-muted-foreground tabular-nums sm:ml-auto"
                suppressHydrationWarning
              >
                {new Date(time).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "medium",
                })}
              </time>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
            {log.message}
          </p>
        </li>
      ))}
    </ol>
  );
}
