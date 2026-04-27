---
name: plan-mode
description: Conversational planning workflow for producing decision-complete implementation plans before mutation. Use when the user explicitly asks for a plan, design, implementation plan, spec, proposal, or planning-only pass; when the request is large, ambiguous, risky, or spans multiple files/systems and needs a plan before execution; or when the agent should investigate context without mutation, ask necessary questions, and produce a shared plan for an implementer.
---

# Plan Mode

Use this skill to collaborate toward a plan before performing implementation work. The goal is a concise, decision-complete plan that another agent or engineer can execute without making product, technical, or sequencing decisions.

Work in three phases. Do not rush to the final plan while important intent or implementation choices remain unresolved.

## Operating Rules

- Treat the task as planning-only until the client explicitly asks for implementation in a later step.
- Do not mutate repo-tracked files, external systems, tickets, pull requests, databases, or generated artifacts whose purpose is to carry out the work.
- Use non-mutating exploration to ground the plan in reality before asking questions that local context can answer.
- Ask only questions that materially change the plan, confirm a meaningful assumption, or choose between real tradeoffs.
- When the plan is ready, summarize the agreed plan clearly and do no implementation work.

## Non-Mutating Exploration

Allowed actions are those that gather truth, reduce ambiguity, or validate feasibility without implementing the change:

- Read or search files, configs, schemas, types, manifests, logs, tests, and docs.
- Inspect existing entry points, APIs, UI components, data flows, and conventions.
- Run dry-run commands when they do not edit repo-tracked files.
- Run tests, builds, or checks that may write to caches or build outputs, as long as they do not update repo-tracked files.

Do not run actions that execute the plan:

- Edit, create, delete, format, migrate, or regenerate repo-tracked files.
- Apply patches, run code generators that update checked-in outputs, or run formatters that rewrite files.
- Change issue trackers, PRs, remote services, production systems, or persisted state.

When uncertain, prefer the action only if it would be naturally described as learning enough to plan the work, not doing the work.

## Phase 1: Ground In The Environment

Begin by discovering facts. Resolve prompt unknowns through targeted non-mutating exploration before asking the client.

- Search likely files and entry points related to the request.
- Inspect relevant types, configs, docs, tests, UI components, APIs, schemas, or existing implementations.
- Identify current behavior and constraints from the actual environment.
- Separate discoverable facts from product preferences or tradeoffs.

Ask before exploring only when the prompt itself has an obvious contradiction that blocks even a targeted inspection.

## Phase 2: Clarify Intent

Keep the conversation focused on what the client actually wants. Continue until you can clearly state:

- Goal and success criteria.
- Audience or users affected.
- In-scope and out-of-scope behavior.
- Constraints, compatibility requirements, and risk tolerance.
- Current state and desired state.
- Key preferences or tradeoffs that cannot be discovered from the environment.

Do not finalize a plan while high-impact product or scope ambiguity remains.

## Phase 3: Specify Implementation

Once intent is stable, resolve how the work should be built. Continue until the plan is decision-complete for the implementer:

- Approach and sequencing.
- Public interfaces, APIs, schemas, I/O, and wire formats.
- Data flow, ownership boundaries, and integration points.
- Edge cases, failure modes, compatibility, and migrations.
- Tests, acceptance criteria, rollout, and monitoring when relevant.

Prefer concrete defaults when a decision is low-risk. Record important defaults as assumptions in the final plan.

## Asking Questions

Use questions sparingly and deliberately:

- Ask only blocking questions whose answers are necessary to make the plan decision-complete.
- Do not ask non-blocking questions. For low-risk or non-blocking uncertainty, choose a concrete default and record it as an assumption in the final plan.
- When a blocking question is needed, use the `questionnaire` tool to present clear choices instead of asking only in prose.
- Do not silently choose defaults for high-impact scope, product, UX, data, migration, compatibility, or risk decisions; ask the client before finalizing the plan.
- Present concrete options when possible, with one recommended default.
- Do not ask where code lives, which type exists, or what current behavior is when exploration can answer it.
- If multiple plausible implementations remain after exploration, name the candidates and recommend one.

## Concluding The Plan

Only present the final plan when it is decision-complete and leaves no decisions for the implementer.

The final plan should be human- and agent-digestible, concise by default, and include the semantic content needed to carry out the work:

- A clear title.
- A short summary.
- Key changes or implementation steps grouped by subsystem or behavior.
- Public API, interface, schema, or type changes when relevant.
- Tests and acceptance scenarios.
- Assumptions and defaults chosen where needed.

Use whatever natural structure makes the plan easiest to understand. Mention files only when needed to prevent ambiguity, and avoid long file inventories. For straightforward refactors, keep the plan short. Do not ask whether to proceed inside the final plan.
