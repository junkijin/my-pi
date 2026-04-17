# Troubleshooting

Read this only after a command fails.

## Common failures

### `pi: command not found`

Run:

```bash
which pi && pi --help
```

### `python3 is required`

Run:

```bash
python3 --version
```

### Current session provider/model could not be inferred for a new thread

Typical causes:

- current session is ephemeral
- custom `--session-dir` is in use
- the session file has not recorded model metadata yet

Fallback:

```bash
scripts/subagent --thread-id <thread-id> --provider <provider> --model <model> "<prompt>"
```

### You forgot the generated thread id

List the current cwd threads and reuse the relevant `thread_id`:

```bash
scripts/subagent threads list
```

### Existing thread behaves badly or keeps dragging stale context

Create a checkpoint and rotate to a fresh thread:

```bash
scripts/subagent threads checkpoint <thread-id>
scripts/subagent threads rotate <thread-id>
```

### Output contains terminal noise

The wrapper already strips common ANSI/OSC noise. If noise still appears, capture the raw output once and inspect `scripts/_subagent.py`.

## First fallback order

1. Retry with the same `thread_id`.
2. Pass explicit `--provider` and `--model` on that thread.
3. Reduce scope and keep `--no-tools`.
4. Only then inspect `scripts/_subagent.py`.
