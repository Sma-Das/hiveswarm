# Agent package contract

An agent package is a versioned manifest plus a container image. Install a package with `POST /api/agents/install`; the orchestrator discovers it through `GET /api/agents`.

Required manifest concepts:

- `id` and semantic `version` identify an immutable package version.
- `role`, `description`, `skills`, `accepts`, and `emits` tell the orchestrator when the specialist is useful.
- `lifecycle` declares whether it can run as an ephemeral task, a reusable session, or both.
- `capabilities` are enforced permissions, not marketing metadata.
- `image` and `command` are the swappable runtime boundary.
- `configuration` declares secrets and non-secret configuration without embedding values.

Containers receive the task through `HIVESWARM_*` environment variables and write logs to stdout. Rich evidence is posted to the callback API as one of five typed events: `log`, `node`, `edge`, `finding`, or `scope_proposal`.

Burp Community runs as an interactive session and does not require a license. Providing `BURP_LICENSE_KEY` enables a future Pro automation adapter while keeping the same `burp-suite` role and evidence contract. Do not place the key in a manifest or image; inject it from a secret manager.

## Installing an example manifest

```sh
curl -X POST http://localhost:4100/api/agents/install \
  -H 'content-type: application/json' \
  --data-binary @agents/port-scanner/agent.json
```

Package installation registers metadata. It does not pull or execute the image. This separation permits signature verification, vulnerability scanning, and administrator approval to be added before image admission.
