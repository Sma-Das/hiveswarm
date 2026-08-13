"use client";

import type { Approval } from "@hiveswarm/contracts";
import { ShieldAlert } from "lucide-react";

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 1) return "now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

export function ApprovalCard({
  approval,
  busy,
  onDecision,
}: {
  approval: Approval;
  busy: boolean;
  onDecision: (decision: "approved" | "denied") => void;
}) {
  return (
    <article className="approval-card">
      <div className="approval-card__heading">
        <span className="approval-card__icon">
          <ShieldAlert size={17} strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h3>{approval.title}</h3>
          <span className="decision-label">Human decision required</span>
        </div>
      </div>
      <p className="approval-card__rationale">{approval.rationale}</p>
      <div className="approval-card__request">
        <strong>Requested action</strong>
        <p>{approval.requestedAction}</p>
        <small>
          Requested by {approval.requestedBy} ·{" "}
          {relativeTime(approval.createdAt)}
        </small>
      </div>
      <div className="approval-card__actions">
        <button
          className="button button--quiet"
          disabled={busy}
          onClick={() => onDecision("denied")}
        >
          Deny request
        </button>
        <button
          className="button button--primary"
          disabled={busy}
          onClick={() => onDecision("approved")}
        >
          {busy ? "Saving decision" : "Approve once"}
        </button>
      </div>
    </article>
  );
}
