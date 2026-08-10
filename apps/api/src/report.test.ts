import { describe, expect, it } from "vitest";
import { generateReport, reportAsMarkdown } from "./report.js";
import { createDemoDashboard } from "./seed.js";

describe("evaluation report", () => {
  it("summarizes risk, evidence paths, coverage, and limitations", () => {
    const report = generateReport(createDemoDashboard());
    expect(report.risk.high).toBe(1);
    expect(report.attackPaths.some((path) => path.labels.includes("Stale invitation token"))).toBe(true);
    expect(report.coverage.some((item) => item.agent === "Source review")).toBe(true);
    const markdown = reportAsMarkdown(report);
    expect(markdown).toContain("# Northstar portal security evaluation");
    expect(markdown).toContain("## Vulnerability paths");
    expect(markdown).toContain("Invitation token remains valid after role change");
  });
});
