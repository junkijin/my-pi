# Compare package

Read this only when you need a curated context package.

## Goal

Do not send a raw repository by default.
Send a compact package that lets the comparison model spend its context on reasoning, not rediscovery.

## Preferred shape

Keep it short. Aim for **5-15 bullets**.

```text
Goal:
- ...

Constraints:
- ...

Relevant files / excerpts:
- path/to/file.ts: short excerpt or note
- path/to/other.ts: short excerpt or note

Current approach:
- ...

Open question:
- ...

Required output:
- exactly 3 bullets / JSON / table
```

## Recommended commands

Create a new compare thread automatically:

```bash
scripts/subagent compare --provider <provider> --model <model> "<question>"
```

Continue an existing compare thread:

```bash
scripts/subagent compare --thread-id <thread-id> --provider <provider> --model <model> "<question>"
```

Attach a package file when it is longer than a few lines:

```bash
scripts/subagent compare \
  --thread-id <thread-id> \
  --provider <provider> \
  --model <model> \
  --package-file path/to/context-package.md \
  "<question>"
```

## Rules

- Comparison is still thread-based. Reuse the same `thread_id` for follow-up.
- If you omit `--thread-id`, capture the printed UUID and reuse it later.
- Override provider/model only when the user explicitly asks for a different target.
- If you pass a different provider/model on an existing thread, that thread's target will change for later follow-up.
- Do not enable tools unless the user explicitly wants the comparison model to inspect files.
- Prefer uncertainty over scope expansion.
- Ask the model to compare, not to rediscover.
