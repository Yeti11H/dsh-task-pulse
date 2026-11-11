# DSH Pulse design

Date: 2026-11-11

## Purpose

Implement the task-status sidebar discussed and approved in this chat. Show what a DSH agent is observably doing, recent completed work, elapsed time, and whether the user needs to act. Keep the plugin small, configurable, and independent from model providers.

## Scope

- One installable DSH bundle with an inert Host entry and a Client sidebar, reusing DSH's existing authenticated Host observation and Client event bridge.
- Read public lifecycle, tool, streaming, and interaction events without intercepting execution.
- Track sessions independently and represent simultaneous tool calls separately.
- Derive descriptions from structured events; make no extra model calls.
- Configurable quiet threshold. Silence means uncertain status, never proof of a deadlock.
- Show a bounded recent-activity list and errors; avoid copying arguments, file contents, or model reasoning into status records.
- Refresh snapshots on reconnect. When the Host restarts, report the observation boundary rather than claiming earlier progress was recovered.
- Supply local installation instructions, a built tarball, tests, and a preview.

## Boundaries

No hidden-thought inspection, percentage completion, automatic cancellation/retry, desktop notifications, workflow editor, draw.io integration, task recovery engine, or public publishing in version 0.1.0. Existing DSH interaction controls remain the place to approve or answer requests.

## Architecture

1. A pure state reducer consumes normalized events and creates bounded session snapshots.
2. A Client adapter reads DSH's supported Session Controller event source and connection status. DSH already owns Host observation, history, and authenticated transport, so no additional Host service is needed.
3. A Client sidebar subscribes while open, displays activity, and computes elapsed time locally. Connection state remains separate from execution state.

The reducer imports no DSH modules. The view knows only the snapshot contract. The Client adapter is the only part tied to a DSH release.

## Verification

Test concurrent tools, stream progress, known waiting states, errors, cancellation, silence, session isolation, bounded storage, observer disposal, and reconnect. Build and pack the actual bundle. Load it in a real DSH instance and exercise a keyless test tool so verification does not need a model account. Inspect the rendered sidebar. Document exactly what was verified and any unsupported signals.

## Success

A user can install the local tarball, open Pulse in DSH, and distinguish observed model output, running tools, known waiting states, completed turns, errors, and observation gaps without reading raw logs.
