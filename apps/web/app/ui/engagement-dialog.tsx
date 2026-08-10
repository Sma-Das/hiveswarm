"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function EngagementDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (input: { name: string; target: string }) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close(); }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="engagement-title">
      <form className="dialog__surface" onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError("");
        const data = new FormData(event.currentTarget);
        try { await onCreate({ name: String(data.get("name")), target: String(data.get("target")) }); onClose(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create the engagement."); }
        finally { setBusy(false); }
      }}>
        <div className="dialog__header"><div><p className="eyebrow">Authorized target</p><h2 id="engagement-title">Create an engagement</h2></div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} aria-hidden="true" /></button></div>
        <div className="form-grid">
          <label className="form-grid__wide">Engagement name<input name="name" aria-label="Engagement name" required placeholder="Northstar portal" /></label>
          <label className="form-grid__wide">Primary target<input name="target" aria-label="Primary target" required placeholder="https://app.example.test" /></label>
        </div>
        <p className="form-hint">HiveSwarm creates one exact-host allow rule. Add broader domain, URL, CIDR, or repository boundaries from Scope after creation.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog__actions"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={busy}>{busy ? "Creating engagement" : "Create engagement"}</button></div>
      </form>
    </dialog>
  );
}
