#!/usr/bin/env python3
"""Execute one reviewed HiveSwarm command plan and emit bounded NDJSON evidence."""

import base64
import hashlib
import json
import os
import re
import resource
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

MAX_CAPTURE_BYTES = 1_000_000
EVENT_PREFIX = "HIVESWARM_EVENT="


def emit(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


def redact(value: str) -> str:
    patterns = [
        (r"AKIA[0-9A-Z]{16}", "[REDACTED_AWS_KEY]"),
        (r"gh[pousr]_[A-Za-z0-9_]{20,}", "[REDACTED_GITHUB_TOKEN]"),
        (r"-----BEGIN [A-Z ]*PRIVATE KEY-----", "[REDACTED_PRIVATE_KEY]"),
        (r"(?i)\b(password|passwd|token|secret|api[_-]?key|authorization)\b\s*[:=]\s*[^\s,;]+", r"\1=[REDACTED]"),
    ]
    redacted = value
    for pattern, replacement in patterns:
        redacted = re.sub(pattern, replacement, redacted)
    return redacted


def load_plan() -> list[dict]:
    encoded = os.environ.get("HIVESWARM_EXECUTION_PLAN_B64", "")
    if not encoded:
        raise ValueError("No approved execution plan was supplied.")
    padded = encoded + "=" * (-len(encoded) % 4)
    value = json.loads(base64.urlsafe_b64decode(padded).decode("utf-8"))
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValueError("The approved execution plan must contain one to twelve steps.")
    for step in value:
        if not isinstance(step, dict) or not isinstance(step.get("label"), str) or not isinstance(step.get("command"), str):
            raise ValueError("Every execution step requires a label and command.")
        timeout = step.get("timeoutSeconds", 120)
        if not isinstance(timeout, int) or not 1 <= timeout <= 300:
            raise ValueError("Execution step timeouts must be between one and 300 seconds.")
    return value


def limits() -> None:
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2_000_000, 2_000_000))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))


def child_environment() -> dict[str, str]:
    allowed = {
        "PATH": os.environ.get("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "HOME": "/tmp/freeform-home",
        "HIVESWARM_TARGET": os.environ.get("HIVESWARM_TARGET", ""),
        "HIVESWARM_GOAL": os.environ.get("HIVESWARM_TASK", ""),
    }
    source_path = os.environ.get("HIVESWARM_SOURCE_PATH")
    if source_path:
        allowed["HIVESWARM_SOURCE_PATH"] = source_path
    return allowed


def emit_embedded_events(output: str) -> str:
    evidence_lines: list[str] = []
    for line in output.splitlines():
        if not line.startswith(EVENT_PREFIX):
            evidence_lines.append(line)
            continue
        try:
            event = json.loads(line[len(EVENT_PREFIX):])
            if isinstance(event, dict):
                emit(event)
        except json.JSONDecodeError:
            evidence_lines.append("[invalid structured event omitted]")
    return "\n".join(evidence_lines)


def run_step(step: dict, workspace: Path) -> dict:
    label = step["label"][:120]
    timeout = int(step.get("timeoutSeconds", 120))
    command = step["command"]
    command_digest = hashlib.sha256(command.encode("utf-8")).hexdigest()
    emit({"type": "log", "level": "info", "message": f"Starting reviewed step: {label} ({timeout}s limit)."})
    stdout_file = tempfile.NamedTemporaryFile(prefix="hiveswarm-out-", dir="/tmp", delete=False)
    stderr_file = tempfile.NamedTemporaryFile(prefix="hiveswarm-err-", dir="/tmp", delete=False)
    timed_out = False
    try:
        process = subprocess.Popen(
            ["/bin/bash", "--noprofile", "--norc", "-c", command],
            cwd=workspace,
            env=child_environment(),
            stdin=subprocess.DEVNULL,
            stdout=stdout_file,
            stderr=stderr_file,
            start_new_session=True,
            preexec_fn=limits,
        )
        try:
            return_code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            return_code = process.wait()
    finally:
        stdout_file.close()
        stderr_file.close()

    stdout_path = Path(stdout_file.name)
    stderr_path = Path(stderr_file.name)
    stdout = stdout_path.read_bytes()[:MAX_CAPTURE_BYTES].decode("utf-8", errors="replace")
    stderr = stderr_path.read_bytes()[:MAX_CAPTURE_BYTES].decode("utf-8", errors="replace")
    stdout_path.unlink(missing_ok=True)
    stderr_path.unlink(missing_ok=True)
    stdout = redact(emit_embedded_events(stdout))
    stderr = redact(stderr)
    status = "timed_out" if timed_out else "completed" if return_code == 0 else "failed"
    preview = (stdout or stderr or "No output.")[:4_000]
    emit({"type": "log", "level": "info" if return_code == 0 and not timed_out else "error", "message": f"Step {label} {status} (exit {return_code}).\n{preview}"})
    return {
        "label": label,
        "commandSha256": command_digest,
        "timeoutSeconds": timeout,
        "status": status,
        "exitCode": return_code,
        "stdout": stdout,
        "stderr": stderr,
    }


def main() -> int:
    capabilities = set(filter(None, os.environ.get("HIVESWARM_REQUESTED_CAPABILITIES", "").split(",")))
    if "shell.execute" not in capabilities:
        emit({"type": "log", "level": "error", "message": "Freeform execution was refused because shell.execute was not approved."})
        return 2
    try:
        plan = load_plan()
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
        emit({"type": "log", "level": "error", "message": str(error)})
        return 2

    workspace = Path(os.environ.get("HIVESWARM_WORKSPACE", "/workspace"))
    workspace.mkdir(parents=True, exist_ok=True)
    results = []
    for step in plan:
        result = run_step(step, workspace)
        results.append(result)
        if result["status"] != "completed":
            break

    artifact_dir = Path(os.environ.get("HIVESWARM_ARTIFACT_DIR", "/artifacts/freeform"))
    artifact_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = artifact_dir / "freeform-results.json"
    artifact_bytes = json.dumps({
        "agent": "freeform-ubuntu",
        "goal": os.environ.get("HIVESWARM_TASK", ""),
        "target": os.environ.get("HIVESWARM_TARGET", ""),
        "results": results,
    }, indent=2).encode("utf-8")
    artifact_path.write_bytes(artifact_bytes)
    artifact_path.chmod(0o600)
    emit({
        "type": "artifact",
        "artifact": {
            "kind": "scan_output",
            "name": "Freeform Ubuntu results",
            "uri": f"{os.environ.get('HIVESWARM_ARTIFACT_BASE', '')}/freeform-results.json",
            "mimeType": "application/json",
            "sha256": hashlib.sha256(artifact_bytes).hexdigest(),
        },
    })
    return 0 if len(results) == len(plan) and all(result["status"] == "completed" for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
