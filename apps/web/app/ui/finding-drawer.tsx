"use client";

import {
  findingEvidencePath,
  type Dashboard,
  type Finding,
  type GraphNode,
} from "@hiveswarm/contracts";
import { Braces, Route } from "lucide-react";
import { useId, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FindingPathGraph } from "./security-graph";
import { SeverityBadge } from "./status";

export function FindingDrawer({
  finding,
  dashboard,
  onClose,
}: {
  finding: Finding | null;
  dashboard: Dashboard;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(finding)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {finding ? (
        <FindingDetails
          key={`${dashboard.engagement.id}:${finding.id}`}
          finding={finding}
          dashboard={dashboard}
        />
      ) : null}
    </Sheet>
  );
}

function FindingDetails({
  finding,
  dashboard,
}: {
  finding: Finding;
  dashboard: Dashboard;
}) {
  const id = useId();
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const currentNode = selectedNode
    ? findingEvidencePath(dashboard, finding).nodes.find(
        (node) => node.id === selectedNode.id,
      )
    : undefined;
  const hasRecordedPath = dashboard.graph.nodes.some(
    (node) => node.metadata.findingId === finding.id,
  );
  return (
    <SheetContent className="w-full gap-8 p-5 sm:max-w-3xl sm:p-8">
      <SheetHeader className="gap-3">
        <SeverityBadge severity={finding.severity} />
        <SheetTitle className="break-words text-2xl leading-snug">
          {finding.title}
        </SheetTitle>
        <SheetDescription className="whitespace-pre-wrap break-words">
          {finding.summary}
        </SheetDescription>
      </SheetHeader>
      <section aria-labelledby={`${id}-facts`}>
        <h3 id={`${id}-facts`} className="sr-only">
          Finding details
        </h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <div className="col-span-2 min-w-0">
            <dt className="text-muted-foreground">Asset</dt>
            <dd className="mt-1 break-all font-medium">
              <bdi>{finding.assetLabel}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd className="mt-1 font-medium tabular-nums">
              {Math.round(finding.confidence * 100)}%
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd className="mt-1 font-medium capitalize">{finding.status}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Raised by</dt>
            <dd className="mt-1 break-words">{finding.discoveredBy}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="mt-1 break-words">
              <time dateTime={finding.createdAt}>{finding.createdAt}</time>
            </dd>
          </div>
          {finding.agentRunId ? (
            <div className="col-span-2 min-w-0">
              <dt className="text-muted-foreground">Agent run</dt>
              <dd className="mt-1 break-all font-mono text-xs">
                {finding.agentRunId}
              </dd>
            </div>
          ) : null}
          <div className="col-span-2 min-w-0">
            <dt className="text-muted-foreground">Finding ID</dt>
            <dd className="mt-1 break-all font-mono text-xs">{finding.id}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby={`${id}-path`} className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 id={`${id}-path`} className="text-base font-semibold">
            Evidence chain
          </h3>
          <Route className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {hasRecordedPath
            ? "Select a node to inspect its recorded metadata."
            : "No linked evidence chain has been recorded. This graph shows the asset and finding from the finding record, not an independently observed path."}
        </p>
        <div className="relative h-72 min-h-72 overflow-hidden rounded-md border border-border bg-muted/30 sm:h-80 sm:min-h-80">
          <FindingPathGraph
            dashboard={dashboard}
            finding={finding}
            selectedId={currentNode?.id}
            fitRequestKey={finding.id}
            onSelect={setSelectedNode}
          />
        </div>
        {currentNode ? (
          <section
            aria-labelledby={`${id}-node`}
            className="space-y-3 rounded-md bg-muted p-4"
          >
            <div className="flex items-start gap-2">
              <Braces
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h4
                  id={`${id}-node`}
                  className="break-words text-sm font-semibold"
                >
                  {currentNode.label}
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentNode.kind}
                  {currentNode.status ? ` / ${currentNode.status}` : ""}
                </p>
              </div>
            </div>
            {Object.keys(currentNode.metadata).length ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {JSON.stringify(currentNode.metadata, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                No structured metadata recorded for this node.
              </p>
            )}
          </section>
        ) : null}
      </section>
      <section
        aria-labelledby={`${id}-evidence`}
        className="space-y-3 border-t border-border pt-6"
      >
        <h3 id={`${id}-evidence`} className="text-base font-semibold">
          Evidence
        </h3>
        {finding.evidence.length ? (
          <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed marker:text-muted-foreground">
            {finding.evidence.map((item, index) => (
              <li
                key={`${index}-${item}`}
                className="whitespace-pre-wrap break-words pl-1"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            No evidence entries have been recorded for this finding. Review the
            evidence chain and execution logs before drawing conclusions.
          </p>
        )}
      </section>
      <section
        aria-labelledby={`${id}-remediation`}
        className="space-y-3 border-t border-border pt-6"
      >
        <h3 id={`${id}-remediation`} className="text-base font-semibold">
          Recommended action
        </h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {finding.remediation ||
            "No remediation has been recorded. Validate the finding and define a risk-appropriate corrective action."}
        </p>
      </section>
    </SheetContent>
  );
}
