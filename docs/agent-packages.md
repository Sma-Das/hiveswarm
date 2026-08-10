# Agent package contract

An agent package is a validated manifest plus an operator-trusted container image. Install metadata with `POST /api/agents/install`; the orchestrator immediately discovers the latest enabled semantic version through `GET /api/agents`.

## Manifest

- `id` and semantic `version` identify a package version.
- `role`, `description`, `skills`, `accepts`, and `emits` explain when the package is useful.
- `lifecycle` declares `task`, `session`, or both.
- `capabilities` are enforced permissions. Requested capabilities must be declared; high-rate scanning, credential use, and exploit execution require a one-time decision.
- `image` and `command` define the replaceable runtime.
- `configuration` allowlists the only package-specific environment values the worker may inject. Secret values never belong in the manifest.

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
- `HIVESWARM_ARTIFACT_DIR` and `HIVESWARM_ARTIFACT_BASE`;
- `HIVESWARM_SOURCE_PATH=/target` only for a validated source mount;
- values declared in the package's `configuration` array.

The container writes one JSON object per stdout line. Supported event types are `log`, `node`, `edge`, `finding`, `artifact`, `scope_proposal`, and `spawn_request`. Non-JSON stdout/stderr becomes bounded log evidence. A `spawn_request` is assigned to the emitting execution as its parent, then passes through the same depth, scope, lifecycle, and capability policy as a root request.

Nodes may include a short `ref`. Later edges can use those refs; the API resolves them to graph IDs inside the same agent execution. Findings create finding nodes automatically and link to matching assets when evidence identifies one.

## Lifecycle expectations

A task process exits when its assignment is complete. A session performs its initial assignment, emits readiness, and remains alive until the control plane terminates it. Processes must handle `SIGTERM`, avoid daemonizing, keep evidence values bounded, and never emit secret values. Exit zero marks completion; any other exit marks failure unless the run was already terminated by an operator.

## Burp package

PortSwigger distributes Burp under its own license, so HiveSwarm does not download or redistribute the JAR. Place the current unified JAR at `/opt/burp/burp.jar` in the `hiveswarm-burp` volume and complete PortSwigger's first-run Community acceptance or Professional activation using an operator-controlled GUI. The optional `BURP_LICENSE_KEY` is written with private permissions to `/opt/burp/license-key.txt` for that wizard; HiveSwarm does not bypass or automate activation.

After first-run setup, export trusted user/project JSON configuration into the same volume and set `BURP_ARGS` in the manifest configuration if needed, for example `--config-file=/opt/burp/project.json --disable-extensions`. Bind proxy or REST listeners only to the agent network, keep authentication enabled, and configure target scope in Burp as well as HiveSwarm. The headless session preserves its Burp home beneath `/opt/burp/home`.
