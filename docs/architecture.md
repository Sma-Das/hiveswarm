# HiveSwarm architecture

HiveSwarm is a manager-owned multi-agent system. The orchestrator retains responsibility for the evaluation and calls registered specialists as bounded capabilities. A specialist never receives authority merely because its prompt requests it.

```text
Web console ──HTTP/SSE──> Orchestration API ──snapshots/audit──> PostgreSQL
                              │
                              ├──planning──> model provider adapter
                              │
                              └──jobs──────> Redis ──> execution worker ──> agent container
                                                              │
                                                              └──typed evidence callbacks
```

## Trust boundaries

1. The browser is untrusted input. The API validates all mutation bodies.
2. Model output is advisory. The policy engine independently checks the target, requested capabilities, lifecycle, parent execution, and recursion depth.
3. Agent containers are untrusted workloads. Docker mode drops Linux capabilities, enables `no-new-privileges`, uses a read-only root filesystem, limits CPU/memory/PIDs, and gives each workload only a temporary `/tmp`.
4. Agent callbacks are typed and authenticated with a separate callback token.
5. Human decisions and package installation create append-only audit events.

## Recursion

The root orchestrator has depth zero. Its children have depth one. Each spawn request identifies its parent execution, and the API computes depth from stored state. Requests that would create depth six are rejected. A child cannot self-report a smaller depth.

## Scope and capability policy

Deny rules take precedence over allow rules. Targets without an allow-rule match create a scope-expansion request rather than executing. High-rate scanning, credential use, and exploit execution require one-time human approval. The initial Docker worker network is an integration point, not a production-grade egress firewall; production deployments should route it through a policy-aware egress proxy that resolves DNS and applies the same allowlist at connection time.

## Persistence model

The MVP stores the materialized dashboard graph in a transactional PostgreSQL JSONB snapshot and stores agent package versions and audit events separately. The API is already isolated behind `StateStore`, allowing later normalization of large graphs without changing orchestration or UI contracts.

## Provider strategy

`Planner` is provider-neutral. Without an API key, HiveSwarm uses a deterministic safe plan. With `OPENAI_API_KEY`, it uses the OpenAI Responses API with a strict JSON schema and a privacy-preserving engagement safety identifier. Planning selects registered roles; execution and approval remain local responsibilities.
