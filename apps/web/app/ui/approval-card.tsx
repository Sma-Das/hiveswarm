"use client";

import type { Approval } from "@hiveswarm/contracts";
import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: Approval;
  busy: boolean;
  detailId?: string;
  onDecision: (decision: "approved" | "denied") => void;
}) {
  const id = useId();
  const changesScope = approval.context.kind === "scope_proposal";
  return (
    <article
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      className="min-w-0 rounded-lg border border-border bg-background p-5 text-foreground"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert
          className="mt-0.5 size-5 shrink-0 text-[var(--warning-text)]"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3
            id={`${id}-title`}
            className="break-words text-base font-semibold leading-snug"
          >
            {approval.title}
          </h3>
          <Badge variant="secondary" className="mt-2">
            {approval.status === "pending"
              ? "Decision required"
              : approval.status.charAt(0).toUpperCase() +
                approval.status.slice(1)}
          </Badge>
        </div>
      </div>
      <dl className="mt-5 grid gap-x-6 gap-y-3 border-y border-border py-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Requested by</dt>
          <dd className="mt-1 break-words font-medium">
            {approval.requestedBy}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Request type</dt>
          <dd className="mt-1 capitalize">
            {approval.type.replaceAll("_", " ")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Run</dt>
          <dd className="mt-1 break-all font-mono text-xs">{approval.runId}</dd>
        </div>
        {approval.agentRunId ? (
          <div className="min-w-0">
            <dt className="text-muted-foreground">Agent run</dt>
            <dd className="mt-1 break-all font-mono text-xs">
              {approval.agentRunId}
            </dd>
          </div>
        ) : null}
      </dl>
      <section aria-labelledby={`${id}-rationale`} className="mt-5 space-y-2">
        <h4 id={`${id}-rationale`} className="text-sm font-semibold">
          Rationale
        </h4>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {approval.rationale}
        </p>
      </section>
      <section aria-labelledby={`${id}-action`} className="mt-5 space-y-2">
        <h4 id={`${id}-action`} className="text-sm font-semibold">
          Requested action
        </h4>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
          {approval.requestedAction}
        </pre>
      </section>
      {Object.keys(approval.context).length ? (
        <section aria-labelledby={`${id}-context`} className="mt-5 space-y-2">
          <h4 id={`${id}-context`} className="text-sm font-semibold">
            Request context
          </h4>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
            {JSON.stringify(approval.context, null, 2)}
          </pre>
        </section>
      ) : null}
      <p className="mt-5 rounded-lg bg-[var(--warning-soft)] p-3 text-sm leading-relaxed text-[var(--warning-text)]">
        {changesScope
          ? "Approving this proposal adds the requested allow rule to this project and can remove a matching exact deny rule. The scope change remains in effect until you change it in Scope."
          : "Approval applies to this execution request once. It does not grant reusable capability permission."}
      </p>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={busy || approval.status !== "pending"}
          onClick={() => onDecision("denied")}
        >
          Deny request
        </Button>
        <Button
          type="button"
          disabled={busy || approval.status !== "pending"}
          onClick={() => onDecision("approved")}
        >
          {busy
            ? "Saving decision..."
            : changesScope
              ? "Approve scope change"
              : "Approve once"}
        </Button>
      </div>
    </article>
  );
}
