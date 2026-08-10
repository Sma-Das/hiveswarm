# Agent package contract

An agent package is a validated manifest plus an operator-trusted container image. Install metadata with `POST /api/agents/install`; the orchestrator immediately discovers the latest enabled semantic version through `GET /api/agents`.

## Manifest

- `id` and semantic `version` identify a package version.
- `role`, `description`, `skills`, `accepts`, and `emits` explain when the package is useful.
- `lifecycle` declares `task`, `session`, or both.
- `capabilities` are enforced permissions. Requested capabilities must be declared; high-rate scanning, credential use, exploit execution, and shell execution require a one-time decision.
- `image` and `command` define the replaceable runtime.
- `configuration` allowlists the only package-specific environment values the worker may inject. Secret values never belong in the manifest.

Container resources, writable mounts, temporary filesystems, and package-specific environment are compiled from worker-owned reviewed profiles. A manifest can declare supported capabilities and configuration, but it cannot grant itself a host mount, a larger resource profile, or additional environment. Generic specialists receive the constrained baseline; exceptional profiles such as Burp and the governed freeform package remain explicit worker decisions with focused plan tests.

```sh
curl -X POST http://localhost:4100/api/agents/install \
  -H 'content-type: application/json' \
  --data-binary @agents/port-scanner/agent.json
```

Registration does not pull or execute an image. This deliberately leaves room for administrator approval, signature verification, SBOM checks, and vulnerability scanning before admission.

## Runtime input

The worker supplies:

- `HIVESWARM_AGENT_ID`, `HIVESWARM_AGENT_RUN_ID`, and `HIVESWARM_DEPTH`;
- `HIVESWARM_TASK`, `HIVESWARM_TARGET`, and `HIVESWARM_LIFECYCLE`;
- `HIVESWARM_REQUESTED_CAPABILITIES`, containing only the permissions approved for this run;
- `HIVESWARM_EXECUTION_PLAN_B64` only for the freeform package, carrying the schema-validated reviewed plan;
- `HIVESWARM_ARTIFACT_DIR` and `HIVESWARM_ARTIFACT_BASE`;
- `HIVESWARM_SOURCE_PATH=/target` only for a validated source mount;
- values declared in the package's `configuration` array.

The container writes one JSON object per stdout line. Supported event types are `log`, `node`, `edge`, `finding`, `artifact`, `scope_proposal`, and `spawn_request`. Non-JSON stdout/stderr becomes bounded log evidence. A `spawn_request` is assigned to the emitting execution as its parent, then passes through the same depth, scope, lifecycle, and capability policy as a root request.

Nodes may include a short `ref`. Later edges can use those refs; the API resolves them to graph IDs inside the same agent execution. Findings create finding nodes automatically and link to matching assets when evidence identifies one.

## Lifecycle expectations

A task process exits when its assignment is complete. A session performs its initial assignment, emits readiness, and remains alive until the control plane terminates it. Processes must handle `SIGTERM`, avoid daemonizing, keep evidence values bounded, and never emit secret values. Exit zero marks completion; any other exit marks failure unless the run was already terminated by an operator.

## Freeform Ubuntu package

`freeform-ubuntu` is an escape hatch for a specific goal that has no installed specialist. It is task-only. Its spawn request must contain `shell.execute` and one to twelve `{ label, command, timeoutSeconds }` steps; a plan without the capability or a capability without a plan is rejected. The approval card includes the exact commands.

The runtime executes each step sequentially, stops on failure, applies a maximum five-minute timeout and output/file bounds, redacts common secret patterns, and writes `freeform-results.json`. A command may emit a typed event on a line prefixed with `HIVESWARM_EVENT=`, but the API rejects graph, finding, and scope events unless that run was granted the corresponding capability. The command digest is retained with the result while the command itself remains in the approval and audit record.

The container has common Ubuntu diagnostic tools but no Docker socket. Its root filesystem is read-only; `/workspace` and `/tmp` are bounded temporary filesystems. Network mode is `none` unless a network capability was explicitly requested, and a repository is mounted read-only only when `source.read` is both requested and configured. Commands receive a small allowlisted environment rather than the worker or plan environment.

## Burp package

PortSwigger distributes Burp under its own license, so HiveSwarm does not download or redistribute the JAR. Place the current unified JAR at `/opt/burp/burp.jar` in the `hiveswarm-burp` volume and complete PortSwigger's first-run Community acceptance or Professional activation using an operator-controlled GUI. The optional `BURP_LICENSE_KEY` is written with private permissions to `/opt/burp/license-key.txt` for that wizard; HiveSwarm does not bypass or automate activation.

After first-run setup, export trusted user/project JSON configuration into the same volume and set `BURP_ARGS` in the manifest configuration if needed, for example `--config-file=/opt/burp/project.json --disable-extensions`. Bind proxy or REST listeners only to the agent network, keep authentication enabled, and configure target scope in Burp as well as HiveSwarm. The headless session preserves its Burp home beneath `/opt/burp/home`.
