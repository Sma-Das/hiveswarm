import type { AgentManifest, AgentRun } from "@hiveswarm/contracts";
import type Docker from "dockerode";
import { resolve, sep } from "node:path";

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

type PackageProfile = {
  memoryMiB?: number;
  nanoCpus?: number;
  mounts?: (environment: WorkerEnvironment) => Docker.MountSettings[];
  tmpfs?: Record<string, string>;
  environment?: (agentRun: AgentRun) => string[];
};

const reviewedPackageProfiles: Readonly<Record<string, PackageProfile>> = {
  "burp-suite": {
    memoryMiB: 4_096,
    nanoCpus: 2,
    mounts: (environment) => [{ Type: "volume", Source: environment.BURP_VOLUME ?? "hiveswarm-burp", Target: "/opt/burp", ReadOnly: false }],
  },
  "freeform-ubuntu": {
    memoryMiB: 1_536,
    tmpfs: { "/workspace": "rw,nosuid,size=256m" },
    environment: (agentRun) => [`HIVESWARM_EXECUTION_PLAN_B64=${Buffer.from(JSON.stringify(agentRun.executionPlan ?? [])).toString("base64url")}`],
  },
  semgrep: { memoryMiB: 1_536 },
};

function sourceMount(agentRun: AgentRun, environment: WorkerEnvironment): Docker.MountSettings {
  const sourceRoot = environment.HIVESWARM_SOURCE_ROOT;
  const repository = agentRun.target.startsWith("repository:") ? agentRun.target.slice("repository:".length) : "";
  if (!sourceRoot || !repository) throw new Error("Source agents require a repository: target and HIVESWARM_SOURCE_ROOT on the Docker host.");
  const root = resolve(sourceRoot);
  const source = resolve(root, repository);
  if (source === root || !source.startsWith(`${root}${sep}`)) throw new Error("Repository target escapes HIVESWARM_SOURCE_ROOT.");
  return { Type: "bind", Source: source, Target: "/target", ReadOnly: true };
}

export function compileExecutionPlan(
  agentRun: AgentRun,
  manifest: AgentManifest,
  apiUrl: string,
  environment: WorkerEnvironment,
): Docker.ContainerCreateOptions {
  const requestedCapabilities = agentRun.requestedCapabilities ?? [];
  const undeclared = requestedCapabilities.find((capability) => !manifest.capabilities.includes(capability));
  if (undeclared) throw new Error(`${manifest.name} execution requested undeclared capability ${undeclared}.`);

  const profile = reviewedPackageProfiles[manifest.id] ?? {};
  const needsNetwork = requestedCapabilities.some((capability) => capability.startsWith("network.") || capability === "browser.interactive" || capability === "proxy.intercept");
  const mounts: Docker.MountSettings[] = [
    { Type: "volume", Source: environment.ARTIFACT_VOLUME ?? "hiveswarm-artifacts", Target: "/artifacts", ReadOnly: false },
    ...(requestedCapabilities.includes("source.read") ? [sourceMount(agentRun, environment)] : []),
    ...(profile.mounts?.(environment) ?? []),
  ];
  const configuredEnvironment = manifest.configuration.flatMap(({ key, required }) => {
    const value = environment[key];
    if (required && !value) throw new Error(`${manifest.name} requires worker configuration ${key}.`);
    return value ? [`${key}=${value}`] : [];
  });
  const memoryMiB = profile.memoryMiB ?? (requestedCapabilities.includes("browser.interactive") ? 1_536 : 512);

  return {
    Image: manifest.image,
    Cmd: manifest.command,
    Env: [
      `HIVESWARM_AGENT_ID=${manifest.id}`,
      `HIVESWARM_AGENT_RUN_ID=${agentRun.id}`,
      `HIVESWARM_TASK=${agentRun.task}`,
      `HIVESWARM_TARGET=${agentRun.target}`,
      `HIVESWARM_LIFECYCLE=${agentRun.lifecycle}`,
      `HIVESWARM_DEPTH=${agentRun.depth}`,
      `HIVESWARM_API_URL=${apiUrl}`,
      `HIVESWARM_ARTIFACT_DIR=/artifacts/${agentRun.id}`,
      `HIVESWARM_ARTIFACT_BASE=/api/artifacts/${agentRun.id}`,
      `HIVESWARM_REQUESTED_CAPABILITIES=${requestedCapabilities.join(",")}`,
      ...(profile.environment?.(agentRun) ?? []),
      ...(requestedCapabilities.includes("source.read") ? ["HIVESWARM_SOURCE_PATH=/target"] : []),
      ...configuredEnvironment,
    ],
    Labels: { "hiveswarm.agent": manifest.id, "hiveswarm.agent-run": agentRun.id },
    OpenStdin: agentRun.lifecycle === "session",
    Tty: false,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      NetworkMode: needsNetwork ? (environment.AGENT_NETWORK ?? "hiveswarm-egress") : "none",
      Memory: memoryMiB * 1024 * 1024,
      NanoCpus: (profile.nanoCpus ?? 1) * 1_000_000_000,
      PidsLimit: 256,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=128m", ...(profile.tmpfs ?? {}) },
      Mounts: mounts,
    },
  };
}
