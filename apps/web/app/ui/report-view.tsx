"use client";

import {
  artifactSchema,
  findingSchema,
  type Finding,
} from "@hiveswarm/contracts";
import { z } from "zod";
import {
  ArrowUpRight,
  Download,
  FileText,
  GitFork,
  Loader2,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const reportDataSchema = z.object({
  generatedAt: z.string(),
  executiveSummary: z.string(),
  risk: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    info: z.number(),
  }),
  findings: z.array(findingSchema),
  attackPaths: z.array(
    z.object({
      labels: z.array(z.string()),
      relationships: z.array(z.string()),
    }),
  ),
  coverage: z.array(
    z.object({
      agent: z.string(),
      lifecycle: z.string(),
      status: z.string(),
      task: z.string(),
    }),
  ),
  artifacts: z.array(artifactSchema),
  limitations: z.array(z.string()),
});
export type ReportData = z.infer<typeof reportDataSchema>;

export function ReportView({
  report,
  loading,
  apiUrl,
  projectId,
  error,
  onRetry,
  onSelectFinding,
}: {
  report: ReportData | null;
  loading: boolean;
  apiUrl: string;
  projectId: string;
  error?: string;
  onRetry?: () => void;
  onSelectFinding?: (finding: Finding) => void;
}) {
  return (
    <section
      className="flex min-w-0 flex-col gap-8 text-sm leading-6 text-foreground"
      aria-labelledby="report-title"
      aria-busy={loading}
    >
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1
            id="report-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Security report
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            {report ? (
              <>
                Evidence snapshot generated{" "}
                <time dateTime={report.generatedAt}>
                  {new Date(report.generatedAt).toLocaleString()}
                </time>
                .
              </>
            ) : (
              "Review findings, specialist coverage, and the evidence behind this evaluation."
            )}
          </p>
        </div>
        {report && !loading && !error ? (
          <Button asChild className="shrink-0">
            <a
              href={`${apiUrl}/api/reports/current?format=markdown&download=1&projectId=${encodeURIComponent(projectId)}`}
            >
              <Download aria-hidden="true" className="size-4" />
              Download Markdown
            </a>
          </Button>
        ) : null}
      </header>

      {loading ? (
        <div
          className="rounded-xl border border-border bg-background py-16 text-center"
          role="status"
        >
          <Loader2
            aria-hidden="true"
            className="mx-auto size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
          <h2 className="mt-4 font-semibold">Loading the evaluation report</h2>
          <p className="mt-2 text-muted-foreground">
            Retrieving findings, coverage, and evidence-backed paths.
          </p>
        </div>
      ) : error ? (
        <div
          className="rounded-xl border border-border bg-background p-6"
          role="alert"
        >
          <h2 className="font-semibold">Report could not be loaded</h2>
          <p className="mt-2 break-words text-destructive">{error}</p>
          {onRetry ? (
            <Button variant="outline" className="mt-4" onClick={onRetry}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Retry report
            </Button>
          ) : (
            <p className="mt-2 text-muted-foreground">
              Reload this page to try again.
            </p>
          )}
        </div>
      ) : !report ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <FileText
            aria-hidden="true"
            className="mx-auto size-5 text-muted-foreground"
          />
          <h2 className="mt-4 font-semibold">No report available</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            A report has not been loaded for this project. Start an evaluation
            or refresh to check for current evidence.
          </p>
          {onRetry ? (
            <Button variant="outline" className="mt-4" onClick={onRetry}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Load report
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <section aria-labelledby="report-summary-title" className="space-y-5">
            <div className="space-y-2">
              <h2 id="report-summary-title" className="font-semibold">
                Executive summary
              </h2>
              <p className="max-w-3xl text-muted-foreground">
                {report.executiveSummary}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-5">
              {(["critical", "high", "medium", "low", "info"] as const).map(
                (severity) => (
                  <div
                    key={severity}
                    className="flex items-center justify-between gap-3 bg-background p-4 sm:flex-col sm:items-start sm:gap-2 sm:p-5"
                  >
                    <dt className="flex items-center gap-2 text-xs capitalize text-muted-foreground">
                      {severity === "critical" || severity === "high" ? (
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-destructive"
                        />
                      ) : null}
                      {severity === "info" ? "Informational" : severity}
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums tracking-tight">
                      {report.risk[severity]}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </section>

          <div className="grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section
              aria-labelledby="report-findings-title"
              className="min-w-0 space-y-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="report-findings-title" className="font-semibold">
                  Prioritized findings
                </h2>
                <span className="text-xs text-muted-foreground">
                  {report.findings.length} total
                </span>
              </div>
              {report.findings.length ? (
                <div className="divide-y divide-border rounded-xl border border-border bg-background">
                  {report.findings.map((finding) => (
                    <article
                      key={finding.id}
                      className="min-w-0 space-y-4 p-5 sm:p-6"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            finding.severity === "critical" ||
                            finding.severity === "high"
                              ? "destructive"
                              : "secondary"
                          }
                          className="capitalize"
                        >
                          {finding.severity}
                        </Badge>
                        <span className="text-xs capitalize text-muted-foreground">
                          {finding.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <div className="space-y-2">
                        <h3 className="break-words font-semibold">
                          {onSelectFinding ? (
                            <Button
                              variant="link"
                              className="h-auto max-w-full justify-start whitespace-normal p-0 text-left text-sm font-semibold"
                              onClick={() => onSelectFinding(finding)}
                            >
                              {finding.title}
                              <ArrowUpRight
                                aria-hidden="true"
                                className="size-4 shrink-0"
                              />
                            </Button>
                          ) : (
                            finding.title
                          )}
                        </h3>
                        <p className="break-words text-muted-foreground">
                          {finding.summary}
                        </p>
                      </div>
                      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-xs">
                        <div className="min-w-0">
                          <dt className="text-muted-foreground">Asset</dt>
                          <dd className="break-all font-mono">
                            <bdi>{finding.assetLabel}</bdi>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Confidence</dt>
                          <dd className="tabular-nums">
                            {Math.round(finding.confidence * 100)}%
                          </dd>
                        </div>
                      </dl>
                      {finding.remediation ? (
                        <aside className="space-y-1 border-t border-border pt-4">
                          <h4 className="text-xs font-medium">
                            Recommended action
                          </h4>
                          <p className="break-words text-muted-foreground">
                            {finding.remediation}
                          </p>
                        </aside>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-6">
                  <h3 className="font-medium">No findings recorded</h3>
                  <p className="mt-2 text-muted-foreground">
                    This does not establish the absence of vulnerabilities.
                    Review coverage and limitations before drawing a security
                    conclusion.
                  </p>
                </div>
              )}
            </section>

            <aside className="min-w-0 space-y-8">
              <section
                aria-labelledby="report-paths-title"
                className="space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 id="report-paths-title" className="font-semibold">
                    Vulnerability paths
                  </h2>
                  <GitFork
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                </div>
                {report.attackPaths.length ? (
                  <div className="space-y-5">
                    {report.attackPaths.map((path, index) => (
                      <ol
                        aria-label={`Vulnerability path ${index + 1}`}
                        className="space-y-3 rounded-xl border border-border p-4"
                        key={`${path.labels.join("-")}-${index}`}
                      >
                        {path.labels.map((label, itemIndex) => (
                          <li
                            key={`${label}-${itemIndex}`}
                            className="flex gap-3"
                          >
                            <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums text-muted-foreground">
                              {itemIndex + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="break-words font-medium">{label}</p>
                              <p className="break-words text-xs text-muted-foreground">
                                {itemIndex
                                  ? path.relationships[itemIndex - 1]
                                  : "Entry point"}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    No evidence-backed path reaches a finding yet.
                  </p>
                )}
              </section>
              <section
                aria-labelledby="report-artifacts-title"
                className="space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 id="report-artifacts-title" className="font-semibold">
                    Artifacts{" "}
                    <span className="ml-1 font-normal text-muted-foreground">
                      {report.artifacts.length}
                    </span>
                  </h2>
                  <Paperclip
                    aria-hidden="true"
                    className="size-4 text-muted-foreground"
                  />
                </div>
                {report.artifacts.length ? (
                  <ul className="divide-y divide-border">
                    {report.artifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <a
                          className="group flex items-start gap-3 rounded-md py-3 text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          href={`${apiUrl}${artifact.uri}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <FileText
                            aria-hidden="true"
                            className="mt-1 size-4 shrink-0 text-muted-foreground"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words font-medium group-hover:underline">
                              {artifact.name}
                            </span>
                            <span className="block break-words text-xs text-muted-foreground">
                              {artifact.kind}
                            </span>
                          </span>
                          <ArrowUpRight
                            aria-hidden="true"
                            className="mt-1 size-4 shrink-0 text-muted-foreground"
                          />
                          <span className="sr-only">Opens in a new tab</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Specialists have not attached artifacts yet.
                  </p>
                )}
              </section>
              <section
                aria-labelledby="report-limitations-title"
                className="space-y-3 border-t border-border pt-5"
              >
                <h2 id="report-limitations-title" className="font-semibold">
                  Limitations
                </h2>
                {report.limitations.length ? (
                  <ul className="list-disc space-y-3 pl-4 text-muted-foreground">
                    {report.limitations.map((item, index) => (
                      <li key={`${index}-${item}`} className="break-words pl-1">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    No limitations were supplied in this report. Coverage is not
                    a guarantee of security.
                  </p>
                )}
              </section>
            </aside>
          </div>

          <section
            aria-labelledby="report-coverage-title"
            className="min-w-0 space-y-4 border-t border-border pt-6"
          >
            <div className="space-y-1">
              <h2 id="report-coverage-title" className="font-semibold">
                Specialist coverage{" "}
                <span className="ml-1 font-normal text-muted-foreground">
                  {report.coverage.length} agent runs
                </span>
              </h2>
              <p className="text-muted-foreground">
                Assignments and lifecycle states at report generation. A
                completed run does not imply exhaustive testing.
              </p>
            </div>
            {report.coverage.length ? (
              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <Table className="min-w-[640px] text-sm">
                  <TableCaption className="sr-only">
                    Specialist assignments and execution status
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/5">Specialist</TableHead>
                      <TableHead>Lifecycle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-2/5">Assignment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.coverage.map((item, index) => (
                      <TableRow key={`${item.agent}-${index}`}>
                        <TableCell className="whitespace-normal break-words align-top font-medium">
                          {item.agent}
                        </TableCell>
                        <TableCell className="align-top capitalize">
                          {item.lifecycle}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge
                            variant={
                              item.status === "failed"
                                ? "destructive"
                                : "outline"
                            }
                            className="whitespace-normal capitalize"
                          >
                            {item.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-normal break-words align-top leading-6 text-muted-foreground">
                          {item.task}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border p-6 text-muted-foreground">
                No specialist executions are included in this report. There is
                no recorded execution coverage to assess.
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
