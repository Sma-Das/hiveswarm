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

1. A human creates an engagement with at least one explicit allow boundary.
2. The orchestrator reads enabled manifests and asks a model provider to call `spawn_specialist`; without a provider key it produces the same bounded starter plan deterministically.
3. Every call is revalidated locally. Model output cannot grant scope, lifecycle, recursion, or capability authority.
4. Approved executions enter Redis. The worker resolves the current installed manifest, creates a constrained container, and translates its typed NDJSON into authenticated API callbacks.
5. Nodes, relationships, findings, screenshots, logs, child spawn requests, and scope proposals update the materialized graph and stream to the console.
6. The report generator derives risk totals, vulnerability paths, coverage, artifacts, and limitations from current evidence.

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

The included API has no end-user authentication and is intended for a trusted local operator network. Do not expose it directly to the internet; add TLS, SSO/RBAC, tenant isolation, secret management, signed-image admission, and a normalized append-only evidence store before production use.

## Persistence and concurrency

The current implementation stores a materialized dashboard in a transactional PostgreSQL JSONB snapshot, with agent versions and audit events in separate tables. API-process mutations are serialized to avoid callback races. This is sufficient for the vertical slice; horizontally scaled APIs should replace it with row-level transactions or an event-sourced reducer.

## Extensibility

`ModelProvider`, `StateStore`, `ExecutionDriver`, and the manifest/event schemas are explicit boundaries. The first model adapter uses OpenAI Responses function calls with strict tool schemas, `store: false`, and an engagement-scoped safety identifier. Adding another provider requires translating its tool calls at the provider boundary; policy and execution stay unchanged.
