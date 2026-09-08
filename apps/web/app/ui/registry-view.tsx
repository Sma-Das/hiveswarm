"use client";

import type { AgentManifest } from "@hiveswarm/contracts";
import { Box, Check, Download, Search, Shield } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

export function RegistryView({
  agents,
  onInstall,
}: {
  agents: AgentManifest[];
  onInstall: (manifest: unknown) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const enabled = agents.filter((agent) => agent.enabled).length;
  const search = query.trim().toLowerCase();
  const visible = agents.filter(
    (agent) =>
      (status === "all" ||
        (status === "enabled" ? agent.enabled : !agent.enabled)) &&
      [
        agent.name,
        agent.id,
        agent.role,
        agent.description,
        agent.image,
        ...agent.skills,
        ...agent.capabilities,
      ].some((value) => value.toLowerCase().includes(search)),
  );

  return (
    <section
      className="flex min-w-0 flex-col gap-8 text-sm leading-6 text-foreground"
      aria-labelledby="registry-title"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1
            id="registry-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Agent registry
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Review installed specialists and the capabilities they declare.
            Registration does not grant permission to run.
          </p>
        </div>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!busy) {
              setOpen(next);
              setError("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Download aria-hidden="true" className="size-4" />
              Install manifest
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Install an agent manifest</DialogTitle>
              <DialogDescription>
                Paste the complete package manifest as JSON. HiveSwarm validates
                it before registration.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-5"
              aria-busy={busy}
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                setError("");
                let parsed: unknown;
                try {
                  parsed = JSON.parse(manifest);
                } catch {
                  setError(
                    "Invalid JSON. Check quotes, commas, and brackets, then try again.",
                  );
                  return;
                }
                setBusy(true);
                try {
                  await onInstall(parsed);
                  setManifest("");
                  setOpen(false);
                  setNotice("Manifest installed.");
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to install the manifest. Review the JSON and try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="manifest-json">Agent manifest JSON</Label>
                <Textarea
                  id="manifest-json"
                  name="manifest"
                  value={manifest}
                  onChange={(event) => setManifest(event.target.value)}
                  rows={12}
                  required
                  disabled={busy}
                  spellCheck={false}
                  placeholder="Paste the complete manifest here"
                  className="font-mono text-xs leading-6"
                  aria-invalid={Boolean(error)}
                  aria-describedby={
                    error ? "manifest-help manifest-error" : "manifest-help"
                  }
                />
              </div>
              <p
                id="manifest-help"
                className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"
              >
                <Shield aria-hidden="true" className="mt-1 size-4 shrink-0" />
                Identity, lifecycle, capabilities, and configuration are
                validated. Scope and approval checks still apply to every
                execution.
              </p>
              {error ? (
                <p
                  id="manifest-error"
                  className="break-words text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? "Installing..." : "Install manifest"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {notice ? (
        <p
          role="status"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <Check aria-hidden="true" className="size-4" />
          {notice}
        </p>
      ) : null}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-4 text-muted-foreground">
          <span className="flex items-center gap-2 text-foreground">
            <Box aria-hidden="true" className="size-4" />
            <strong className="font-medium tabular-nums">
              {agents.length}
            </strong>{" "}
            installed
          </span>
          <span>{enabled} enabled</span>
          <span>{agents.length - enabled} disabled</span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Label htmlFor="registry-search" className="sr-only">
              Search agent catalog
            </Label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="registry-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names, skills, or capabilities..."
              className="pl-9"
            />
          </div>
          <div className="sm:w-44">
            <Label htmlFor="registry-status" className="sr-only">
              Filter by package status
            </Label>
            <NativeSelect
              id="registry-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">All packages</option>
              <option value="enabled">Enabled only</option>
              <option value="disabled">Disabled only</option>
            </NativeSelect>
          </div>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          Showing {visible.length} of {agents.length} packages
        </p>
        {visible.length ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {visible.map((agent) => (
              <article
                className="min-w-0 space-y-5 rounded-xl border border-border bg-background p-5 sm:p-6"
                key={`${agent.id}-${agent.version}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words text-sm font-semibold">
                      {agent.name}
                    </h2>
                    <p className="break-words text-xs text-muted-foreground">
                      {agent.role} / v{agent.version}
                    </p>
                  </div>
                  <Badge
                    variant={agent.enabled ? "secondary" : "outline"}
                    className="shrink-0"
                  >
                    {agent.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <p className="break-words text-muted-foreground">
                  {agent.description}
                </p>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Package ID</dt>
                  <dd className="break-all font-mono">{agent.id}</dd>
                  <dt className="text-muted-foreground">Image</dt>
                  <dd className="break-all font-mono">
                    <bdi>{agent.image}</bdi>
                  </dd>
                  <dt className="text-muted-foreground">Lifecycle</dt>
                  <dd>{agent.lifecycle.join(", ")}</dd>
                </dl>
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-xs font-medium">
                    Declared capabilities{" "}
                    <span className="text-muted-foreground">
                      ({agent.capabilities.length})
                    </span>
                  </h3>
                  {agent.capabilities.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {agent.capabilities.map((capability) => (
                        <li key={capability} className="min-w-0">
                          <Badge
                            variant="outline"
                            className="max-w-full whitespace-normal break-all font-mono text-xs"
                          >
                            {capability}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No capabilities declared.
                    </p>
                  )}
                </div>
                {agent.skills.length ? (
                  <div className="space-y-1">
                    <h3 className="text-xs font-medium">Skills</h3>
                    <p className="break-words text-xs text-muted-foreground">
                      {agent.skills.join(" / ")}
                    </p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <h2 className="font-semibold">
              {agents.length
                ? "No matching packages"
                : "No specialists installed"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              {agents.length
                ? "Try a different name or capability, or clear your filters."
                : "Install a reviewed manifest to make a specialist available to the orchestrator."}
            </p>
            {agents.length ? (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                Clear filters
              </Button>
            ) : (
              <Button className="mt-4" onClick={() => setOpen(true)}>
                Install manifest
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
