"use client";

import type { AgentManifest } from "@hiveswarm/contracts";
import { Box, Download, Shield, TerminalSquare } from "lucide-react";
import { useState } from "react";

export function RegistryView({ agents, onInstall }: { agents: AgentManifest[]; onInstall: (manifest: unknown) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="management-view" aria-labelledby="registry-title">
      <div className="management-heading">
        <div><p className="eyebrow">Mutable specialist catalog</p><h1 id="registry-title">Agent registry</h1><p>Install or replace container-backed roles without changing the orchestrator.</p></div>
        <span className="count-pill"><Box size={15} aria-hidden="true" />{agents.length} installed</span>
      </div>
      <div className="registry-grid">
        {agents.map((agent) => (
          <article className="registry-card" key={`${agent.id}-${agent.version}`}>
            <div className="registry-card__head"><span><TerminalSquare size={18} aria-hidden="true" /></span><div><h3>{agent.name}</h3><p>{agent.role} · v{agent.version}</p></div><i className={agent.enabled ? "is-enabled" : ""}>{agent.enabled ? "Enabled" : "Disabled"}</i></div>
            <p>{agent.description}</p>
            <dl><div><dt>Image</dt><dd><bdi>{agent.image}</bdi></dd></div><div><dt>Lifecycle</dt><dd>{agent.lifecycle.join(" · ")}</dd></div><div><dt>Capabilities</dt><dd>{agent.capabilities.length}</dd></div></dl>
            <div className="tag-list" aria-label={`${agent.name} skills`}>{agent.skills.slice(0, 4).map((skill) => <span key={skill}>{skill}</span>)}</div>
          </article>
        ))}
      </div>
      <details className="install-panel">
        <summary><Download size={17} aria-hidden="true" /><span>Install a manifest</span><small>JSON · schema v1</small></summary>
        <form onSubmit={async (event) => {
          event.preventDefault(); setBusy(true); setError("");
          const form = event.currentTarget;
          const data = new FormData(form);
          try { await onInstall(JSON.parse(String(data.get("manifest")))); form.reset(); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to install the manifest."); }
          finally { setBusy(false); }
        }}>
          <label htmlFor="manifest-json">Agent manifest</label>
          <textarea id="manifest-json" name="manifest" aria-label="Agent manifest JSON" rows={10} required spellCheck={false} placeholder={'{\n  "schemaVersion": "1",\n  "id": "custom-agent"\n}'} />
          <p><Shield size={15} aria-hidden="true" />HiveSwarm validates identity, lifecycle, capabilities, and configuration before registration.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary" aria-label="Install agent manifest" disabled={busy}>{busy ? "Installing manifest" : "Install manifest"}</button>
        </form>
      </details>
    </section>
  );
}
