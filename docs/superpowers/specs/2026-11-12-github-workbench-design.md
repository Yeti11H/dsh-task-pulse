# GitHub workbench, approved implementation scope

The user approved a visual GitHub workflow: connect an account, select a repository, browse and collapse files inside DSH, ask the Agent to propose a change, review it, locate problems in actual code, and create a PR. The user asked to reuse existing authorization rather than register a GitHub App. This document supersedes the unimplemented local Maven acceptance design; its incomplete prototype is retained outside the repository in the workspace's work directory.

## Architecture

Reuse official `gh auth login --web --hostname github.com` and its credential store. No copied OAuth client identity, new OAuth app, PAT input, cloud backend, database or custom credential storage. A Java 17 Spring Boot service on loopback invokes `gh api` with a fixed executable and argv, never a shell command. An explicit random pairing token protects the local service; exact browser Origin allowlisting protects browser requests. No GitHub tokens are returned to React or the Agent. Login runs in the user's own terminal; the workbench detects readiness after login. The CLI may use a plaintext fallback if its OS credential store fails; do not claim otherwise.

This is a local single-user companion, not a multi-tenant SaaS. It uses the active GitHub CLI account and that account's existing scopes. Repository selection restricts this workbench's operations; it does not narrow the CLI's actual GitHub authorization. Revocation stays in GitHub CLI/GitHub settings.

React adds a separate Repository tab to Pulse while preserving the task-status panel. The browser pairs with the local companion using a memory-only token. Browse repositories and branches, pin a selection to its commit, and navigate a collapsible directory tree. Directory/file reads use fixed GitHub API endpoints and SHA references. Render source as escaped text with line numbers; no raw HTML. All credentials and source viewers clear on disconnect. Component remount on DSH session switch prevents accidental cross-session draft display.

## Agent integration

A Host adapter optionally registers `pulse_github` when `PULSE_BRIDGE_TOKEN` is configured. It uses the same loopback service and the real `exec.agent.session.id`. The browser binds an exact repo/branch/commit context to its DSH session. Agent actions can inspect that context, list/read files and propose an updated UTF-8 file for an existing text blob, with expected original blob SHA. It cannot publish, delete a file, change credentials or select another repository. The user explicitly sends a request through the real Session.prompt API. Unlike the previous read-only phase, selected source and proposed code may appear in normal DSH tool history; document this privacy expansion.

## Review and publication

Drafts stay in bounded service memory. Show expandable per-file diff, additions/deletions and before/after line navigation. A user can also edit text directly. No fake test verdicts: only actual GitHub check-run annotations can become problem links; otherwise show no reported annotations/unverified, not "all correct". Annotation links bind to the report's head SHA; a mismatched revision is explicitly stale and excluded from current-line navigation.

Publish is an explicit user action: validate title and file changes, verify base branch still has the pinned SHA, create an atomic Git tree/commit and a fresh `pulse/...` branch, then create a draft PR. Never push to base or merge. Store publish status per draft; repeated clicks return the same result. A failure after branch creation retains enough state to retry PR creation without creating another branch. Uncertain mutation outcomes require reconciliation rather than blind replay. Respect read-only accounts, conflicts, missing files, binary/large files and rate limits with specific safe errors.

## Boundaries and checks

GitHub.com only in v1, no arbitrary API URL/GraphQL/shell. Cap source size, response bytes, files/drafts/history, pagination and annotations, with visible truncation. Reject invalid repo/path/ref/SHA and unsupported symlink/submodule files. Pair token is only in Authorization headers; no URL/localStorage. API errors return stable codes, never raw stderr with potential credentials. Endpoint rejects unapproved origins, non-loopback peers, invalid content types and oversized bodies. Logout disconnects the workbench without modifying the user's global CLI login.

Tests precede implementation: mocked GitHub transport for branch races, stale annotation SHA, file identity, changed-line mapping, API errors, publication idempotency and partial failures; process tests for argv/stdin/output limits; HTTP tests for pairing and CORS; browser interaction tests for connect/repo tree/edit/diff/navigation. Run Java tests, npm check/test/build, real read-only GitHub smoke tests using the existing login, and both DSH type matrix jobs. Mutation tests use a fake GitHub service; do not publish arbitrary test branches in user repositories. Real interactive login from a fresh account and real model edits require separate verification and must be identified as untested if unavailable.
