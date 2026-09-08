"use client";

import {
  agentCapabilitySchema,
  spawnAgentRequestSchema,
  type AgentCapability,
  type AgentManifest,
  type AgentRun,
  type SpawnAgentRequest,
} from "@hiveswarm/contracts";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type SpawnDialogProps = {
  open: boolean;
  agents: AgentManifest[];
  parentAgents: AgentRun[];
  target: string;
  onClose: () => void;
  onSpawn: (request: SpawnAgentRequest) => Promise<void>;
};

const sensitiveCapabilities = new Set<AgentCapability>([
  "network.high-rate",
  "credentials.use",
  "exploit.execute",
  "shell.execute",
]);

export function SpawnDialog({ open, ...props }: SpawnDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onClose();
      }}
    >
      {open ? <SpawnForm {...props} /> : null}
    </Dialog>
  );
}

function SpawnForm({
  agents,
  parentAgents,
  target,
  onClose,
  onSpawn,
}: Omit<SpawnDialogProps, "open">) {
  const id = useId();
  const enabled = agents.filter(
    (agent) => agent.enabled && agent.id !== "orchestrator",
  );
  const initialManifest =
    enabled.find((agent) => agent.id === "explorer") ?? enabled[0];
  const [selectedAgentId, setSelectedAgentId] = useState(
    initialManifest?.id ?? "",
  );
  const [capabilities, setCapabilities] = useState<AgentCapability[]>(
    initialManifest?.id === "freeform-ubuntu"
      ? ["shell.execute"]
      : (initialManifest?.capabilities.filter(
          (capability) => !sensitiveCapabilities.has(capability),
        ) ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manifest = enabled.find((agent) => agent.id === selectedAgentId);
  const isFreeform = manifest?.id === "freeform-ubuntu";
  const requestsShell = isFreeform || capabilities.includes("shell.execute");

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Start a specialist</DialogTitle>
        <DialogDescription>
          Define a bounded task and review the access it needs. Local policy
          checks the request before execution.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-6"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            if (!manifest) throw new Error("Choose an enabled specialist.");
            const requestedCapabilities = agentCapabilitySchema
              .array()
              .parse(
                isFreeform
                  ? Array.from(new Set([...capabilities, "shell.execute"]))
                  : capabilities,
              );
            if (
              requestedCapabilities.some(
                (capability) => !manifest.capabilities.includes(capability),
              )
            )
              throw new Error(
                "The specialist no longer declares the selected access. Choose the specialist again.",
              );
            const executionPlan = requestsShell
              ? String(data.get("executionPlan") ?? "")
                  .split(/\r?\n/)
                  .filter((command) => command.trim())
                  .map((command, index) => ({
                    label: `Reviewed step ${index + 1}`,
                    command,
                    timeoutSeconds: 120,
                  }))
              : [];
            if (requestsShell && !executionPlan.length)
              throw new Error("Add at least one exact command for review.");
            const parsed = spawnAgentRequestSchema.safeParse({
              agentId: manifest.id,
              lifecycle: data.get("lifecycle"),
              task: data.get("task"),
              target: data.get("target"),
              ...(data.get("parentAgentRunId")
                ? { parentAgentRunId: data.get("parentAgentRunId") }
                : {}),
              requestedCapabilities,
              executionPlan,
            });
            if (!parsed.success)
              throw new Error(
                parsed.error.issues
                  .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                  .join("\n"),
              );
            if (!manifest.lifecycle.includes(parsed.data.lifecycle))
              throw new Error(
                "Choose a lifecycle supported by this specialist.",
              );
            setBusy(true);
            await onSpawn(parsed.data);
            onClose();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to start the specialist.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="grid min-w-0 gap-5 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-specialist`}>Specialist</Label>
            <NativeSelect
              id={`${id}-specialist`}
              name="agentId"
              required
              value={selectedAgentId}
              onChange={(event) => {
                const next = enabled.find(
                  (agent) => agent.id === event.target.value,
                );
                setSelectedAgentId(event.target.value);
                setCapabilities(
                  next?.id === "freeform-ubuntu"
                    ? ["shell.execute"]
                    : (next?.capabilities.filter(
                        (capability) => !sensitiveCapabilities.has(capability),
                      ) ?? []),
                );
                setError("");
              }}
            >
              {!manifest ? (
                <option value="">Choose an enabled specialist</option>
              ) : null}
              {enabled.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {manifest?.description ??
                "No enabled specialist is selected. Enable a package in the registry to start work."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-lifecycle`}>Lifecycle</Label>
            <NativeSelect
              key={manifest?.id}
              id={`${id}-lifecycle`}
              name="lifecycle"
              required
              defaultValue={manifest?.lifecycle[0]}
            >
              {manifest?.lifecycle.map((lifecycle) => (
                <option key={lifecycle} value={lifecycle}>
                  {lifecycle === "task"
                    ? "Task: exits when complete"
                    : "Session: remains available"}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-parent`}>Parent agent</Label>
            <NativeSelect
              id={`${id}-parent`}
              name="parentAgentRunId"
              defaultValue={
                parentAgents.find((agent) => agent.depth === 0)?.id ?? ""
              }
            >
              <option value="">Orchestrator root</option>
              {parentAgents
                .filter((agent) => agent.depth < 5)
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.agentName} / depth {agent.depth}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-target`}>Target</Label>
            <Input
              id={`${id}-target`}
              name="target"
              defaultValue={target}
              maxLength={2048}
              required
            />
            <p className="text-xs text-muted-foreground">
              The target is checked against this project's scope. Deny rules
              take precedence.
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${id}-task`}>Task</Label>
            <Textarea
              id={`${id}-task`}
              name="task"
              rows={3}
              minLength={8}
              maxLength={4000}
              required
              defaultValue="Map the authorized application surface and return structured evidence."
            />
          </div>
          <fieldset className="min-w-0 space-y-3 sm:col-span-2">
            <legend className="text-sm font-semibold">
              Requested capabilities
            </legend>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Select only the access this task needs. High-rate scanning,
              credentials, exploits, and shell execution require a separate
              approval. Selecting them here is not approval.
            </p>
            <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2">
              {manifest?.capabilities.map((capability) => {
                const forced = isFreeform && capability === "shell.execute";
                return (
                  <Label
                    key={capability}
                    htmlFor={`${id}-${capability}`}
                    className="items-start gap-3 bg-muted/40 p-3 font-normal leading-normal"
                  >
                    <Checkbox
                      id={`${id}-${capability}`}
                      checked={forced || capabilities.includes(capability)}
                      disabled={busy || forced}
                      onCheckedChange={(checked) =>
                        setCapabilities((current) =>
                          checked === true
                            ? [...current, capability]
                            : current.filter((item) => item !== capability),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-xs">
                        {capability}
                      </span>
                      {sensitiveCapabilities.has(capability) ? (
                        <span className="mt-1 block text-xs text-[var(--warning-text)]">
                          {forced
                            ? "Required for freeform. Approval required."
                            : "Approval required"}
                        </span>
                      ) : null}
                    </span>
                  </Label>
                );
              })}
            </div>
            {!manifest?.capabilities.length ? (
              <p className="text-sm text-muted-foreground">
                No capabilities declared.
              </p>
            ) : null}
          </fieldset>
          {requestsShell ? (
            <div key={manifest?.id} className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${id}-plan`}>Exact command plan</Label>
              <Textarea
                id={`${id}-plan`}
                name="executionPlan"
                className="font-mono text-xs"
                rows={5}
                required
                aria-describedby={`${id}-plan-hint`}
                placeholder="One exact command per line"
              />
              <p
                id={`${id}-plan-hint`}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                Up to 12 commands, with a 120-second limit per step. The
                complete plan requires operator approval before execution. Do
                not include credentials or secrets.
              </p>
            </div>
          ) : null}
        </fieldset>
        {error ? (
          <p
            className="whitespace-pre-wrap break-words rounded-md bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !manifest}>
            {busy ? "Submitting request..." : "Request specialist"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
