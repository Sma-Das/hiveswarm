import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const agentId = process.env.HIVESWARM_AGENT_ID ?? "unknown";
const agentRunId = process.env.HIVESWARM_AGENT_RUN_ID ?? "local";
const task = process.env.HIVESWARM_TASK ?? "Perform the assigned bounded evaluation task.";
const target = process.env.HIVESWARM_TARGET ?? "";
const lifecycle = process.env.HIVESWARM_LIFECYCLE ?? "task";
const artifactDir = process.env.HIVESWARM_ARTIFACT_DIR ?? `/artifacts/${agentRunId}`;
const artifactBase = process.env.HIVESWARM_ARTIFACT_BASE ?? `/api/artifacts/${agentRunId}`;

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const log = (message, level = "info") => emit({ type: "log", level, message });
const node = (kind, label, subtitle, metadata = {}) => {
  const ref = `${kind}:${label}`.slice(0, 200);
  emit({ type: "node", ref, node: { kind, label, ...(subtitle ? { subtitle } : {}), status: "observed", metadata, discoveredBy: agentId } });
  return ref;
};
const edge = (source, targetRef, relationship) => emit({ type: "edge", edge: { source, target: targetRef, relationship, metadata: {} } });

function asUrl(value) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

async function run(command, args, timeoutMs = 180_000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const limit = 4 * 1024 * 1024;
    child.stdout.on("data", (chunk) => { if (stdout.length < limit) stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { if (stderr.length < limit) stderr += chunk.toString("utf8"); });
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function browserExplore(proposeScope) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: process.env.HIVESWARM_IGNORE_TLS_ERRORS === "true" });
    const response = await page.goto(asUrl(target), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const title = await page.title();
    const current = new URL(page.url());
    const websiteRef = node("website", current.host, title || `HTTP ${response?.status() ?? "unknown"}`, { url: page.url(), statusCode: response?.status() });
    const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => anchor.href));
    const unique = [...new Set(links)].slice(0, 100);
    let observed = 0;
    const proposed = new Set();
    for (const href of unique) {
      try {
        const link = new URL(href);
        if (link.origin === current.origin && observed < 30) {
          const endpointRef = node("endpoint", `${link.pathname}${link.search}`, "Discovered in rendered navigation", { url: link.href });
          edge(websiteRef, endpointRef, "serves");
          observed += 1;
        } else if (proposeScope && link.hostname !== current.hostname && !proposed.has(link.hostname)) {
          proposed.add(link.hostname);
          emit({ type: "scope_proposal", kind: "host", value: link.hostname, rationale: `The rendered application links to ${link.hostname}; human confirmation is required before exploration.` });
        }
      } catch {}
    }
    await mkdir(artifactDir, { recursive: true });
    const filename = proposeScope ? "explorer-overview.png" : "browser-overview.png";
    await page.screenshot({ path: join(artifactDir, filename), fullPage: true });
    emit({ type: "artifact", artifact: { kind: "screenshot", name: title || filename, uri: `${artifactBase}/${filename}`, mimeType: "image/png" } });
    log(`Rendered ${page.url()} and recorded ${observed} same-origin routes.`);
  } finally {
    await browser.close();
  }
}

async function portScan() {
  const host = new URL(asUrl(target)).hostname;
  log(`Starting bounded Nmap service discovery for ${host}.`);
  const ports = process.env.HIVESWARM_PORTS ?? "1-1024";
  const result = await run("nmap", ["-sT", "-sV", "--version-light", "-T3", "--max-rate", process.env.HIVESWARM_MAX_RATE ?? "100", "-p", ports, "-oX", "-", host]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `nmap exited with ${result.code}`);
  const hostRef = node("host", host, "Nmap target", { scanner: "nmap" });
  const portPattern = /<port protocol="([^"]+)" portid="(\d+)">[\s\S]*?<state state="open"[^>]*\/>[\s\S]*?(?:<service name="([^"]*)"[^>]*\/>|<\/port>)/g;
  for (const match of result.stdout.matchAll(portPattern)) {
    const serviceRef = node("service", `${match[3] || "unknown"} ${match[1]}/${match[2]}`, `${host}:${match[2]}`, { host, port: Number(match[2]), protocol: match[1], service: match[3] || "unknown" });
    edge(hostRef, serviceRef, "exposes");
  }
  log("Nmap service discovery completed.");
}

async function directoryScan() {
  const base = asUrl(target).replace(/\/$/, "");
  const websiteRef = node("website", new URL(base).host, "Directory enumeration target", { url: base });
  const wordlist = process.env.HIVESWARM_WORDLIST ?? "/agent/wordlists/common.txt";
  const result = await run("gobuster", ["dir", "--url", base, "--wordlist", wordlist, "--threads", process.env.HIVESWARM_THREADS ?? "10", "--delay", process.env.HIVESWARM_DELAY ?? "100ms", "--no-error", "--quiet", "--status-codes-blacklist", "404"]);
  if (result.code !== 0 && !result.stdout.trim()) throw new Error(result.stderr.trim() || `gobuster exited with ${result.code}`);
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\/\S+)\s+\(Status:\s*(\d+)\)/);
    if (match) {
      const directoryRef = node("directory", match[1], `HTTP ${match[2]}`, { url: `${base}${match[1]}`, statusCode: Number(match[2]), scanner: "gobuster" });
      edge(websiteRef, directoryRef, "serves");
    }
  }
  log("Bounded directory enumeration completed.");
}

async function domainScan() {
  const domain = new URL(asUrl(target)).hostname;
  const domainRef = node("host", domain, "DNS enumeration target", { scanner: "gobuster" });
  const wordlist = process.env.HIVESWARM_WORDLIST ?? "/agent/wordlists/subdomains.txt";
  const result = await run("gobuster", ["dns", "--domain", domain, "--wordlist", wordlist, "--threads", process.env.HIVESWARM_THREADS ?? "10", "--delay", process.env.HIVESWARM_DELAY ?? "100ms", "--no-error", "--quiet"]);
  if (result.code !== 0 && !result.stdout.trim()) throw new Error(result.stderr.trim() || `gobuster exited with ${result.code}`);
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/Found:\s+(\S+)/i);
    if (match) {
      const subdomainRef = node("subdomain", match[1], "Resolved by bounded DNS enumeration", { scanner: "gobuster" });
      edge(domainRef, subdomainRef, "resolves_to");
    }
  }
  log("Bounded subdomain enumeration completed.");
}

const reviewExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".go", ".rb", ".java", ".cs", ".php"]);
async function sourceFiles(root, current = root, found = []) {
  if (found.length >= 500) return found;
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if ([".git", "node_modules", "vendor", "dist", "build"].includes(entry.name)) continue;
    const location = join(current, entry.name);
    if (entry.isDirectory()) await sourceFiles(root, location, found);
    else if (reviewExtensions.has(extname(entry.name)) && found.length < 500) found.push(location);
  }
  return found;
}

async function sourceReview() {
  const root = resolve(process.env.HIVESWARM_SOURCE_PATH ?? "/target");
  const files = await sourceFiles(root);
  node("repository", target.replace(/^repository:/, ""), `${files.length} reviewable source files`, { path: root });
  const candidates = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (/\b(role|permission|authori[sz]|tenant|workspace|invite|ownership)\b/i.test(content)) candidates.push(relative(root, file));
  }
  log(`Business-logic triage identified ${candidates.length} authorization-sensitive files: ${candidates.slice(0, 20).join(", ") || "none"}.`);
  emit({ type: "spawn_request", request: { agentId: "semgrep", lifecycle: "task", task: "Run the bundled bounded SAST rules and report evidence-backed matches.", target, requestedCapabilities: ["source.read", "source.scan", "finding.write"] } });
  emit({ type: "spawn_request", request: { agentId: "trufflehog", lifecycle: "task", task: "Scan repository history and working files for verified or high-confidence secrets.", target, requestedCapabilities: ["source.read", "secrets.scan", "finding.write"] } });
}

async function reporter() {
  await mkdir(artifactDir, { recursive: true });
  const filename = "reporter-note.md";
  await writeFile(join(artifactDir, filename), `# HiveSwarm reporter session\n\nAgent run: ${agentRunId}\n\nAssigned objective: ${task}\n`, "utf8");
  emit({ type: "artifact", artifact: { kind: "report", name: "Reporter session note", uri: `${artifactBase}/${filename}`, mimeType: "text/markdown" } });
  log("Reporter is ready to normalize findings and graph evidence. The API report endpoint remains the authoritative live assessment.");
}

async function main() {
  log(`Starting ${agentId}: ${task}`);
  if (!target && !["reporter"].includes(agentId)) throw new Error("HIVESWARM_TARGET is required.");
  if (agentId === "browser-user") await browserExplore(false);
  else if (agentId === "explorer") await browserExplore(true);
  else if (agentId === "port-scanner") await portScan();
  else if (agentId === "directory-enumerator") await directoryScan();
  else if (agentId === "subdomain-enumerator") await domainScan();
  else if (agentId === "source-review") await sourceReview();
  else if (agentId === "reporter") await reporter();
  else log(`No runtime handler is registered for ${agentId}.`, "warn");
  if (lifecycle === "session") {
    log("Initial task complete; session remains available until the orchestrator terminates it.");
    await new Promise((resolveSession) => {
      process.once("SIGTERM", resolveSession);
      process.once("SIGINT", resolveSession);
    });
  }
}

main().catch((error) => {
  log(error instanceof Error ? error.message : "Specialist execution failed.", "error");
  process.exitCode = 1;
});
