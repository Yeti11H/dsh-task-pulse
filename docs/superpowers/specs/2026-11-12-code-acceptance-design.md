# Code acceptance with an in-DSH source viewer

## Approved direction

The user approved the proposed minimum Java-backed acceptance assistant and requested collapsible evidence and navigation to code, preferring viewing inside DSH. This supersedes the earlier phase-1-only, no-new-connection scope for this feature. Existing waste analysis stays pure and independent.

## Scope and choices

Implement a small Spring Boot companion plus the existing DSH sidebar. The companion owns one explicitly configured local Git repository and one fixed Maven `test` action. The user connects with a startup capability token and starts verification explicitly. Do not infer test success from assistant messages.

A client-only event summary cannot reliably establish repository contents or actual Maven exit status. A complete remote execution platform is unnecessary for the first release. A loopback companion provides the required real execution and file reads with a narrow contract. It works when the browser, companion and DSH workspace refer to the same local machine/repository. Remote DSH deployments require a future Host transport adapter; do not silently treat a remote Host path as a local repository.

DSH contracts were read before implementation: `props.useSessions(value => value.byId[props.sessionId]?.cwd)` gives catalog cwd. The installed controller's `openWorkspacePath` opens a native Host application, not an embedded source editor. Implement our own read-only source viewer within the sidebar; do not invent a DSH editor API. No new DSH runtime import belongs in pure logic.

## User flow

1. Start the Java companion with an allowed repository path and the exact DSH browser origin. It binds loopback and prints a fresh token.
2. Expand Acceptance in Pulse, enter the companion address/token, and connect. The session cwd must match the configured repository. Credentials stay in component memory; never in URLs or localStorage.
3. Display current uncommitted changes relative to HEAD, grouped as collapsible files. Clearly label this scope, not "files changed by this Agent turn". No change baseline existed before the Agent worked.
4. Expand a file and click a changed hunk/test failure to load a bounded source excerpt and highlight its line. Deleted files have no current source. Keep horizontal code scrolling inside the excerpt and expose copyable `path:line`.
5. Explicitly start Maven tests. Show queued/running/final states and a cancel action. Present actual exit status, fresh JUnit report counts, and missing evidence separately. Exit 0 with no fresh reports means command success, tests unverified.
6. Bind the report to HEAD plus working-tree revision. Changes after/during execution mark evidence stale. Switching sessions or disconnecting cancels client reads and discards source/token state; an already accepted test job continues unless explicitly cancelled.

## Backend

Java 17, Spring Boot, Maven, a single bounded worker, bounded in-memory job history, polling REST, JSON records. No database, message broker or model calls. Idempotency keys prevent duplicate execution of retried submissions; at most one active job exists. Cancellation and timeout terminate the process tree. Shutdown closes worker/process resources.

APIs: authenticated workspace inspection, source excerpt read, create/read/cancel verification jobs. No request-supplied shell command. Fixed test command is executed from the allowed root; Maven execution may run repository build plugins, so the interface identifies the action before the user starts it. Read only the required Maven reports with external XML entities disabled. Compare report signatures before/after execution to avoid reusing old evidence.

## Boundaries

Bind `127.0.0.1`, require Bearer token and exact configured Origin, reject unmatched browser Origins, disable caching. Resolve configured root and all file paths; reject traversal, symlinks outside or within the root, `.git`, common credential files, binary/oversized files. Limit number/size of changed files and process output; report truncation instead of pretending to have complete evidence. No cloud upload, automatic execution, token persistence or telemetry.

Source excerpts exist transiently in the acceptance viewer, separate from PulseState and waste metadata. This is an explicit expansion of the old "no file contents" behavior: display only on user action, never store them in reducer history or browser storage. Process logs are drained without storage; reported test evidence is structured metadata. Do not describe hashes as encryption or JUnit as proof of correctness.

## Verification

Tests first: backend path containment, secret filtering, Git revision changes, actual process execution/cancel/timeout/idempotency, fresh report parsing, stale detection, authorization. Client contract/state/view tests cover folding, source selection, missing evidence and stale results. Run existing TypeScript checks/tests/build and Maven tests, then exercise a real temporary Maven project through the actual HTTP API and browser UI. Capture screenshots. Distinguish browser fixture coverage from real DSH integration.

One new branch and one PR, stacked on phase 1 while it remains unmerged. No merging or npm publication in this feature task.
