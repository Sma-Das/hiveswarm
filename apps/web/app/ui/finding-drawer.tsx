"use client";

import type { Dashboard, Finding, GraphNode } from "@hiveswarm/contracts";
import { Braces, Route, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FindingPathGraph } from "./security-graph";
import { SeverityBadge } from "./status";

const drawerTransitionMs = 180;

export function FindingDrawer({ finding, dashboard, onClose }: { finding: Finding | null; dashboard: Dashboard; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPressStarted = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const previousFindingId = useRef<string | null>(null);
  const [presentedFinding, setPresentedFinding] = useState<Finding | null>(finding);
  const [openCycle, setOpenCycle] = useState(0);
  const [closing, setClosing] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }

    if (finding) {
      if (previousFindingId.current !== finding.id) setSelectedNode(null);
      previousFindingId.current = finding.id;
      setPresentedFinding(finding);
      setClosing(false);
      if (!dialog.open) {
        dialog.showModal();
        setOpenCycle((cycle) => cycle + 1);
      }
      return;
    }

    if (!dialog.open) {
      previousFindingId.current = null;
      setPresentedFinding(null);
      setSelectedNode(null);
      return;
    }

    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      dialog.close();
      closeTimer.current = null;
      previousFindingId.current = null;
      setClosing(false);
      setPresentedFinding(null);
      setSelectedNode(null);
    }, drawerTransitionMs);

    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [finding]);

  return (
    <dialog
      ref={ref}
      className={`finding-drawer${closing ? " is-closing" : ""}`}
      onPointerDown={(event) => { backdropPressStarted.current = event.target === event.currentTarget; }}
      onPointerCancel={() => { backdropPressStarted.current = false; }}
      onClick={(event) => {
        const backdropClick = backdropPressStarted.current && event.target === event.currentTarget;
        backdropPressStarted.current = false;
        if (backdropClick) onClose();
      }}
      onClose={() => { if (finding) onClose(); }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      aria-labelledby="finding-drawer-title"
    >
      {presentedFinding ? <div className="finding-drawer__surface">
        <header className="finding-drawer__header">
          <div><p className="eyebrow">Finding evidence</p><SeverityBadge severity={presentedFinding.severity} /><h2 id="finding-drawer-title">{presentedFinding.title}</h2><p>{presentedFinding.summary}</p></div>
          <button type="button" className="icon-button" aria-label="Close finding" autoFocus onClick={onClose}><X size={19} aria-hidden="true" /></button>
        </header>
        <dl className="finding-facts"><div><dt>Asset</dt><dd><bdi>{presentedFinding.assetLabel}</bdi></dd></div><div><dt>Confidence</dt><dd>{Math.round(presentedFinding.confidence * 100)}%</dd></div><div><dt>Status</dt><dd>{presentedFinding.status}</dd></div><div><dt>Raised by</dt><dd>{presentedFinding.discoveredBy}</dd></div></dl>
        <section className="finding-path-panel" aria-labelledby="finding-path-title">
          <div className="section-label"><h3 id="finding-path-title">Evidence chain</h3><Route size={15} aria-hidden="true" /></div>
          <div className="finding-path-graph"><FindingPathGraph dashboard={dashboard} finding={presentedFinding} selectedId={selectedNode?.id} fitRequestKey={`${presentedFinding.id}:${openCycle}`} onSelect={setSelectedNode} /></div>
          {selectedNode ? <div className="structured-peek"><Braces size={15} aria-hidden="true" /><div><strong>{selectedNode.label}</strong><small>{selectedNode.kind} · {selectedNode.status ?? "observed"}</small></div><code>{JSON.stringify(selectedNode.metadata, null, 2)}</code></div> : null}
        </section>
        <section className="finding-section"><h3>Evidence</h3><ul>{presentedFinding.evidence.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <section className="finding-section finding-section--action"><h3>Recommended action</h3><p>{presentedFinding.remediation ?? "Validate the issue and define a risk-appropriate corrective action."}</p></section>
      </div> : null}
    </dialog>
  );
}
