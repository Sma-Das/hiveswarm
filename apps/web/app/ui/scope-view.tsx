"use client";

import type { Dashboard, GraphNode, ScopeRule } from "@hiveswarm/contracts";
import { Ban, Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ScopeGraph } from "./security-graph";

export function ScopeView({ dashboard, onAdd, onRemove, onInspect }: {
  dashboard: Dashboard;
  onAdd: (rule: Omit<ScopeRule, "id">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onInspect: (node: GraphNode | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="management-view" aria-labelledby="scope-title">
      <div className="management-heading"><div><p className="eyebrow">Deny by default</p><h1 id="scope-title">Scope policy</h1><p>Every specialist target is checked against these ordered boundaries before execution.</p></div></div>
      <div className="scope-graph-panel"><ScopeGraph dashboard={dashboard} onSelect={onInspect} /></div>
      <form className="scope-form" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        const form = event.currentTarget;
        const data = new FormData(form);
        try {
          await onAdd({ kind: String(data.get("kind")) as ScopeRule["kind"], value: String(data.get("value")), action: String(data.get("action")) as ScopeRule["action"] });
          form.reset();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to add the scope rule."); }
        finally { setBusy(false); }
      }}>
        <label>Decision<select name="action" aria-label="Scope decision" defaultValue="allow"><option value="allow">Allow</option><option value="deny">Deny</option></select></label>
        <label>Boundary type<select name="kind" aria-label="Scope boundary type" defaultValue="domain"><option value="host">Host</option><option value="domain">Domain</option><option value="cidr">CIDR</option><option value="url-prefix">URL prefix</option><option value="repository">Repository</option></select></label>
        <label className="scope-form__value">Boundary value<input name="value" aria-label="Scope boundary value" required placeholder="*.example.test" /></label>
        <button className="button button--primary" disabled={busy}><Plus size={16} aria-hidden="true" />{busy ? "Adding rule" : "Add rule"}</button>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
      <div className="scope-list">
        {dashboard.engagement.scopeRules.map((rule) => (
          <article key={rule.id} className={`scope-rule scope-rule--${rule.action}`}>
            <span>{rule.action === "allow" ? <Check size={17} aria-hidden="true" /> : <Ban size={17} aria-hidden="true" />}</span>
            <div><strong>{rule.action === "allow" ? "Allow" : "Deny"} {rule.kind}</strong><bdi>{rule.value}</bdi></div>
            <button className="icon-button" aria-label={`Remove ${rule.action} rule for ${rule.value}`} onClick={async () => {
              const consequence = rule.action === "allow" ? "Matching requests will be denied unless another allow rule applies." : "Matching requests may be allowed by another rule.";
              if (!window.confirm(`Remove the ${rule.action} rule for ${rule.value}? ${consequence}`)) return;
              setError("");
              try { await onRemove(rule.id); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to remove the scope rule."); }
            }}><Trash2 size={16} aria-hidden="true" /></button>
          </article>
        ))}
      </div>
    </section>
  );
}
