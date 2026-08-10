# HiveSwarm

HiveSwarm is a human-governed, multi-agent application-security evaluation platform. A provider-neutral orchestrator discovers swappable specialist packages, applies scope and capability policy, runs approved work in constrained containers, and turns typed evidence into an explorable asset and vulnerability-path graph.

This repository is the core vertical slice: a Fastify control plane, a queue-backed Docker worker, a Next.js console, shared Zod contracts, and a catalog of specialist agent packages.

## What must not be compromised

### 1. Human authority

The model plans work; it does not grant authority. Targets, recursive depth, lifecycle, and requested capabilities are revalidated locally. Explicit deny rules beat allow rules. Scope expansion, credential use, high-rate scanning, exploit execution, and freeform shell plans remain visible human decisions.

Never turn a safety gate into prompt guidance or trust a caller-supplied claim that the API can derive from stored state.

### 2. Evidence over theater

HiveSwarm exists to produce reviewable evidence, not an impressive-looking stream of agent activity. Findings should connect to assets, execution provenance, logs, and artifacts. Status must reflect actual lifecycle state. Reports are derived from current evidence and should state coverage and limitations honestly.

When choosing between a clever orchestration feature and a smaller auditable path, prefer the auditable path.

### 3. Replaceable specialists

The orchestrator is registry-aware and specialist-neutral. Agent-specific behavior belongs in manifests, runtimes, or adapters—not hard-coded branches in the orchestration loop. Adding or replacing a package should not require rewriting the central prompt or weakening the common spawn contract.

### 4. Safe local evaluation

The default developer path uses in-memory state and simulated execution. It must remain useful without Docker authority, a provider key, or access to a real target. The complete stack is an explicit opt-in because the Docker socket, repository mounts, network scanning, credentials, and evidence storage cross material trust boundaries.

## A note on engineering taste

Favor ambitious product behavior built from small, legible systems. Do not preserve complexity merely because it exists, and do not add machinery for hypothetical scale. Find the real trust boundary, make it explicit, and implement the smallest model whose correct behavior is unsurprising.

Treat the guidance below as strong defaults. If a task genuinely conflicts with it, explain the conflict before taking the risk.

## Glossary

Use these terms consistently in code and discussion:

- **operator**: the human creating projects, defining scope, reviewing approvals, and controlling runs.
- **project** or **engagement**: one isolated assessment with its own target, scope, runs, evidence, and report. The types still use `engagement` in several places.
- **run**: one project-level orchestration lifecycle.
- **agent run**: one execution of a specialist within a run.
- **orchestrator**: the registry-aware planner that asks for specialist spawns through the common typed operation.
- **specialist**: an installed agent package selected for a bounded task or session.
- **task agent**: a specialist that exits after a bounded assignment.
- **session agent**: a long-lived specialist that remains available until terminated.
- **manifest**: the versioned, validated package metadata describing a specialist's image, command, lifecycle, capabilities, inputs, and outputs.
- **capability**: an enforced permission requested for one agent run; declaration in a manifest is not approval to use it.
- **scope rule**: an allow or deny boundary for a host, domain, CIDR, URL prefix, or repository.
- **evidence**: typed nodes, edges, findings, artifacts, and bounded logs emitted by a specialist.
- **approval**: a one-time operator decision for one requested action, not a reusable grant.

## The dangerous shortcuts

1. **Running against a real target casually.** Never use the queue/Docker path, active scanners, credentials, exploit capability, or freeform shell execution merely to test a code change. Use simulated execution unless real execution is explicitly required, and only assess systems covered by written authorization.
2. **Granting authority by accident.** Do not bypass `PolicyEngine`, make denies fall through to allows, trust model-generated capabilities, accept caller-reported recursion depth, or convert one-time approvals into ambient permission.
3. **Treating the Docker socket as a sandbox.** It is host-level authority. Do not enable the Docker worker or mount arbitrary host paths as a convenience. Source targets must resolve beneath `HIVESWARM_SOURCE_ROOT` and remain read-only.
4. **Leaking secrets into durable evidence.** Never put provider keys, callback tokens, license keys, credentials, raw discovered secrets, or the worker environment in manifests, logs, events, artifacts, fixtures, or commits. Preserve redaction and bounded-output behavior.
5. **Using the active project as mutation identity.** Background work can continue after the console switches projects. Callbacks, approvals, controls, scope mutations, and reports must resolve their owning project from explicit or stored identifiers, never from the UI's current-project preference.
6. **Confusing network isolation with scope enforcement.** A dedicated bridge does not restrict destinations. Do not claim production-grade target enforcement until DNS and connection-time egress controls exist.

## Follow a change across every boundary

Most regressions here happen when a change is made in one layer but not its consumers. Before considering a feature complete, check the relevant entries:

- **Contracts.** Wire and persisted shapes live in `packages/contracts`. Update schemas first, then producers, consumers, fixtures, and tests. Continue validating all browser, model, manifest, runtime, and callback input at a trust boundary.
- **Project isolation.** Confirm the change behaves correctly while another project is active and while callbacks arrive for background work.
- **Policy.** Check allow and deny behavior, approval creation and resolution, undeclared capabilities, task/session compatibility, parent ownership, and the depth-five recursion limit.
- **Execution modes.** The in-process simulated driver and Redis/worker path should share lifecycle semantics. A feature may be intentionally unsupported in simulation, but that decision must be visible rather than accidental.
- **Agent lifecycle.** Cover queued, starting, running, approval-waiting, paused, completed, failed, and terminated states where applicable. Add the reverse control and visible state for every new control.
- **Evidence projections.** Topology, swarm, scope, finding paths, activity, and reports are views over common evidence. Do not patch one projection by duplicating or inventing conflicting state.
- **Agent packages.** Manifest declarations, worker environment, runtime output, API ingestion, and documentation must agree. Child `spawn_request` events pass through the same policy as root requests.
- **UI.** Project switching, SSE refresh, loading/error/empty states, keyboard access, and narrow layouts are part of the console behavior—not optional polish.
- **Operations and docs.** User-visible or operator-risk changes belong in `README.md` and `docs/operations.md`; architectural changes in `docs/architecture.md`; package contract changes in `docs/agent-packages.md`.

## Development

Requirements are Node.js 20.17+ or 22.9+ and npm. Node.js 21 is not supported by the current npm/Vitest toolchain.

```sh
npm install
cp .env.example .env
npm run dev
```

The web console runs at `http://localhost:3000`; the API runs at `http://localhost:4100`. Root `npm run dev` starts only those two apps. In the default environment, storage is in-memory and execution is simulated, so Redis, PostgreSQL, Docker, and an OpenAI key are not required.

Useful focused commands:

```sh
npm run dev -w @hiveswarm/api
npm run dev -w @hiveswarm/web
npm run typecheck -w @hiveswarm/api
npm run typecheck -w @hiveswarm/worker
npm run typecheck -w @hiveswarm/web
npm run test -w @hiveswarm/api -- src/policy.test.ts
```

Use `.env.example` as documentation, not as a place for real secrets. Keep local `.env` files untracked. Do not silently change development from `memory`/`simulated` to `postgres`/`queue`.

## Complete-stack development

The complete stack is for integration work, not the default proof for ordinary changes:

```sh
docker compose -f docker-compose.agents.yml --profile agents build
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml up --build
```

Without `docker-compose.docker-worker.yml`, Compose uses a simulated worker. The Docker worker override mounts the Docker socket and therefore requires deliberate operator consent and a suitable host. The `agents` profile is a build catalog; specialist containers are launched on demand.

Before real execution:

- confirm written authorization, exact targets, exclusions, rate limits, credentials, maintenance windows, and evidence-retention rules;
- review the installed manifest and image provenance;
- use a dedicated or rootless/remote worker where possible;
- apply allowlist-aware egress outside the application;
- set strong, distinct database and callback secrets;
- set `HIVESWARM_SOURCE_ROOT` only when source review is authorized.

Stop only processes and containers you started. Do not use broad process-name kills or tear down shared Compose resources without checking ownership.

## Verification

Use the smallest proof proportional to the change:

- policy, orchestration, persistence, reporting, and callback changes need focused API tests;
- contract changes need typechecks for every affected workspace;
- worker or manifest changes need a TypeScript build plus validation of the relevant runtime/event path;
- frontend changes need web typecheck and build when routing, server/client boundaries, or production bundling could be affected;
- Compose changes need a merged configuration check;
- safety-boundary changes should include both an allowed case and the corresponding rejection case.

The standard full verification is:

```sh
npm run typecheck
npm test
npm run build
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml -f docker-compose.agents.yml --profile agents config --quiet
```

Do not reflexively run the full stack or real scanners to prove an isolated change. Never make tests depend on public targets, live credentials, a local Docker socket, or provider availability. Prefer deterministic providers, in-memory stores, simulated execution, and bounded fixtures.

## How it works

The console calls the Fastify API over HTTP and refreshes from server-sent events. The API loads the enabled manifest catalog and asks a `ModelProvider` to produce calls to one typed `spawn_specialist` operation; without a provider key, a deterministic fallback creates a bounded starter plan. Every proposed spawn is checked against manifest, lifecycle, recursion, scope, capability, and approval policy before dispatch.

Queue execution sends jobs through Redis. The worker resolves the installed manifest, starts a constrained container, translates typed NDJSON stdout into authenticated callbacks, and handles lifecycle controls on a separate queue. The API materializes project-partitioned state and publishes updates. Reports derive severity totals, coverage, paths, artifacts, and limitations from that state.

The current PostgreSQL implementation stores transactional JSONB snapshots per project and serializes mutations inside one API process. Do not imply horizontal safety from that model; scaled APIs need database-level concurrency or an event-sourced reducer.

## Where code lives

- `apps/api` — Fastify routes, orchestration, policy, provider adapters, event streaming, reporting, execution dispatch, and memory/PostgreSQL stores.
- `apps/worker` — Redis consumers, Docker lifecycle, repository/artifact mounts, runtime environment allowlisting, control jobs, and callback forwarding.
- `apps/web` — Next.js App Router console. `app/ui/hive-console.tsx` currently coordinates most client data and actions; graph, dialogs, registry, scope, approval, and report views are split beneath `app/ui`.
- `packages/contracts` — shared Zod schemas and inferred TypeScript types for manifests, requests, state, events, evidence, approvals, and projects. Keep it lightweight and runtime-safe.
- `agents/*/agent.json` — installed specialist manifests.
- `agents/runtime` — shared purpose-built runtime and bundled offline data/rules.
- `agents/freeform-ubuntu` — reviewed command-plan escape hatch; preserve its stricter capability and redaction model.
- `agents/burp-suite` — bring-your-own-JAR launcher. Never download, redistribute, bypass activation, or log Burp license material.
- `docker` and `docker-compose*.yml` — control-plane images, infrastructure, agent image catalog, and the explicit Docker-worker authority override.
- `docs` — architecture, operations, and agent-package contract.

## UI system

- Standardize new and migrated console UI on shadcn/ui. Treat its local, reviewable components as the shared primitive layer rather than hand-building another button, dialog, input, menu, table, badge, or similar control inside a feature.
- Keep shadcn primitives in a dedicated shared component directory and compose feature-specific components from them. Do not put application state, API calls, or HiveSwarm policy decisions into the primitive layer.
- Use Tailwind utilities and semantic theme tokens for routine layout, spacing, typography, color, borders, and interaction states. Avoid growing a global stylesheet with feature-specific selectors or accumulating large strings of one-off values.
- Raw CSS is reserved for behavior that component primitives and utilities do not express cleanly, such as graph-library integration or genuinely specialized visualization. Keep that CSS colocated, bounded, and documented when its purpose is not obvious.
- Migrate existing custom controls incrementally when touching their feature. Do not maintain parallel custom and shadcn versions of the same primitive, and do not turn an otherwise focused change into a wholesale visual rewrite.

## Code taste

- Keep policy deterministic, local, and testable. Models may propose; they do not decide authorization.
- Put provider-specific translation behind `ModelProvider` and package-specific behavior behind the manifest/runtime boundary.
- Prefer inferred types from Zod schemas. Avoid `any`, parallel hand-written wire types, and unchecked casts at trust boundaries.
- Preserve structured events. Do not parse presentation strings to recover state that should have been typed.
- Keep evidence bounded and secrets redacted at ingestion and emission points.
- Use explicit project and run identifiers for mutations. Convenience defaults are for local reads, not ownership decisions.
- Favor purpose-built specialists over freeform shell plans. The escape hatch should remain conspicuous and narrower at execution time than at registration.
- Keep the console honest: no lying progress, stale project data, inaccessible controls, or decorative activity that obscures approvals and risk.
- Comments should explain invariants, trust boundaries, or non-obvious use—not narrate straightforward code.
- One concern per change. Avoid opportunistic refactors in policy, execution, persistence, or security-sensitive paths.

## Pull requests and commits

- Do not create a pull request unless explicitly asked.
- Use concise conventional commit subjects, for example `fix(policy): keep denied hosts out of scope`.
- Explain the operator-visible problem and how the change preserves authority and evidence integrity.
- UI changes should include before/after images when practical; timing or interaction changes benefit from a short recording.
- Call out migrations, new capabilities, new network behavior, Docker authority, source mounts, secret handling, or production gaps explicitly.
- Never describe HiveSwarm as a hardened multi-user or internet-facing assessment appliance. The current repository is a trusted-local-operator alpha until the production gaps in `docs/operations.md` are addressed.
