---
name: sub-agent-call
description: Invoke a nested `pi` CLI session as a sub-agent in a persistent thread for second opinions, provider/model comparison, repository inspection, or continued follow-up. Use when the user asks to consult another agent/model, compare providers, or continue a focused sub-agent conversation from pi. By default, reuse the current session's provider and model unless the user explicitly asks for a different one.
compatibility: Pi only. Requires `pi` and `python3` on PATH. Default provider/model inference uses the current persisted pi session for the current cwd.
---

# Sub-agent call with pi

Use this skill to delegate a task to a nested `pi` session.

## Use only this public command

- `scripts/subagent`

Do **not** read `scripts/_subagent.py` unless you are debugging the skill itself.

## Defaults

- Every delegated call is **thread-based**.
- If `--thread-id` is omitted, `scripts/subagent` auto-generates a UUID and prints it on `stderr`.
- Reuse the printed `thread_id` for follow-up instead of inventing another identifier.
- Reuse the **current session's provider and model** unless the user explicitly asks for another target.
- Use **`--no-tools`** unless inspection is explicitly required.
- Prefer a **curated context package** over raw repository access.
- Prefer command help over reading implementation.

## Fast routing

### Default sub-agent call

Create a new thread automatically:

```bash
scripts/subagent "<prompt>"
```

Continue an existing thread:

```bash
scripts/subagent --thread-id <thread-id> "<prompt>"
```

### Explicit cross-model comparison

Use only when the user explicitly asks for another provider/model.

```bash
scripts/subagent compare --provider <provider> --model <model> "<prompt>"
```

```bash
scripts/subagent compare --thread-id <thread-id> --provider <provider> --model <model> "<prompt>"
```

If the context package is larger than a few lines, attach it as a small file:

```bash
scripts/subagent compare --thread-id <thread-id> --provider <provider> --model <model> --package-file path/to/context-package.md "<prompt>"
```

### Read-only repository inspection

```bash
scripts/subagent readonly "<prompt>"
```

```bash
scripts/subagent readonly --thread-id <thread-id> "<prompt>"
```

### Thread management

```bash
scripts/subagent threads list
scripts/subagent threads checkpoint <thread-id>
scripts/subagent threads rotate <old-thread-id> [new-thread-id]
scripts/subagent threads delete <thread-id>
```

## Minimal workflow

1. Verify `pi` only if the environment looks broken:
   ```bash
   which pi && pi --help
   ```
2. Start the first delegated call without `--thread-id` unless the user already gave you a specific id.
3. Capture the printed `thread_id` and reuse it for follow-up.
4. Override `--provider` and `--model` only when the user explicitly requests another target.
5. Keep the delegated prompt short and explicit about output format.
6. For model comparison, pass a **curated context package** instead of asking the sub-agent to rediscover the same context.
7. If the package is more than a few lines, save it and attach it with `--package-file`.

## Read more only if needed

- `docs/compare-package.md`
  - Read only when building a curated context package for comparison or review.
- `docs/troubleshooting.md`
  - Read only after a command fails or session inference is unclear.
