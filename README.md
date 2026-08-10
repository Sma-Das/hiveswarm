# HiveSwarm

HiveSwarm is a human-governed, multi-agent application security evaluation platform. An agnostic orchestrator selects swappable specialist agents, preserves scope, and turns their evidence into an explorable asset and attack-path graph.

The first vertical slice includes:

- versioned specialist registration and installation;
- task and session lifecycles with recursive spawning to depth five;
- explicit scope and capability enforcement with human approval gates;
- Redis-backed dispatch and isolated worker/container boundaries;
- PostgreSQL snapshots, package versions, and audit events;
- typed logs, assets, relationships, findings, and scope proposals;
- a live Next.js console for swarm state, evidence graphs, findings, activity, and approvals;
- built-in manifests for Explorer, browser use, Burp Suite, source review, directory enumeration, port scanning, subdomain/vhost discovery, and reporting.

## Run locally

Requirements: Node.js 20.17+ or 22.9+ and npm. Node.js 21 is not supported by the current npm/Vitest toolchain.

```sh
npm install
cp .env.example .env
npm run dev
```

The console is at `http://localhost:3000`; the API is at `http://localhost:4100`. Local development defaults to in-memory persistence and simulated execution, while preserving the full API flow.

## Run the complete stack

```sh
docker compose up --build
```

Compose enables PostgreSQL, Redis, the queued execution worker, API, and console. The worker defaults to simulation so the stack does not receive Docker host authority accidentally.

To opt into real local agent containers, review the security implications of Docker socket access, install/tag the images referenced by the manifests, add a policy-aware egress gateway, and then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml up --build
```

The override intentionally makes a material trust-boundary change. Do not use an unrestricted Docker socket or unrestricted egress in a shared production environment.

## Configuration

- `STORAGE_DRIVER`: `memory` or `postgres`.
- `EXECUTION_DRIVER`: `simulated` or `queue`.
- `WORKER_MODE`: `simulated` or `docker`.
- `OPENAI_API_KEY`: optional; enables model-planned agent selection.
- `OPENAI_MODEL`: defaults to `gpt-5.6-terra`.
- `BURP_LICENSE_KEY`: optional Pro automation credential; Community remains interactive.
- `AGENT_CALLBACK_TOKEN`: separate secret for worker-to-API evidence callbacks.

Read [architecture](docs/architecture.md) for trust boundaries and [agent packages](docs/agent-packages.md) for the plugin contract.

## Development checks

```sh
npm run typecheck
npm test
npm run build
```

Only test systems you own or are explicitly authorized to assess. Scope rules and approval gates reduce mistakes but do not replace written authorization, rate limits, data-handling requirements, or operator judgment.
