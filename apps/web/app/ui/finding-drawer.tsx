"use client";

import type { Dashboard, Finding, GraphNode } from "@hiveswarm/contracts";
import { Braces, Route, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FindingPathGraph } from "./security-graph";
import { SeverityBadge } from "./status";

export function FindingDrawer({ finding, dashboard, onClose }: { finding: Finding | null; dashboard: Dashboard; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (finding && !dialog.open) dialog.showModal();
    if (!finding && dialog.open) dialog.close();
    if (!finding) setSelectedNode(null);
  }, [finding]);
  return (
    <dialog ref={ref} className="finding-drawer" onClose={onClose} onCancel={onClose} aria-labelledby="finding-drawer-title">
      {finding ? <div className="finding-drawer__surface">
        <header className="finding-drawer__header">
          <div><p className="eyebrow">Finding evidence</p><SeverityBadge severity={finding.severity} /><h2 id="finding-drawer-title">{finding.title}</h2><p>{finding.summary}</p></div>
          <button type="button" className="icon-button" aria-label="Close finding" onClick={onClose}><X size={19} aria-hidden="true" /></button>
        </header>
        <dl className="finding-facts"><div><dt>Asset</dt><dd><bdi>{finding.assetLabel}</bdi></dd></div><div><dt>Confidence</dt><dd>{Math.round(finding.confidence * 100)}%</dd></div><div><dt>Status</dt><dd>{finding.status}</dd></div><div><dt>Raised by</dt><dd>{finding.discoveredBy}</dd></div></dl>
        <section className="finding-path-panel" aria-labelledby="finding-path-title">
          <div className="section-label"><h3 id="finding-path-title">Evidence chain</h3><Route size={15} aria-hidden="true" /></div>
          <div className="finding-path-graph"><FindingPathGraph dashboard={dashboard} finding={finding} onSelect={setSelectedNode} /></div>
          {selectedNode ? <div className="structured-peek"><Braces size={15} aria-hidden="true" /><div><strong>{selectedNode.label}</strong><small>{selectedNode.kind} · {selectedNode.status ?? "observed"}</small></div><code>{JSON.stringify(selectedNode.metadata, null, 2)}</code></div> : null}
        </section>
        <section className="finding-section"><h3>Evidence</h3><ul>{finding.evidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section className="finding-section finding-section--action"><h3>Recommended action</h3><p>{finding.remediation ?? "Validate the issue and define a risk-appropriate corrective action."}</p></section>
      </div> : null}
    </dialog>
  );
}
