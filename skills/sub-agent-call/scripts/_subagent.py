#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import urllib.parse
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

THINKING_LEVELS = ("off", "minimal", "low", "medium", "high", "xhigh")
MODES = ("text", "json", "rpc")
READONLY_TOOLS = "read,grep,find,ls"
PROG = "scripts/subagent"
ROOT = Path(__file__).resolve().parent.parent
PROMPTS_DIR = ROOT / "prompts"


@dataclass(frozen=True)
class ThreadPaths:
    thread_id: str
    session_file: Path
    summary_file: Path
    thread_dir: Path


@dataclass(frozen=True)
class CallResult:
    code: int
    output: str
    thread_id: str
    generated_thread_id: bool


class CliError(Exception):
    def __init__(self, message: str, code: int = 2):
        super().__init__(message)
        self.message = message
        self.code = code


def prompt_path(name: str) -> str:
    return str(PROMPTS_DIR / name)


def agent_dir() -> Path:
    return Path(os.environ.get("PI_CODING_AGENT_DIR", str(Path.home() / ".pi" / "agent"))).expanduser().resolve()


def fail(message: str, code: int = 2) -> None:
    raise CliError(message, code)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def find_project_settings(start: Path) -> Path | None:
    current = start.resolve()
    while True:
        candidate = current / ".pi" / "settings.json"
        if candidate.is_file():
            return candidate
        if current.parent == current:
            return None
        current = current.parent


def resolve_session_dir(cwd: Path) -> Path:
    project_settings = find_project_settings(cwd)
    if project_settings:
        data = load_json(project_settings)
        if isinstance(data, dict) and isinstance(data.get("sessionDir"), str) and data["sessionDir"].strip():
            session_dir = Path(data["sessionDir"].strip())
            if not session_dir.is_absolute():
                session_dir = (project_settings.parent / session_dir).resolve()
            return session_dir

    global_settings = agent_dir() / "settings.json"
    data = load_json(global_settings)
    if isinstance(data, dict) and isinstance(data.get("sessionDir"), str) and data["sessionDir"].strip():
        session_dir = Path(data["sessionDir"].strip())
        if not session_dir.is_absolute():
            session_dir = (agent_dir() / session_dir).resolve()
        return session_dir

    return agent_dir() / "sessions"


def encode_cwd(path: Path) -> str:
    return f"--{str(path.resolve()).lstrip('/').replace('/', '-')}--"


def encode_thread_id(thread_id: str) -> str:
    return urllib.parse.quote(thread_id, safe="")


def decode_thread_id(value: str) -> str:
    return urllib.parse.unquote(value)


def thread_paths(thread_id: str, cwd: Path) -> ThreadPaths:
    thread_dir = agent_dir() / "sub-agent-threads" / encode_cwd(cwd)
    encoded = encode_thread_id(thread_id)
    return ThreadPaths(
        thread_id=thread_id,
        session_file=thread_dir / f"{encoded}.jsonl",
        summary_file=thread_dir / f"{encoded}.summary.md",
        thread_dir=thread_dir,
    )


def iter_entries(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except Exception:
                continue
            if isinstance(entry, dict) and entry.get("type") != "session":
                entries.append(entry)
    return entries


def session_branch(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not entries:
        return []
    by_id = {entry["id"]: entry for entry in entries if isinstance(entry.get("id"), str)}
    leaf = next((entry for entry in reversed(entries) if isinstance(entry.get("id"), str)), None)
    if leaf is None:
        return []

    branch: list[dict[str, Any]] = []
    current: dict[str, Any] | None = leaf
    while current is not None:
        branch.append(current)
        parent_id = current.get("parentId")
        current = by_id.get(parent_id) if isinstance(parent_id, str) else None
    branch.reverse()
    return branch


def parse_session_model(path: Path) -> tuple[str | None, str | None, str | None]:
    branch = session_branch(iter_entries(path))
    if not branch:
        return None, None, None

    provider = None
    model = None
    thinking_level = None
    for entry in branch:
        entry_type = entry.get("type")
        if entry_type == "model_change":
            if isinstance(entry.get("provider"), str) and entry["provider"].strip():
                provider = entry["provider"]
            if isinstance(entry.get("modelId"), str) and entry["modelId"].strip():
                model = entry["modelId"]
        elif entry_type == "thinking_level_change":
            if isinstance(entry.get("thinkingLevel"), str) and entry["thinkingLevel"].strip():
                thinking_level = entry["thinkingLevel"]
        elif entry_type == "message":
            message = entry.get("message")
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            if isinstance(message.get("provider"), str) and message["provider"].strip():
                provider = message["provider"]
            if isinstance(message.get("model"), str) and message["model"].strip():
                model = message["model"]

    return provider, model, thinking_level


def resolve_current_session_target(cwd: Path) -> tuple[str, str]:
    session_folder = resolve_session_dir(cwd) / encode_cwd(cwd)
    if not session_folder.is_dir():
        fail("Unable to infer the current session provider/model. Pass --provider and --model explicitly.")

    session_files = [path for path in session_folder.iterdir() if path.suffix == ".jsonl" and path.is_file()]
    if not session_files:
        fail("Unable to infer the current session provider/model. Pass --provider and --model explicitly.")

    latest = max(session_files, key=lambda path: path.stat().st_mtime)
    provider, model, _thinking = parse_session_model(latest)
    if not provider or not model:
        fail("Unable to infer the current session provider/model. Pass --provider and --model explicitly.")
    return provider, model


def resolve_thread_target(paths: ThreadPaths, cwd: Path, provider: str | None, model: str | None) -> tuple[str, str, bool]:
    exists = paths.session_file.is_file()
    if provider and model:
        return provider, model, exists
    if provider or model:
        fail("--provider and --model must be provided together.")

    if exists:
        resolved_provider, resolved_model, _thinking = parse_session_model(paths.session_file)
        if not resolved_provider or not resolved_model:
            fail("Unable to infer the existing thread provider/model. Pass --provider and --model explicitly.")
        return resolved_provider, resolved_model, True

    resolved_provider, resolved_model = resolve_current_session_target(cwd)
    return resolved_provider, resolved_model, False


def generate_thread_id() -> str:
    return str(uuid.uuid4())


def strip_terminal_noise(text: str) -> str:
    text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"^Warning: No models match pattern .*$\n?", "", text, flags=re.MULTILINE)
    return text.lstrip()


def read_prompt(parts: Sequence[str]) -> str:
    if parts:
        prompt = " ".join(parts)
    elif not sys.stdin.isatty():
        prompt = sys.stdin.read()
    else:
        fail("prompt is required")
    if not prompt.strip():
        fail("prompt is required")
    return prompt


def run_pi(
    *,
    session_file: Path,
    provider: str,
    model: str,
    prompt: str,
    mode: str,
    thinking: str | None,
    tools: str | None,
    files: Sequence[Path],
    append_prompts: Sequence[str],
) -> tuple[int, str]:
    if not shutil_which("pi"):
        fail("pi is not on PATH", 127)

    cmd = [
        "pi",
        "--session",
        str(session_file),
        "--provider",
        provider,
        "--model",
        model,
        "--models",
        model,
        "--mode",
        mode,
        "-p",
    ]

    if thinking:
        cmd += ["--thinking", thinking]
    if tools:
        cmd += ["--tools", tools]
    else:
        cmd.append("--no-tools")
    for prompt_path_value in append_prompts:
        cmd += ["--append-system-prompt", prompt_path_value]
    for file_path in files:
        if not file_path.exists():
            fail(f"attached file not found: {file_path}")
        cmd.append(f"@{file_path}")
    cmd.append(prompt)

    session_file.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return proc.returncode, strip_terminal_noise(proc.stdout)


def run_thread_call(
    *,
    cwd: Path,
    prompt: str,
    thread_id: str | None,
    provider: str | None,
    model: str | None,
    thinking: str | None,
    tools: str | None,
    files: Sequence[Path],
    mode: str,
    append_prompts: Sequence[str],
) -> CallResult:
    generated_thread_id = False
    resolved_thread_id = thread_id or generate_thread_id()
    if not thread_id:
        generated_thread_id = True

    paths = thread_paths(resolved_thread_id, cwd)
    resolved_provider, resolved_model, _exists = resolve_thread_target(paths, cwd, provider, model)
    code, output = run_pi(
        session_file=paths.session_file,
        provider=resolved_provider,
        model=resolved_model,
        prompt=prompt,
        mode=mode,
        thinking=thinking,
        tools=tools,
        files=files,
        append_prompts=append_prompts,
    )
    return CallResult(code=code, output=output, thread_id=resolved_thread_id, generated_thread_id=generated_thread_id)


def emit_thread_hint(thread_id: str) -> None:
    sys.stderr.write(f"\nthread_id={thread_id}\n")
    sys.stderr.write(f"thread_hint=Reuse this id with --thread-id {thread_id} to continue the same sub-agent thread.\n")


def print_output(text: str) -> None:
    sys.stdout.write(text)


def build_run_parser(*, prog: str, description: str, require_provider_model: bool = False, readonly: bool = False) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=prog, description=description)
    parser.add_argument("--thread-id", help="Reuse an existing sub-agent thread id")
    parser.add_argument("--provider", required=require_provider_model, help="Override the provider")
    parser.add_argument("--model", required=require_provider_model, help="Override the model")
    parser.add_argument("--thinking", choices=THINKING_LEVELS, help="Set nested thinking level")
    if not readonly:
        parser.add_argument("--tools", help="Enable tools only when inspection is explicitly needed")
    parser.add_argument("--file", action="append", default=[], help="Attach a small context file")
    parser.add_argument("--mode", choices=MODES, default="text", help="Nested pi output mode")
    parser.add_argument("--no-thread-hint", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("prompt", nargs="*", help="Prompt text. Reads stdin when omitted.")
    return parser


def validate_provider_pair(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if bool(args.provider) ^ bool(args.model):
        parser.error("--provider and --model must be provided together.")


def handle_run(argv: Sequence[str]) -> int:
    parser = build_run_parser(
        prog=PROG,
        description="Run a nested pi sub-agent in a persistent thread.",
    )
    args = parser.parse_args(list(argv))
    validate_provider_pair(parser, args)
    prompt = read_prompt(args.prompt)
    result = run_thread_call(
        cwd=Path.cwd(),
        prompt=prompt,
        thread_id=args.thread_id,
        provider=args.provider,
        model=args.model,
        thinking=args.thinking,
        tools=args.tools,
        files=[Path(path) for path in args.file],
        mode=args.mode,
        append_prompts=[prompt_path("base.md")],
    )
    print_output(result.output)
    if result.generated_thread_id and not args.no_thread_hint:
        emit_thread_hint(result.thread_id)
    return result.code


def handle_compare(argv: Sequence[str]) -> int:
    parser = build_run_parser(
        prog=f"{PROG} compare",
        description="Run an explicit provider/model comparison in a persistent thread.",
        require_provider_model=True,
    )
    parser.add_argument("--package-file", help="Attach a curated comparison package")
    args = parser.parse_args(list(argv))
    prompt = read_prompt(args.prompt)
    files = [Path(path) for path in args.file]
    if args.package_file:
        files.append(Path(args.package_file))
    wrapped_prompt = textwrap.dedent(
        f"""\
        Compare from the prompt and any attached curated context package only.
        Do not rediscover context unless tools were explicitly enabled.
        Follow the requested output format exactly.
        User request:
        {prompt}
        """
    )
    result = run_thread_call(
        cwd=Path.cwd(),
        prompt=wrapped_prompt,
        thread_id=args.thread_id,
        provider=args.provider,
        model=args.model,
        thinking=args.thinking,
        tools=args.tools,
        files=files,
        mode=args.mode,
        append_prompts=[prompt_path("base.md"), prompt_path("compare.md")],
    )
    print_output(result.output)
    if result.generated_thread_id and not args.no_thread_hint:
        emit_thread_hint(result.thread_id)
    return result.code


def handle_readonly(argv: Sequence[str]) -> int:
    parser = build_run_parser(
        prog=f"{PROG} readonly",
        description="Run a read-only repository inspection in a persistent thread.",
        readonly=True,
    )
    args = parser.parse_args(list(argv))
    validate_provider_pair(parser, args)
    prompt = read_prompt(args.prompt)
    result = run_thread_call(
        cwd=Path.cwd(),
        prompt=prompt,
        thread_id=args.thread_id,
        provider=args.provider,
        model=args.model,
        thinking=args.thinking,
        tools=READONLY_TOOLS,
        files=[Path(path) for path in args.file],
        mode=args.mode,
        append_prompts=[prompt_path("base.md"), prompt_path("readonly.md")],
    )
    print_output(result.output)
    if result.generated_thread_id and not args.no_thread_hint:
        emit_thread_hint(result.thread_id)
    return result.code


def list_threads(cwd: Path) -> int:
    thread_dir = thread_paths("dummy", cwd).thread_dir
    if not thread_dir.is_dir():
        print("thread_count=0")
        return 0

    thread_files = sorted(
        [path for path in thread_dir.iterdir() if path.suffix == ".jsonl" and path.is_file()],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    print(f"thread_count={len(thread_files)}")
    for path in thread_files:
        provider, model, _thinking = parse_session_model(path)
        updated_at = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).astimezone().isoformat()
        print(f"thread_id={decode_thread_id(path.stem)}")
        if provider:
            print(f"provider={provider}")
        if model:
            print(f"model={model}")
        print(f"updated_at={updated_at}")
        print()
    return 0


def checkpoint_prompt() -> str:
    return (
        "Create a continuation checkpoint for this thread. Return markdown with exactly these sections: "
        "# Thread checkpoint, ## Goal, ## Key decisions, ## Current state, ## Open questions, ## Next step. "
        "Constraints: maximum 12 bullets total, keep concrete identifiers and file paths, omit filler."
    )


def run_checkpoint(thread_id: str, output_path: str | None) -> int:
    summary = capture_checkpoint(thread_id)
    if output_path:
        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)
        output_file.write_text(summary.rstrip("\n") + "\n", encoding="utf-8")
    print_output(summary)
    return 0


def rotate_thread(old_thread_id: str, new_thread_id: str | None) -> int:
    cwd = Path.cwd()
    old_paths = thread_paths(old_thread_id, cwd)
    if not old_paths.session_file.is_file():
        fail(f"old thread does not exist: {old_thread_id}")

    provider, model, _thinking = parse_session_model(old_paths.session_file)
    if not provider or not model:
        fail("Unable to infer the existing thread provider/model. Pass --provider and --model explicitly.")

    summary = capture_checkpoint(old_thread_id)
    target_thread_id = new_thread_id or generate_thread_id()
    new_paths = thread_paths(target_thread_id, cwd)
    if new_paths.session_file.exists():
        fail(f"new thread already exists: {target_thread_id}")

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as tmp:
        tmp.write(summary.rstrip("\n") + "\n")
        tmp_path = Path(tmp.name)

    try:
        result = run_thread_call(
            cwd=cwd,
            prompt="The attached file is the continuation checkpoint for this new thread. Internalize it and reply only ACK.",
            thread_id=target_thread_id,
            provider=provider,
            model=model,
            thinking=None,
            tools=None,
            files=[tmp_path],
            mode="text",
            append_prompts=[prompt_path("base.md")],
        )
        if result.code != 0:
            print_output(result.output)
            return result.code
    finally:
        tmp_path.unlink(missing_ok=True)

    new_paths.summary_file.parent.mkdir(parents=True, exist_ok=True)
    new_paths.summary_file.write_text(summary.rstrip("\n") + "\n", encoding="utf-8")
    print(f"status=rotated")
    print(f"old_thread_id={old_thread_id}")
    print(f"new_thread_id={target_thread_id}")
    print(f"provider={provider}")
    print(f"model={model}")
    return 0


def capture_checkpoint(thread_id: str) -> str:
    cwd = Path.cwd()
    paths = thread_paths(thread_id, cwd)
    if not paths.session_file.is_file():
        fail(f"thread does not exist: {thread_id}")
    result = run_thread_call(
        cwd=cwd,
        prompt=checkpoint_prompt(),
        thread_id=thread_id,
        provider=None,
        model=None,
        thinking="low",
        tools=None,
        files=[],
        mode="text",
        append_prompts=[prompt_path("base.md"), prompt_path("checkpoint.md")],
    )
    if result.code != 0:
        fail(result.output or "checkpoint failed", result.code)
    paths.summary_file.parent.mkdir(parents=True, exist_ok=True)
    paths.summary_file.write_text(result.output.rstrip("\n") + "\n", encoding="utf-8")
    return result.output


def delete_thread(thread_id: str) -> int:
    paths = thread_paths(thread_id, Path.cwd())
    existed = paths.session_file.exists() or paths.summary_file.exists()
    paths.session_file.unlink(missing_ok=True)
    paths.summary_file.unlink(missing_ok=True)
    print(f"status={'deleted' if existed else 'not_found'}")
    print(f"thread_id={thread_id}")
    return 0


def build_threads_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=f"{PROG} threads", description="Inspect or manage sub-agent threads.")
    subparsers = parser.add_subparsers(dest="action", required=True)

    subparsers.add_parser("list", help="List thread ids for the current cwd")

    checkpoint = subparsers.add_parser("checkpoint", help="Create a compact continuation checkpoint")
    checkpoint.add_argument("thread_id")
    checkpoint.add_argument("--output", help="Also write the checkpoint to a file")

    rotate = subparsers.add_parser("rotate", help="Seed a fresh thread from a checkpoint")
    rotate.add_argument("old_thread_id")
    rotate.add_argument("new_thread_id", nargs="?")

    delete = subparsers.add_parser("delete", help="Delete a thread and its sidecar summary")
    delete.add_argument("thread_id")

    return parser


def handle_threads(argv: Sequence[str]) -> int:
    parser = build_threads_parser()
    args = parser.parse_args(list(argv))
    if args.action == "list":
        return list_threads(Path.cwd())
    if args.action == "checkpoint":
        return run_checkpoint(args.thread_id, args.output)
    if args.action == "rotate":
        return rotate_thread(args.old_thread_id, args.new_thread_id)
    if args.action == "delete":
        return delete_thread(args.thread_id)
    parser.error("unknown threads action")
    return 2


def print_main_help() -> int:
    print(
        textwrap.dedent(
            f"""\
            Usage:
              {PROG} [options] [prompt]
              {PROG} compare [options] [prompt]
              {PROG} readonly [options] [prompt]
              {PROG} threads <list|checkpoint|rotate|delete> ...

            Common patterns:
              {PROG} \"<prompt>\"
              {PROG} --thread-id <thread-id> \"<prompt>\"
              {PROG} compare --provider <provider> --model <model> \"<prompt>\"
              {PROG} readonly \"<prompt>\"
              {PROG} threads list

            Notes:
              - Every call is thread-based.
              - If --thread-id is omitted, a UUID is generated and printed on stderr.
              - Default provider/model comes from the current pi session for a new thread.
              - Existing threads reuse their stored provider/model unless explicitly overridden.
              - Prompt text can be passed through stdin when omitted.
            """
        ).rstrip()
    )
    return 0


def shutil_which(name: str) -> str | None:
    for base in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(base) / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def main(argv: Sequence[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        if not args:
            return print_main_help() if sys.stdin.isatty() else handle_run([])
        if args[0] in {"-h", "--help"}:
            return print_main_help()
        if args[0] == "compare":
            return handle_compare(args[1:])
        if args[0] == "readonly":
            return handle_readonly(args[1:])
        if args[0] == "threads":
            return handle_threads(args[1:])
        return handle_run(args)
    except CliError as exc:
        print(exc.message, file=sys.stderr)
        return exc.code


if __name__ == "__main__":
    raise SystemExit(main())
