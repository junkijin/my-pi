---
name: commit-message-guidelines
description: Write repository-consistent Git commit messages from staged diffs and recent commit history, with an imperative subject line (~50 chars) and optional wrapped body (~72 chars) focused on intent and impact. Use when Claude needs to draft or refine a commit message that matches project conventions before `git commit`.
---

# Git Commit Message Best Practices

Good commit messages matter. A well-crafted commit message communicates *context* about a change to fellow developers and future maintainers. A diff tells you *what* changed, but only the commit message can properly tell you *why*.

## The Seven Rules of a Great Git Commit Message

### 1. Separate subject from body with a blank line

The first line is the subject, followed by a blank line, then the body.

```
Summarize changes in around 50 characters or less

More detailed explanatory text, if necessary. Wrap it to about 72
characters or so. The blank line separating the summary from the body
is critical; various tools like `log`, `shortlog` and `rebase` can get
confused if you run the two together.
```

**Simple commits** may only need a subject line:
```
Fix typo in introduction to user guide
```

### 2. Limit the subject line to 50 characters

- 50 characters is the soft limit (rule of thumb)
- 72 characters is the hard limit
- Forces concise, clear summaries
- If summarizing is hard, you might be committing too many changes at once

### 3. Capitalize the subject line

Always begin the subject line with a capital letter.

**Good:**
```
Accelerate to 88 miles per hour
```

**Bad:**
```
accelerate to 88 miles per hour
```

### 4. Do not end the subject line with a period

Trailing punctuation is unnecessary and wastes precious characters.

**Good:**
```
Open the pod bay doors
```

**Bad:**
```
Open the pod bay doors.
```

### 5. Use the imperative mood in the subject line

Write as if giving a command or instruction. This matches Git's own conventions (e.g., `Merge branch 'feature'`, `Revert "Add thing"`).

**Test:** A properly formed subject line should complete:
> "If applied, this commit will *your subject line here*"

**Good examples:**
- Refactor subsystem X for readability
- Update getting started documentation
- Remove deprecated methods
- Release version 1.0.0

**Bad examples:**
- Fixed bug with Y (past tense)
- Changing behavior of X (gerund)
- More fixes for broken stuff (vague)

### 6. Wrap the body at 72 characters

Git never wraps text automatically. Manually wrap the body at 72 characters so Git has room to indent while staying under 80 characters overall.

### 7. Use the body to explain *what* and *why* vs. *how*

The code explains *how*. The commit message should explain:
- What problem this commit solves
- Why this change was necessary
- What was wrong with the previous behavior
- Any side effects or unintuitive consequences

**Good body example:**
```
Simplify serialize.h's exception handling

Remove the 'state' and 'exceptmask' from serialize.h's stream
implementations, as well as related methods.

As exceptmask always included 'failbit', and setstate was always
called with bits = failbit, all it did was immediately raise an
exception. Get rid of those variables, and replace the setstate
with direct exception throwing (which also removes some dead
code).
```

## Complete Commit Message Template

```
Summarize changes in around 50 characters or less

More detailed explanatory text, if necessary. Wrap it to about 72
characters or so. In some contexts, the first line is treated as the
subject of the commit and the rest of the text as the body. The
blank line separating the summary from the body is critical (unless
you omit the body entirely).

Explain the problem that this commit is solving. Focus on why you
are making this change as opposed to how (the code explains that).
Are there side effects or other unintuitive consequences of this
change? Here's the place to explain them.

Further paragraphs come after blank lines.

 - Bullet points are okay, too

 - Typically a hyphen or asterisk is used for the bullet, preceded
   by a single space, with blank lines in between

If you use an issue tracker, put references to them at the bottom,
like this:

Resolves: #123
See also: #456, #789
```

## Quick Reference Checklist

When writing a commit message, verify:

- [ ] Subject is 50 characters or less (72 max)
- [ ] Subject starts with a capital letter
- [ ] Subject has no trailing period
- [ ] Subject uses imperative mood ("Add feature" not "Added feature")
- [ ] Blank line between subject and body (if body exists)
- [ ] Body wrapped at 72 characters
- [ ] Body explains what and why, not how

## Common Commit Types

Use these prefixes when appropriate for your project:

| Type | Description |
|------|-------------|
| Add | New feature or file |
| Update | Enhancement to existing feature |
| Fix | Bug fix |
| Remove | Removing code or files |
| Refactor | Code restructuring without behavior change |
| Docs | Documentation changes |
| Test | Adding or updating tests |
| Style | Formatting, whitespace (no code change) |
| Perf | Performance improvements |
