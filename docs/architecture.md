# HiveSwarm architecture

HiveSwarm is a manager-owned agent system. The orchestrator is independent of specialist implementations: it receives the live manifest catalog, chooses roles from that catalog, and invokes them through one typed spawn operation. A package can be added, versioned, or replaced without editing the orchestration prompt.

```text
Browser console ── HTTP + SSE ──> Orchestration API ── snapshot/audit ──> PostgreSQL
                                      │
                                      ├── model-provider interface
                                      │      ├── OpenAI Responses adapter
                                      │      └── deterministic fallback
                                      │
                                      └── execution + control jobs ──> Redis
                                                                         │
                                                                         v
                                                                  Docker worker
                                                                         │
                                              typed NDJSON + artifacts ──┘
```

## Control flow

1. A human creates a project with at least one explicit allow boundary. Projects are independently addressable snapshots; switching the visible project does not redirect callbacks, controls, or model work already running in another project.
2. The orchestrator reads enabled manifests and asks a model provider to call `spawn_specialist`; without a provider key it produces the same bounded starter plan deterministically.
3. Every call is revalidated locally. Model output cannot grant scope, lifecycle, recursion, or capability authority.
4. Approved executions enter Redis. The worker resolves the current installed manifest, creates a constrained container, and translates its typed NDJSON into authenticated API callbacks.
5. Nodes, relationships, findings, screenshots, logs, child spawn requests, and scope proposals update the materialized graph and stream to the console.
6. The report generator derives risk totals, vulnerability paths, coverage, artifacts, and limitations from current evidence.

## Project and graph model

Every agent execution carries its originating run ID. The API resolves run, agent, approval, and callback mutations to that project rather than relying on the console's active project. Scope writes and report reads also accept an explicit project ID. This keeps simultaneous or background evaluations isolated while retaining a lightweight active-project preference for the local console.

The materialized evidence model supports several connected projections instead of one overloaded graph:

- topology connects servers, services, vhosts, applications, routes, repositories, identities, and findings;
- swarm connects the orchestrator, recursive task/session agents, lifecycle state, and the findings each branch raised;
- scope connects allow/deny rules and explorer proposals awaiting human review;
- finding paths walk backward through supporting evidence and open in a side drawer with the underlying structured node data.

These are views over the same typed nodes, edges, executions, and finding records, so selecting a finding can move from execution provenance to its application attack path without duplicating evidence.

## Agent tree and lifecycle

The root orchestrator is depth zero. The API computes every child's depth from its stored parent; callers cannot self-report depth. Depth six is rejected, so specialists may recurse through depth five. Task agents finish after a bounded assignment. Session agents remain available until terminated. Pause/resume and terminate use a separate control queue and affect running, starting, and approval-waiting containers.

## Trust boundaries

1. Browser and model output are untrusted inputs. Mutation bodies and model tool arguments are schema validated.
2. Deny rules override allow rules. Unmatched targets and sensitive capabilities become human decisions rather than jobs.
3. Agent images are executable code. Installation validates the manifest, but operators must review provenance and scan/sign images before admission.
4. Containers use a read-only root filesystem, dropped Linux capabilities, `no-new-privileges`, CPU/memory/PID limits, bounded temporary storage, and no network for source-only agents.
5. Network-capable agents currently join a dedicated bridge. This is isolation, not destination enforcement. A production deployment must apply the same scope policy at DNS and connection time through an egress proxy/firewall.
6. Source repositories are selected beneath one configured host root and mounted read-only. Artifacts use a separate volume and safe API paths.
7. Worker callbacks use a dedicated bearer secret. Package changes, scope changes, decisions, lifecycle controls, and spawns are auditable.
8. The freeform Ubuntu package is capability-rich at registration but receives only the capabilities approved on its individual run. `shell.execute` always requires a visible command plan and a human decision. Commands run without stdin, Docker socket, inherited secrets, or host writes; networking and read-only source mounts are separately gated. Purpose-built packages remain the preferred path because their behavior is narrower and easier to review.

The included API has no end-user authentication and is intended for a trusted local operator network. Do not expose it directly to the internet; add TLS, SSO/RBAC, tenant isolation, secret management, signed-image admission, and a normalized append-only evidence store before production use.

## Persistence and concurrency

The current implementation stores one materialized dashboard per project in transactional PostgreSQL JSONB snapshots, with a small workspace record for the active project and agent versions/audit events in separate tables. Legacy single-dashboard data is migrated non-destructively on startup. Every mutation resolves an explicit project, run, agent run, or approval owner before changing state. The memory adapter serializes these mutations and the PostgreSQL adapter locks the owning project row for the transaction, so background execution cannot follow the console's active-project preference and concurrent callbacks do not overwrite each other inside one API process. Audit rows and published events still follow the snapshot commit rather than sharing a durable outbox; horizontally scaled APIs need an outbox or event-sourced reducer for atomic delivery.

## Extensibility

`ModelProvider`, `StateStore`, `ExecutionDriver`, and the manifest/event schemas are explicit boundaries. The first model adapter uses OpenAI Responses function calls with strict tool schemas, `store: false`, and an engagement-scoped safety identifier. Adding another provider requires translating its tool calls at the provider boundary; policy and execution stay unchanged.
