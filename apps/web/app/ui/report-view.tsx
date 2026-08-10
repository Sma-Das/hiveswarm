"use client";

import type { Artifact, Finding } from "@hiveswarm/contracts";
import { Download, FileText, GitFork, Paperclip } from "lucide-react";
import { SeverityBadge } from "./status";

export type ReportData = {
  generatedAt: string;
  executiveSummary: string;
  risk: Record<Finding["severity"], number>;
  findings: Finding[];
  attackPaths: Array<{ labels: string[]; relationships: string[] }>;
  coverage: Array<{ agent: string; lifecycle: string; status: string; task: string }>;
  artifacts: Artifact[];
  limitations: string[];
};

export function ReportView({ report, loading, apiUrl }: { report: ReportData | null; loading: boolean; apiUrl: string }) {
  if (loading || !report) return <section className="management-view"><div className="empty-panel" aria-busy="true"><FileText size={24} aria-hidden="true" /><h2>Generating the evaluation report</h2><p>Normalizing current findings, evidence, coverage, and vulnerability paths…</p></div></section>;
  return (
    <section className="management-view report-view" aria-labelledby="report-title">
      <div className="management-heading">
        <div><p className="eyebrow">Live evaluation output</p><h2 id="report-title">Security report</h2><p>Generated {new Date(report.generatedAt).toLocaleString()} from the current evidence graph.</p></div>
        <a className="button button--primary" href={`${apiUrl}/api/reports/current?format=markdown&download=1`}><Download size={16} aria-hidden="true" />Download Markdown</a>
      </div>
      <article className="report-summary"><h3>Executive summary</h3><p>{report.executiveSummary}</p><div className="risk-grid">{(["critical", "high", "medium", "low", "info"] as const).map((severity) => <div key={severity}><SeverityBadge severity={severity} /><strong>{report.risk[severity]}</strong></div>)}</div></article>
      <div className="report-columns">
        <section><div className="section-label"><h3>Prioritized findings</h3><span>{report.findings.length} total</span></div><div className="report-findings">{report.findings.length ? report.findings.map((finding) => <article key={finding.id}><SeverityBadge severity={finding.severity} /><h4>{finding.title}</h4><p>{finding.summary}</p><dl><div><dt>Asset</dt><dd><bdi>{finding.assetLabel}</bdi></dd></div><div><dt>Confidence</dt><dd>{Math.round(finding.confidence * 100)}%</dd></div></dl>{finding.remediation ? <aside><strong>Recommended action</strong><p>{finding.remediation}</p></aside> : null}</article>) : <p className="empty-copy">No findings have been recorded. Continue the evaluation before drawing a security conclusion.</p>}</div></section>
        <aside className="report-side">
          <section><div className="section-label"><h3>Vulnerability paths</h3><GitFork size={15} aria-hidden="true" /></div>{report.attackPaths.length ? report.attackPaths.map((path, index) => <ol className="attack-path" key={`${path.labels.join("-")}-${index}`}>{path.labels.map((label, itemIndex) => <li key={`${label}-${itemIndex}`}><span>{itemIndex + 1}</span><div><strong>{label}</strong>{itemIndex ? <small>{path.relationships[itemIndex - 1]}</small> : <small>Entry point</small>}</div></li>)}</ol>) : <p className="empty-copy">No evidence-backed path reaches a finding yet.</p>}</section>
          <section><div className="section-label"><h3>Artifacts</h3><Paperclip size={15} aria-hidden="true" /></div><div className="artifact-list">{report.artifacts.map((artifact) => <a key={artifact.id} href={`${apiUrl}${artifact.uri}`} target="_blank" rel="noreferrer"><FileText size={15} aria-hidden="true" /><span>{artifact.name}</span><small>{artifact.kind}</small></a>)}{!report.artifacts.length ? <p className="empty-copy">Specialists have not attached artifacts yet.</p> : null}</div></section>
          <section><div className="section-label"><h3>Limitations</h3></div><ul className="limitation-list">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
        </aside>
      </div>
    </section>
  );
}
