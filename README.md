# HiveSwarm

HiveSwarm is a human-governed, multi-agent application-security evaluation platform. A provider-neutral orchestrator discovers swappable specialist packages, applies scope and capability policy, runs their containers, and turns typed evidence into an explorable asset and vulnerability-path graph.

This repository implements the core vertical slice:

- model-directed orchestration through a provider interface, with OpenAI Responses function calling first and a deterministic offline fallback;
- versioned runtime installation and discovery for 13 agents;
- task and session lifecycles, pause/resume/terminate controls, and recursive spawning to depth five;
- deny-by-default target policy, one-time human approval gates, audit events, bounded scan settings, and authenticated worker callbacks;
- real adapters for Playwright, Nmap, Gobuster, Subfinder, Semgrep, TruffleHog, and a license-safe bring-your-own-JAR Burp runtime;
- project-partitioned PostgreSQL persistence, Redis dispatch, isolated Docker execution, SSE updates, and artifact storage;
- a responsive Next.js console with fast project switching, live swarm and scope graphs, searchable application topology, finding-path drill-downs, logs, registry, approvals, and Markdown reports.

## Local preview

Requirements: Node.js 20.17+ or 22.9+ and npm. Node.js 21 is not supported by the current npm/Vitest toolchain.

```sh
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. The API runs at `http://localhost:4100`. Local development intentionally uses in-memory state and simulated execution, so the complete policy and UI flow can be evaluated without granting Docker authority or scanning a target.

Use the project control in the top bar to switch assessments, and **New project** in navigation to create one. Each project owns an independent scope, run tree, graph, finding set, artifacts, activity stream, and report.

The laptop-first console uses a light theme, shared shadcn/ui controls, and dedicated views for Overview, Assets, Findings, Specialists, Activity, Approvals, Scope, Report, and the agent registry. Overview brings pending decisions alongside the asset graph. Assets and Specialists offer list and graph views; Findings supports severity filtering, sorting, and evidence-path inspection. Details open in a keyboard-accessible sheet rather than permanently taking space from the workspace. On phones, navigation opens from the menu and run controls remain available.

Approvals has a pending queue and decision history. It distinguishes one-time execution permission from scope proposals that update project rules. Reports include specialist coverage, evidence paths, artifacts, and limitations. Interrupted live updates display a stale-data warning. View URLs such as `/?view=findings` support bookmarking and browser history for the currently selected project.

## Hosted demo

The Vercel demo is intentionally split into a Next.js project rooted at `apps/web` and a Node function project rooted at the repository. The path-preserving API function adapter lives in `api/index.ts`; Vercel builds the shared contracts package before bundling either application.

Keep a public demo on `STORAGE_DRIVER=memory` and `EXECUTION_DRIVER=simulated`, set a strong `AGENT_CALLBACK_TOKEN`, and leave `OPENAI_API_KEY`, Redis, PostgreSQL, Docker, source mounts, and scanner credentials unset. Set `NEXT_PUBLIC_API_URL` to the API project URL and `WEB_ORIGIN` to a comma-separated exact allowlist of the console origins. Demo state is ephemeral and may reset between function instances, so it must not be used for real engagements or sensitive evidence.

## Complete stack

Copy `.env.example` to `.env`, replace the development callback token and database password, and optionally provide `OPENAI_API_KEY`. Then build the specialist images and start the control plane:

```sh
docker compose -f docker-compose.agents.yml --profile agents build
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml up --build
```

The Docker worker override grants the worker access to the Docker socket. That is a material host-level trust boundary: use a dedicated machine or rootless/remote worker, review installed manifests and images, and place the agent network behind an allowlist-aware egress gateway before shared or production deployment.

Without the Docker override, `docker compose up --build` runs PostgreSQL, Redis, API, console, and a simulated worker.

## Built-in specialists

| Agent | Lifecycle | Runtime |
| --- | --- | --- |
| Explorer | task or session | rendered Playwright discovery and human scope proposals |
| Browser user | task or session | browser workflows and screenshots |
| Burp Suite | session | headless proxy using an operator-supplied Community/Pro JAR |
| Source review | task or session | business-logic triage; delegates Semgrep and TruffleHog |
| Semgrep | task | bundled offline SAST rules |
| TruffleHog | task | redacted secret evidence |
| Directory enumerator | task | rate-bounded Gobuster paths |
| Port scanner | task | rate-bounded Nmap service discovery |
| Subdomain/vhost enumerator | task | bounded Gobuster DNS discovery |
| Subfinder | task | rate-bounded passive subdomain discovery |
| Reporter | task or session | artifact and live report coordination |
| Freeform Ubuntu | task | human-reviewed command plans in an isolated Ubuntu toolbox |
| Orchestrator | session | registry-aware evaluation manager |

Source agents use targets such as `repository:team/service`. Set `HIVESWARM_SOURCE_ROOT` to the absolute host directory containing those repositories; the worker rejects path traversal and mounts only the selected repository read-only.

Freeform Ubuntu is the controlled fallback for goals that do not fit a purpose-built specialist. It never receives an interactive host shell: the orchestrator must submit one to twelve exact commands, request `shell.execute`, and wait for human approval. Network, source, credential, high-rate, and exploit capabilities remain separately requested. The worker runs the approved plan in a read-only-root Ubuntu task container with dropped capabilities, bounded resources, a private workspace, no Docker socket, network disabled unless approved, redacted output, and a structured results artifact.

## Configuration

- `STORAGE_DRIVER`: `memory` or `postgres`.
- `WEB_PORT` / `API_PORT`: optional host-port overrides for Compose; defaults are `3000` and `4100`.
- `EXECUTION_DRIVER`: `simulated` or `queue`.
- `WORKER_MODE`: `simulated` or `docker`.
- `OPENAI_API_KEY`: optional; activates model-directed orchestration.
- `OPENAI_MODEL`: defaults to `gpt-5.6-terra`.
- `AGENT_CALLBACK_TOKEN`: separate secret for worker-to-API evidence callbacks.
- `HIVESWARM_SOURCE_ROOT`: authorized host root for `repository:` targets.
- `BURP_LICENSE_KEY`: optional key staged privately for Burp's supported first-run Pro activation; activation is not bypassed or automated.

See [architecture](docs/architecture.md), [agent packages](docs/agent-packages.md), and [operations](docs/operations.md).

## Verification

```sh
npm run typecheck
npm test
npm run test -w @hiveswarm/web
npm run build
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml -f docker-compose.agents.yml --profile agents config --quiet
```

Browser verification uses deterministic, intercepted API fixtures and does not run scanners or require a running API:

```sh
npm exec -w @hiveswarm/web playwright install chromium
npm run test:e2e -w @hiveswarm/web
```

The browser suite checks desktop and mobile workflows, control alignment, graph containment, focus restoration, project switching, reports, and automated WCAG checks. Screenshots and failed-test traces are written under `apps/web/test-results`. See the [console redesign review](docs/console-redesign.md) for design decisions and verification limits.

Only test systems you own or are explicitly authorized to assess. HiveSwarm's controls reduce mistakes; they do not replace written authorization, target-side rate limits, data-handling rules, backups, or professional judgment.
