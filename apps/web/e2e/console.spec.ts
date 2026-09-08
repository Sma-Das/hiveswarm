import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createDemoDashboard } from "../../api/src/seed";
import { generateReport } from "../../api/src/report";
import explorer from "../../../agents/explorer/agent.json" with { type: "json" };
import freeform from "../../../agents/freeform-ubuntu/agent.json" with { type: "json" };

// All browser data and writes stay inside this test. No provider, scanner,
// Docker socket, or running API is involved.
async function mockWorkspace(page: Page) {
  const dashboard = createDemoDashboard();
  let activeProjectId = dashboard.engagement.id;
  let reportFails = false;
  const commands: { path: string; body: unknown }[] = [];
  await page.addInitScript(() => {
    class DemoEventSource extends EventTarget {
      onmessage = null;
      constructor(_url: string) {
        super();
        Object.defineProperty(window, "__testEvents", {
          value: this,
          configurable: true,
        });
        setTimeout(() => this.dispatchEvent(new Event("open")), 20);
      }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: DemoEventSource });
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const second = url.searchParams.get("projectId") === "eng_second";
    const current = structuredClone(dashboard);
    if (second) {
      current.engagement = {
        ...current.engagement,
        id: "eng_second",
        name: "Second project",
        target: "second.example.test",
        status: "planning",
        scopeRules: [],
      };
      current.agents = [];
      current.findings = [];
      current.approvals = [];
      current.graph = { nodes: [], edges: [] };
      current.logs = [];
      current.artifacts = [];
      current.metrics = {
        activeAgents: 0,
        assets: 0,
        findings: 0,
        pendingApprovals: 0,
      };
    }
    if (request.method() !== "GET") {
      const body: unknown = request.postData() ? request.postDataJSON() : {};
      commands.push({ path: url.pathname, body });
      if (
        url.pathname.endsWith("/state") &&
        body &&
        typeof body === "object" &&
        "status" in body
      )
        dashboard.engagement.status =
          body.status === "paused" ? "paused" : "running";
      if (
        url.pathname.endsWith("/decision") &&
        body &&
        typeof body === "object" &&
        "decision" in body
      ) {
        const approval = dashboard.approvals.find((item) =>
          url.pathname.includes(item.id),
        );
        if (approval)
          approval.status =
            body.decision === "approved" ? "approved" : "denied";
      }
      if (url.pathname.includes("eng_second/activate"))
        activeProjectId = "eng_second";
      return route.fulfill({
        json: { ok: true, spawned: [], approvalRequired: true },
      });
    }
    if (url.pathname === "/api/dashboard")
      return route.fulfill({ json: current });
    if (url.pathname === "/api/agents")
      return route.fulfill({
        json: {
          agents: [
            explorer,
            freeform,
            {
              ...explorer,
              id: "disabled-explorer",
              name: "Disabled explorer",
              enabled: false,
            },
          ],
        },
      });
    if (url.pathname === "/api/projects")
      return route.fulfill({
        json: {
          activeProjectId,
          projects: [
            {
              ...dashboard.engagement,
              metrics: dashboard.metrics,
              agentCount: dashboard.agents.length,
            },
            {
              ...dashboard.engagement,
              id: "eng_second",
              name: "Second project",
              target: "second.example.test",
              status: "planning",
              metrics: {
                activeAgents: 0,
                assets: 0,
                findings: 0,
                pendingApprovals: 0,
              },
              agentCount: 0,
            },
          ],
        },
      });
    if (url.pathname === "/api/reports/current")
      return route.fulfill(
        reportFails
          ? { status: 503, json: { error: "Report temporarily unavailable" } }
          : { json: generateReport(current) },
      );
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected test request" },
    });
  });
  return {
    dashboard,
    commands,
    failReport(value: boolean) {
      reportFails = value;
    },
  };
}

async function navigate(page: Page, label: string) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Project navigation" })
    .getByRole("link", {
      name: label,
      exact: label !== "Findings" && label !== "Approvals",
    })
    .click();
}

test("all operator views render without overflow or accessibility violations", async ({
  page,
}, testInfo) => {
  await mockWorkspace(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [view, heading] of [
    ["overview", "Overview"],
    ["assets", "Assets"],
    ["findings", "Findings"],
    ["specialists", "Specialists"],
    ["activity", "Activity"],
    ["approvals", "Approvals"],
    ["scope", "Scope policy"],
    ["report", "Security report"],
    ["registry", "Agent registry"],
  ] as const) {
    await page.goto(`/?view=${view}`);
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    if (view === "report")
      await expect(
        page.getByText("Executive summary", { exact: true }),
      ).toBeVisible();
    await expect(page.getByText("Live updates", { exact: true })).toHaveCount(
      1,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, `${view} must not overflow the viewport`).toBe(false);
    if (view === "findings" && (page.viewportSize()?.width ?? 0) >= 768) {
      const search = await page
        .getByRole("searchbox", { name: "Search findings" })
        .boundingBox();
      const severity = await page
        .getByRole("combobox", { name: "Filter by severity" })
        .boundingBox();
      const sort = await page
        .getByRole("combobox", { name: "Sort findings" })
        .boundingBox();
      expect(search && severity && sort).toBeTruthy();
      expect(Math.abs(search!.y - severity!.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(sort!.y - severity!.y)).toBeLessThanOrEqual(2);
      const alignedArrows = await page
        .locator('[data-slot="native-select-wrapper"]')
        .evaluateAll((wrappers) =>
          wrappers.every((wrapper) => {
            const select = wrapper
              .querySelector("select")!
              .getBoundingClientRect();
            const arrow = wrapper.querySelector("svg")!.getBoundingClientRect();
            return arrow.right <= select.right && arrow.left >= select.left;
          }),
        );
      expect(alignedArrows).toBe(true);
    }
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect.soft(accessibility.violations, `${view} accessibility`).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`${view}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("navigation, search, finding inspection and browser history", async ({
  page,
}) => {
  const { dashboard } = await mockWorkspace(page);
  await page.goto("/");
  await navigate(page, "Findings");
  await expect(page).toHaveURL(/view=findings/);
  await page
    .getByRole("searchbox", { name: "Search findings" })
    .fill(dashboard.findings[0]!.title);
  await page
    .getByRole("button", { name: dashboard.findings[0]!.title, exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByRole("heading", { name: dashboard.findings[0]!.title }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: dashboard.findings[0]!.title,
      exact: true,
    }),
  ).toBeFocused();
  await navigate(page, "Assets");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();
});

test("run controls and one-time decisions remain available", async ({
  page,
}) => {
  const { dashboard, commands } = await mockWorkspace(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Pause run", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume run", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run orchestrator", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Resume run", exact: true }).click();
  await navigate(page, "Approvals");
  await expect(
    page.getByText(dashboard.approvals[0]!.requestedAction, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/can remove a matching exact deny rule/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Deny request", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No approvals waiting" }),
  ).toBeVisible();
  expect(commands).toContainEqual({
    path: `/api/approvals/${dashboard.approvals[0]!.id}/decision`,
    body: { decision: "denied" },
  });
  await page.getByRole("radio", { name: "History" }).click();
  await expect(page.getByText("Denied", { exact: true })).toBeVisible();
});

test("asset and specialist inspection are available at every viewport", async ({
  page,
}) => {
  const { dashboard } = await mockWorkspace(page);
  await page.goto("/?view=assets");
  await page
    .getByRole("button", { name: dashboard.graph.nodes[0]!.label, exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Recorded metadata" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await navigate(page, "Specialists");
  await page.getByRole("button", { name: "Explorer", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Waiting for approval", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Terminate specialist" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("radio", { name: "Graph", exact: true }).click();
  await expect(
    page.getByRole("region", {
      name: "Orchestrator, recursive subagents, statuses, and raised findings",
    }),
  ).toBeVisible();
});

test("project switches clear inspection and pending decisions", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: /Switch project, current project/ })
    .click();
  await page.getByRole("button", { name: /Second project/ }).click();
  await expect(
    page.getByText("second.example.test", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your asset map starts here" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Approvals");
  await expect(
    page.getByRole("heading", { name: "No approvals waiting" }),
  ).toBeVisible();
});

test("report failures offer a working retry instead of endless loading", async ({
  page,
}) => {
  const fixture = await mockWorkspace(page);
  fixture.failReport(true);
  await page.goto("/?view=report");
  await expect(
    page.getByRole("heading", { name: "Report could not be loaded" }),
  ).toBeVisible();
  fixture.failReport(false);
  await page.getByRole("button", { name: "Retry report" }).click();
  await expect(
    page.getByText("Executive summary", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Markdown" }),
  ).toHaveAttribute("href", /projectId=eng_demo/);
});

test("specialist form exposes requested capabilities and excludes disabled packages", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start specialist", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("option", { name: "Disabled explorer" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText("network.passive", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("scope graph stays inside its frame and supports keyboard inspection", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/?view=scope");
  await page.getByRole("button", { name: "Show scope graph" }).click();
  const frame = page.getByRole("region", { name: "Scope graph", exact: true });
  const graph = frame.locator(".graph");
  await expect(graph).toBeVisible();
  const frameBox = await frame.boundingBox();
  const graphBox = await graph.boundingBox();
  expect(Math.abs(frameBox!.height - graphBox!.height)).toBeLessThanOrEqual(2);
  expect(Math.abs(frameBox!.width - graphBox!.width)).toBeLessThanOrEqual(2);
  await graph.locator(".react-flow__node").first().focus();
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Recorded metadata" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(graph.locator(".react-flow__node").first()).toBeFocused();
});

test("project creation previews the actual host boundary", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (await page.getByRole("button", { name: "Open navigation" }).isVisible())
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Primary target" })
    .fill("https://api.example.test:8443/private/");
  await expect(dialog.getByText("Allow host", { exact: true })).toBeVisible();
  await expect(dialog.locator("code")).toHaveText("api.example.test");
  await expect(
    dialog.getByText(/URL paths, ports, and schemes do not narrow/),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("disconnected updates are visible without discarding evidence", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    Reflect.get(window, "__testEvents").dispatchEvent(new Event("error")),
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Displayed evidence may be out of date",
  );
  await expect(
    page.getByRole("heading", { name: "Attack surface", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    Reflect.get(window, "__testEvents").dispatchEvent(new Event("open")),
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
