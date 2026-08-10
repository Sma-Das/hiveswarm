"use client";

import type { AgentLifecycle, AgentManifest, AgentRun, SpawnAgentRequest } from "@hiveswarm/contracts";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function SpawnDialog({ open, agents, parentAgents, target, onClose, onSpawn }: {
  open: boolean; agents: AgentManifest[]; parentAgents: AgentRun[]; target: string; onClose: () => void;
  onSpawn: (request: SpawnAgentRequest) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="spawn-title">
      <form className="dialog__surface" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        const data = new FormData(event.currentTarget);
        const manifest = agents.find((agent) => agent.id === data.get("agentId"));
        try {
          await onSpawn({ agentId: String(data.get("agentId")), lifecycle: String(data.get("lifecycle")) as AgentLifecycle,
            task: String(data.get("task")), target: String(data.get("target")),
            ...(data.get("parentAgentRunId") ? { parentAgentRunId: String(data.get("parentAgentRunId")) } : {}),
            requestedCapabilities: manifest?.capabilities.filter((capability) => !["network.high-rate", "credentials.use", "exploit.execute"].includes(capability)) ?? [],
          });
          onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start the agent."); }
        finally { setBusy(false); }
      }}>
        <div className="dialog__header">
          <div><p className="eyebrow">Orchestrator request</p><h2 id="spawn-title">Start a specialist</h2></div>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} strokeWidth={1.5} aria-hidden="true" /></button>
        </div>
        <div className="form-grid">
          <label>Specialist<select name="agentId" required defaultValue="explorer">{agents.filter((agent) => agent.id !== "orchestrator").map((agent) => <option key={`${agent.id}-${agent.version}`} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>Lifecycle<select name="lifecycle" required defaultValue="task"><option value="task">Task · exits when complete</option><option value="session">Session · remains available</option></select></label>
          <label>Parent agent<select name="parentAgentRunId" defaultValue="ar_orchestrator"><option value="">Orchestrator root</option>{parentAgents.filter((agent) => agent.depth < 5).map((agent) => <option key={agent.id} value={agent.id}>{"· ".repeat(agent.depth)}{agent.agentName}</option>)}</select></label>
          <label>Target<input name="target" defaultValue={target} required /></label>
          <label className="form-grid__wide">Task<textarea name="task" rows={4} required defaultValue="Map the authorized application surface and return structured evidence." /></label>
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog__actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? "Starting specialist" : "Start specialist"}</button></div>
      </form>
    </dialog>
  );
}
