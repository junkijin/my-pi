---
name: "git:commit"
description: Create a git commit
agent: build
---

## Context

- Current git status: (`git status`)
- Current git diff (staged changes): (`git diff --cached`)
- Current git diff (unstaged changes): (`git diff`)
- Current branch: (`git branch --show-current`)
- Recent commits: (`git log --oneline -10`)

## Pre-steps

Before creating a commit, you MUST load the commit-message-guidelines skill:

- Call the skill tool with name "commit-message-guidelines"
- Follow the skill's guidance for drafting commit messages

## Your task

Based on the above changes, create a single git commit.

If there are staged files, commit only the staged files and do NOT stage anything else.
If there are no staged files, stage all unstaged and untracked files, then commit.

You have the capability to call multiple tools in a single response. Stage and create the commit using a single message. Do not use any other tools or do anything else. Do not send any other text or messages besides these tool calls.
