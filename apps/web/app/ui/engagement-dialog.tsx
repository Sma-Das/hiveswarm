"use client";

import { ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
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

type EngagementDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; target: string }) => Promise<void>;
};

export function EngagementDialog({ open, ...props }: EngagementDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onClose();
      }}
    >
      {open ? <EngagementForm {...props} /> : null}
    </Dialog>
  );
}

function EngagementForm({
  onClose,
  onCreate,
}: Omit<EngagementDialogProps, "open">) {
  const id = useId();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let boundary: { kind: "repository" | "host"; value: string } | undefined;
  let boundaryError = "";
  if (target) {
    try {
      // Match WorkspaceClient's create-project normalization, including repository references.
      const normalized = target.includes("://")
        ? new URL(target).hostname
        : target;
      const kind = target.startsWith("repository:") ? "repository" : "host";
      boundary = { kind, value: kind === "repository" ? target : normalized };
      if (!boundary.value)
        boundaryError =
          "Enter a URL with a hostname, a hostname, or a repository: reference.";
    } catch {
      boundaryError =
        "This URL cannot be parsed. Check the target before creating the project.";
    }
  }
  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Create a project</DialogTitle>
        <DialogDescription>
          Keep this assessment's scope, specialist runs, and evidence in one
          project.
        </DialogDescription>
      </DialogHeader>
      <form
        className="space-y-6"
        aria-busy={busy}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || boundaryError) return;
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError("");
          try {
            await onCreate({ name: String(data.get("name")), target });
            onClose();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to create the project.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Project name</Label>
            <Input
              id={`${id}-name`}
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Northstar portal"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-target`}>Primary target</Label>
            <Input
              id={`${id}-target`}
              name="target"
              required
              minLength={3}
              maxLength={2048}
              placeholder="https://app.example.test"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              aria-invalid={Boolean(boundaryError)}
              aria-describedby={`${id}-target-hint ${id}-boundary`}
            />
            <p
              id={`${id}-target-hint`}
              className="text-xs leading-relaxed text-muted-foreground"
            >
              Enter a URL, hostname, or a reference beginning with repository:.
            </p>
          </div>
        </fieldset>
        <section
          id={`${id}-boundary`}
          aria-labelledby={`${id}-boundary-title`}
          className="space-y-3 rounded-md border border-border bg-muted/50 p-4"
          aria-live="polite"
        >
          <h3 id={`${id}-boundary-title`} className="text-sm font-semibold">
            Initial scope boundary
          </h3>
          {boundaryError ? (
            <p className="text-sm text-[var(--danger-text)]">{boundaryError}</p>
          ) : boundary ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Allow {boundary.kind}</Badge>
                <code className="min-w-0 break-all text-sm">
                  {boundary.value}
                </code>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {boundary.kind === "host"
                  ? "Creates a host allow rule, not an exact URL rule. URL paths, ports, and schemes do not narrow this boundary. Review exclusions and add more rules in Scope before running specialists."
                  : "Creates a repository allow rule for this reference. Review the repository boundary and any exclusions in Scope before running specialists."}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Enter a target to preview the allow rule that will be created.
            </p>
          )}
        </section>
        <div className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Only assess systems covered by written authorization. Confirm the
            target, exclusions, and permitted activity before starting work.
            Creating a project does not start an assessment.
          </p>
        </div>
        {error ? (
          <p
            className="break-words rounded-md bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || Boolean(boundaryError)}>
            {busy ? "Creating project..." : "Create project"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
