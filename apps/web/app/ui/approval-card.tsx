"use client";

import type { Approval } from "@hiveswarm/contracts";
import { ArrowUpRight, ShieldAlert } from "lucide-react";

export function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (decision: "approved" | "denied") => void }) {
  return (
    <article className="approval-card">
      <div className="approval-card__heading">
        <span className="approval-card__icon"><ShieldAlert size={17} strokeWidth={2} aria-hidden="true" /></span>
        <div><p className="eyebrow">Human decision</p><h3>{approval.title}</h3></div>
      </div>
      <p>{approval.rationale}</p>
      <button className="text-link" onClick={() => document.getElementById("approval-detail")?.scrollIntoView()}>
        Review requested action <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <div className="approval-card__actions">
        <button className="button button--quiet" disabled={busy} onClick={() => onDecision("denied")}>Deny request</button>
        <button className="button button--primary" disabled={busy} onClick={() => onDecision("approved")}>{busy ? "Saving decision" : "Approve once"}</button>
      </div>
    </article>
  );
}
