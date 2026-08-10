import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentManifestSchema, type AgentManifest } from "@hiveswarm/contracts";
import type { StateStore } from "./store.js";

export class AgentRegistry {
  constructor(private readonly store: StateStore, private readonly root: string) {}

  async initialize() {
    let entries: string[] = [];
    try {
      entries = await readdir(this.root);
    } catch {
      return;
    }

    for (const entry of entries) {
      try {
        const raw = await readFile(join(this.root, entry, "agent.json"), "utf8");
        await this.store.upsertManifest(agentManifestSchema.parse(JSON.parse(raw)));
      } catch (error) {
        if (!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
  }

  async list() {
    const installed = await this.store.listManifests();
    const latest = new Map<string, AgentManifest>();
    for (const manifest of installed.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))) {
      if (!latest.has(manifest.id)) latest.set(manifest.id, manifest);
    }
    return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(agentId: string): Promise<AgentManifest | undefined> {
    const manifests = await this.list();
    return manifests.find((manifest) => manifest.id === agentId && manifest.enabled);
  }

  async install(input: unknown) {
    const manifest = agentManifestSchema.parse(input);
    await this.store.upsertManifest(manifest);
    return manifest;
  }
}
