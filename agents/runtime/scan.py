#!/usr/bin/env python3
import json
import os
import subprocess
import sys

AGENT_ID = os.getenv("HIVESWARM_AGENT_ID", "scanner")
TARGET = os.getenv("HIVESWARM_TARGET", "repository:unknown")
SOURCE = os.getenv("HIVESWARM_SOURCE_PATH", "/target")


def emit(event):
    print(json.dumps(event, separators=(",", ":")), flush=True)


def log(message, level="info"):
    emit({"type": "log", "level": level, "message": message[:8000]})


def finding(title, severity, confidence, summary, evidence, remediation):
    emit({
        "type": "finding",
        "finding": {
            "title": title,
            "severity": severity,
            "status": "open",
            "confidence": confidence,
            "assetLabel": TARGET.replace("repository:", ""),
            "summary": summary,
            "evidence": evidence,
            "remediation": remediation,
            "discoveredBy": AGENT_ID,
        },
    })


def semgrep():
    command = ["semgrep", "scan", "--json", "--metrics=off", "--config", "/agent/semgrep-rules.yml", SOURCE]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
    if not result.stdout.strip():
        raise RuntimeError(result.stderr.strip() or f"Semgrep exited with {result.returncode}")
    payload = json.loads(result.stdout)
    matches = payload.get("results", [])
    for match in matches[:100]:
        extra = match.get("extra", {})
        metadata = extra.get("metadata", {})
        raw_severity = str(extra.get("severity", "WARNING")).upper()
        severity = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}.get(raw_severity, "medium")
        path = match.get("path", "unknown")
        line = match.get("start", {}).get("line", 0)
        finding(
            metadata.get("shortlink") or match.get("check_id", "Static analysis match"),
            severity,
            0.78,
            extra.get("message", "A bundled HiveSwarm static-analysis rule matched this code path."),
            [f"{path}:{line}", f"Rule: {match.get('check_id', 'unknown') }"],
            metadata.get("fix") or "Review the matched data and authorization flow, then add a regression test for the corrected boundary.",
        )
    log(f"Semgrep completed with {len(matches)} evidence-backed matches.")


def trufflehog():
    command = ["trufflehog", "filesystem", SOURCE, "--json", "--no-update"]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300, check=False)
    matches = []
    for line in result.stdout.splitlines():
        try:
            matches.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    for match in matches[:100]:
        verified = bool(match.get("Verified"))
        detector = match.get("DetectorName", "Potential secret")
        source = match.get("SourceMetadata", {}).get("Data", {}).get("Filesystem", {}).get("file", "unknown")
        finding(
            f"{'Verified' if verified else 'Potential'} {detector} secret",
            "critical" if verified else "medium",
            0.98 if verified else 0.65,
            "TruffleHog detected credential-like material in the authorized repository.",
            [f"Source: {source}", f"Detector: {detector}", f"Verified: {verified}"],
            "Revoke exposed credentials, remove them from reachable history, and replace plaintext material with a managed secret reference.",
        )
    log(f"TruffleHog completed with {len(matches)} candidate results; secret values were not included in HiveSwarm events.")


try:
    log(f"Starting {AGENT_ID} against the mounted authorized repository.")
    if AGENT_ID == "semgrep":
        semgrep()
    elif AGENT_ID == "trufflehog":
        trufflehog()
    else:
        raise RuntimeError(f"Unsupported scanner adapter: {AGENT_ID}")
except Exception as error:
    log(str(error), "error")
    sys.exit(1)
