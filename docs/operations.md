# Operating HiveSwarm

## Safe startup

1. Confirm written authorization, maintenance windows, rate limits, credentials, excluded hosts, and evidence-retention requirements.
2. Set a strong `POSTGRES_PASSWORD` and `AGENT_CALLBACK_TOKEN` in `.env`.
3. Set `HIVESWARM_SOURCE_ROOT` only when source review is authorized.
4. Review every manifest and build the specialist images.
5. Start the simulated stack first, create the engagement, and inspect its exact scope rules.
6. Enable the Docker worker only on a dedicated host and after applying an allowlist-aware egress control.

```sh
docker compose -f docker-compose.agents.yml --profile agents build
docker compose up --build
# After policy review:
docker compose -f docker-compose.yml -f docker-compose.docker-worker.yml up --build
```

The `agents` Compose profile is a build catalog, not a long-running service set. The worker launches images on demand.

## Engagement workflow

Create an engagement in the console. HiveSwarm adds one exact-host allow rule inferred from the primary URL/host. Add domain, URL-prefix, CIDR, and repository rules in Scope. Explicit deny rules always win. Use Run orchestrator to start the provider-selected or deterministic initial swarm.

Scope proposals and sensitive capabilities pause only the affected action for a human decision. Approve once does not create a reusable capability grant. Explorer host approvals do create the exact requested allow rule and remove a matching exact deny rule. The activity feed and audit table preserve the decision trail.

Pause freezes active containers and prevents new spawns. Resume unfreezes sessions and dispatches queued agents. Terminate stops one selected specialist. Container controls are asynchronous, while API state changes immediately for operator feedback.

## Artifacts and reports

Screenshots and reports are written to `hiveswarm-artifacts`, served through path-validated API routes, and linked from Report. The Markdown export is a live snapshot: retain it together with raw logs, screenshots, scope, tool versions, and authorization records according to the engagement's evidence policy.

## Burp preparation

1. Download the current unified Burp JAR directly from PortSwigger and accept its license terms.
2. Put it into the named volume as `burp.jar`. One option is to mount the downloaded file into a short-lived copy container:

   ```sh
   docker volume create hiveswarm-burp
   docker run --rm -v hiveswarm-burp:/opt/burp -v "$PWD:/input:ro" busybox \
     cp /input/burp.jar /opt/burp/burp.jar
   ```

3. Complete Community acceptance or Pro activation in an operator-controlled Burp GUI. If `BURP_LICENSE_KEY` is set, the runtime stages it privately for the supported wizard; it never prints the key.
4. Export reviewed user/project configuration into the volume. Configure the proxy listener, interception/match-and-replace behavior, target scope, project persistence, and—if used—the authenticated REST API.
5. Start the Burp session from HiveSwarm. Treat Burp project/config files as executable security policy: never import untrusted ones.

PortSwigger's default listener is loopback-only. To connect a separate browser container, use a reviewed project configuration bound to the agent network and route that browser explicitly through the Burp container; do not publish the listener on a host or untrusted network.

## Production gaps

Before a multi-user or internet-reachable deployment, add API authentication, TLS, RBAC and tenant boundaries, an external secret manager, signed-image admission, destination-enforced egress, durable object storage, database-level concurrency, audit export, observability/alerts, backup/restore exercises, and retention/deletion workflows. The current stack is a functional local alpha, not a hardened assessment appliance.
