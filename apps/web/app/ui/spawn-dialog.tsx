"use client";

import type { AgentCapability, AgentLifecycle, AgentManifest, AgentRun, SpawnAgentRequest } from "@hiveswarm/contracts";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export function SpawnDialog({ open, agents, parentAgents, target, onClose, onSpawn }: {
  open: boolean; agents: AgentManifest[]; parentAgents: AgentRun[]; target: string; onClose: () => void;
  onSpawn: (request: SpawnAgentRequest) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const specialistRef = useRef<HTMLSelectElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("explorer");
  const selectedManifest = agents.find((agent) => agent.id === selectedAgentId);
  const isFreeform = selectedAgentId === "freeform-ubuntu";

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      specialistRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="spawn-title">
      <form className="dialog__surface" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        const data = new FormData(event.currentTarget);
        const manifest = agents.find((agent) => agent.id === data.get("agentId"));
        try {
          const executionPlan = isFreeform
            ? String(data.get("executionPlan") ?? "").split(/\r?\n/).map((command) => command.trim()).filter(Boolean).map((command, index) => ({ label: `Reviewed step ${index + 1}`, command, timeoutSeconds: 120 }))
            : [];
          if (isFreeform && executionPlan.length === 0) throw new Error("Add at least one exact command for the operator to review.");
          const requestedCapabilities = isFreeform
            ? ["shell.execute", ...data.getAll("capabilities").map(String)] as AgentCapability[]
            : manifest?.capabilities.filter((capability) => !["network.high-rate", "credentials.use", "exploit.execute", "shell.execute"].includes(capability)) ?? [];
          await onSpawn({ agentId: String(data.get("agentId")), lifecycle: String(data.get("lifecycle")) as AgentLifecycle,
            task: String(data.get("task")), target: String(data.get("target")),
            ...(data.get("parentAgentRunId") ? { parentAgentRunId: String(data.get("parentAgentRunId")) } : {}),
            requestedCapabilities,
            executionPlan,
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
          <label>Specialist<select ref={specialistRef} name="agentId" aria-label="Specialist" required value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>{agents.filter((agent) => agent.id !== "orchestrator").map((agent) => <option key={`${agent.id}-${agent.version}`} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>Lifecycle<select name="lifecycle" aria-label="Specialist lifecycle" required defaultValue="task">{selectedManifest?.lifecycle.map((lifecycle) => <option key={lifecycle} value={lifecycle}>{lifecycle === "task" ? "Task · exits when complete" : "Session · remains available"}</option>)}</select></label>
          <label>Parent agent<select name="parentAgentRunId" aria-label="Parent agent" defaultValue={parentAgents.find((agent) => agent.depth === 0)?.id ?? ""}><option value="">Orchestrator root</option>{parentAgents.filter((agent) => agent.depth < 5).map((agent) => <option key={agent.id} value={agent.id}>{"· ".repeat(agent.depth)}{agent.agentName}</option>)}</select></label>
          <label>Target<input name="target" aria-label="Specialist target" defaultValue={target} required /></label>
          <label className="form-grid__wide">Task<textarea name="task" aria-label="Specialist task" rows={4} required defaultValue="Map the authorized application surface and return structured evidence." /></label>
          {isFreeform ? <>
            <label className="form-grid__wide">Reviewed command plan<textarea className="command-plan" name="executionPlan" aria-label="Reviewed command plan" rows={6} required placeholder={"One exact command per line\ngetent hosts $HIVESWARM_TARGET\ncurl -fsS --max-time 15 https://$HIVESWARM_TARGET/robots.txt"} /><span className="field-hint">Commands run in order with a 120-second limit per step. The complete plan is shown in the approval request before the container starts.</span></label>
            <fieldset className="capability-picker form-grid__wide"><legend>Additional access</legend><p>Shell execution is always requested. Select only what this goal needs.</p><div>{selectedManifest?.capabilities.filter((capability) => capability !== "shell.execute").map((capability) => <label key={capability}><input type="checkbox" name="capabilities" value={capability} /> <span>{capability}</span></label>)}</div></fieldset>
          </> : null}
        </div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog__actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? "Starting specialist" : "Start specialist"}</button></div>
      </form>
    </dialog>
  );
}
