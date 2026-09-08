"use client";

import type { Dashboard, GraphNode, ScopeRule } from "@hiveswarm/contracts";
import { Ban, Check, GitFork, Plus, Shield, Trash2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ScopeGraph } from "./security-graph";

const boundaries: Record<
  ScopeRule["kind"],
  { label: string; placeholder: string; description: string }
> = {
  host: {
    label: "Host",
    placeholder: "api.example.test",
    description:
      "Match a hostname or IP address. A plain hostname matches only that host; *.example.test also includes the base domain and its subdomains.",
  },
  domain: {
    label: "Domain",
    placeholder: "*.example.test",
    description:
      "Use *.example.test to include the base domain and all subdomains. Without the wildcard, only the exact hostname matches.",
  },
  cidr: {
    label: "CIDR",
    placeholder: "192.0.2.0/24",
    description:
      "Match an IP address within an IPv4 or IPv6 network range. This rule does not resolve hostnames to IP addresses.",
  },
  "url-prefix": {
    label: "URL prefix",
    placeholder: "https://example.test/api/",
    description:
      "Match target URLs starting with this exact, case-sensitive text. Include a trailing slash when you intend a path boundary.",
  },
  repository: {
    label: "Repository",
    placeholder: "repository:sample-app",
    description:
      "Match this exact repository target identifier and any slash-delimited paths beneath it.",
  },
};

export function ScopeView({
  dashboard,
  selectedNodeId,
  onAdd,
  onRemove,
  onInspect,
}: {
  dashboard: Dashboard;
  selectedNodeId?: string | null | undefined;
  onAdd: (rule: Omit<ScopeRule, "id">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onInspect: (node: GraphNode | null) => void;
}) {
  const [kind, setKind] = useState<ScopeRule["kind"]>("domain");
  const [action, setAction] = useState<ScopeRule["action"]>("allow");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showGraph, setShowGraph] = useState(false);
  const [removal, setRemoval] = useState<ScopeRule | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const rules = dashboard.engagement.scopeRules;
  const allows = rules.filter((rule) => rule.action === "allow").length;

  return (
    <section
      className="flex min-w-0 flex-col gap-8 text-sm leading-6 text-foreground"
      aria-labelledby="scope-title"
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1
            id="scope-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Scope policy
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Define where specialists may work. Targets must match an allow rule
            and must not match any deny rule.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          aria-expanded={showGraph}
          aria-controls={showGraph ? "scope-graph" : undefined}
          onClick={() => setShowGraph(!showGraph)}
        >
          <GitFork aria-hidden="true" className="size-4" />
          {showGraph ? "Hide scope graph" : "Show scope graph"}
        </Button>
      </header>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <Shield
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-muted-foreground"
        />
        <div>
          <p className="font-medium">Deny rules always take precedence</p>
          <p className="text-muted-foreground">
            Rule order does not matter. Without a matching allow rule, a target
            is out of scope. Allowing a target does not approve credentials,
            high-rate scans, or exploit execution.
          </p>
        </div>
      </div>

      {showGraph ? (
        <section
          id="scope-graph"
          aria-label="Scope graph"
          className="relative h-[360px] min-w-0 overflow-hidden rounded-xl border border-border sm:h-[440px]"
        >
          <ScopeGraph
            dashboard={dashboard}
            selectedId={selectedNodeId}
            onSelect={onInspect}
          />
        </section>
      ) : null}

      <div className="grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          className="min-w-0 space-y-4"
          aria-labelledby="scope-rules-title"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="scope-rules-title" className="font-semibold">
              Rules{" "}
              <span className="ml-1 font-normal text-muted-foreground">
                {rules.length}
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{allows} allow</Badge>
              <Badge variant="outline">{rules.length - allows} deny</Badge>
            </div>
          </div>
          {notice ? (
            <p role="status" className="text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {rules.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 p-4 sm:p-5">
                  {rule.action === "allow" ? (
                    <Check
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <Ban
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-destructive"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {rule.action === "allow" ? "Allow" : "Deny"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {boundaries[rule.kind].label}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-mono text-xs">
                      <bdi>{rule.value}</bdi>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={busy || removing}
                    aria-label={`Remove ${rule.action} rule for ${rule.value}`}
                    onClick={() => {
                      setRemoveError("");
                      setRemoval(rule);
                    }}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border py-10 text-center">
              <h3 className="font-medium">No scope rules</h3>
              <p className="mx-auto mt-2 max-w-sm text-muted-foreground">
                All targets are out of scope. Add an allow rule only for a
                boundary you are authorized to assess.
              </p>
            </div>
          )}
        </section>

        <section
          className="min-w-0 rounded-xl border border-border bg-background p-5 sm:p-6"
          aria-labelledby="add-scope-title"
        >
          <h2 id="add-scope-title" className="font-semibold">
            Add a scope rule
          </h2>
          <p className="mt-1 text-muted-foreground">
            Use the narrowest boundary your authorization covers.
          </p>
          <form
            className="mt-5 space-y-5"
            aria-busy={busy}
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy || removing) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await onAdd({ kind, value: value.trim(), action });
                setValue("");
                setNotice(
                  `${action === "allow" ? "Allow" : "Deny"} rule added.`,
                );
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Unable to add the scope rule. Review the boundary and try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="scope-action">Decision</Label>
                <NativeSelect
                  id="scope-action"
                  name="action"
                  value={action}
                  disabled={busy || removing}
                  onChange={(event) => {
                    if (
                      event.target.value === "allow" ||
                      event.target.value === "deny"
                    )
                      setAction(event.target.value);
                  }}
                >
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="scope-kind">Boundary type</Label>
                <NativeSelect
                  id="scope-kind"
                  name="kind"
                  value={kind}
                  disabled={busy || removing}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (
                      next === "host" ||
                      next === "domain" ||
                      next === "cidr" ||
                      next === "url-prefix" ||
                      next === "repository"
                    )
                      setKind(next);
                  }}
                >
                  {Object.entries(boundaries).map(([key, boundary]) => (
                    <option key={key} value={key}>
                      {boundary.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scope-value">Boundary value</Label>
              <Input
                id="scope-value"
                name="value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={busy || removing}
                required
                placeholder={boundaries[kind].placeholder}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="scope-boundary-help"
                className="font-mono text-xs"
              />
              <p
                id="scope-boundary-help"
                className="text-xs leading-6 text-muted-foreground"
              >
                {boundaries[kind].description}
              </p>
            </div>
            {action === "deny" ? (
              <p className="text-xs text-muted-foreground">
                This exclusion overrides any matching allow rule.
              </p>
            ) : null}
            {error ? (
              <p className="break-words text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={busy || removing || !value.trim()}
            >
              <Plus aria-hidden="true" className="size-4" />
              {busy ? "Adding rule..." : `Add ${action} rule`}
            </Button>
          </form>
        </section>
      </div>

      <Dialog
        open={Boolean(removal)}
        onOpenChange={(open) => {
          if (!open && !removing) setRemoval(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removal?.action} rule?</DialogTitle>
            <DialogDescription>
              {removal?.action === "deny"
                ? "Removing this exclusion may allow matching targets if another allow rule applies and no other deny rule matches."
                : "Matching targets will be out of scope unless another allow rule applies. Any matching deny rule still takes precedence."}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all rounded-md bg-muted p-3 font-mono text-xs leading-6">
            <bdi>{removal?.value}</bdi>
          </p>
          {removeError ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {removeError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={removing}
              onClick={() => setRemoval(null)}
            >
              Keep rule
            </Button>
            <Button
              variant="destructive"
              disabled={removing || !removal}
              onClick={async () => {
                if (!removal || removing) return;
                setRemoving(true);
                setRemoveError("");
                setNotice("");
                try {
                  await onRemove(removal.id);
                  setRemoval(null);
                  setNotice("Scope rule removed.");
                } catch (cause) {
                  setRemoveError(
                    cause instanceof Error
                      ? cause.message
                      : "Unable to remove the scope rule. Try again.",
                  );
                } finally {
                  setRemoving(false);
                }
              }}
            >
              {removing ? "Removing..." : "Remove rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
