# Implementation plan

1. Define Java transport and contracts; add failing service and authorization tests.
2. Implement bounded GitHub CLI transport, memory-only session contexts/drafts, SHA-pinned reads, annotations, atomic branch publication with recoverable status.
3. Add authenticated loopback REST adapter and documented startup/login commands.
4. Add pure TypeScript contracts/diff/annotation utilities with tests; implement collapsible repository/file/diff view and source line navigation in both locales.
5. Wire real DSH Session.prompt and optional Host read/propose tool, using inspected package definitions.
6. Run backend, frontend and browser checks, then a real read-only GitHub smoke test. Create a stacked review PR and wait for CI. No merge or npm release.
