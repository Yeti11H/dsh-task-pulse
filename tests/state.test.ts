import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, errorExcerpt, initialState, reduceEvent, RECENT_LIMIT, type DisplayInput } from '../src/state.ts';
import { createMonitor, type EventWindow } from '../src/monitor.ts';

const event = (type: string, time: number, data: Record<string, unknown> = {}, seq = time) => ({ type, time, data, seq });
const running: DisplayInput = { connected: true, openState: 'open', running: true, waiting: false, now: 1000, quietSeconds: 120 };
function started() { return reduceEvent(initialState(), event('turn/start', 100, { turn: 1 })); }

test('matches real DSH toolCallId values and retains concurrent calls independently', () => {
  let state = reduceEvent(started(), event('tool/call', 200, { callId: 'a', name: 'read_file' }));
  state = reduceEvent(state, event('tool/call', 300, { callId: 'b', name: 'run_tests' }));
  state = reduceEvent(state, event('tool/result', 500, { message: { toolCallId: 'a', content: [{ type: 'text', text: 'private file body' }] } }));
  assert.deepEqual(state.tools.map(tool => tool.id), ['b']);
  assert.equal(state.recent[0].name, 'read_file');
  assert.equal(state.recent[0].startedAt, 200);
  assert.equal(state.completedTools, 1);
  assert.ok(!JSON.stringify(state).includes('private file body'));
});
test('uses structured completed, aborted, and failed DSH end reasons', () => {
  assert.equal(reduceEvent(started(), event('turn/end', 500, { reason: { kind: 'completed' } })).phase, 'complete');
  assert.equal(reduceEvent(started(), event('turn/end', 500, { reason: { kind: 'aborted', reason: { kind: 'user' } } })).phase, 'cancelled');
  const failed = reduceEvent(started(), event('turn/end', 500, { reason: { kind: 'error', error: { message: 'Timeout', code: 'TIMEOUT' } } }));
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, 'Timeout');
  for (const kind of ['max-tokens', 'interrupted', 'blocked', 'forked', 'new-outcome']) {
    assert.notEqual(reduceEvent(started(), event('turn/end', 500, { reason: { kind } })).phase, 'complete');
  }
});
test('reused provider call ids in later turns keep distinct activity identities', () => {
  let state = started();
  state = reduceEvent(state, event('tool/result', 200, { message: { toolCallId: 'reused' } }));
  state = reduceEvent(state, event('turn/start', 300, { turn: 2 }));
  state = reduceEvent(state, event('tool/result', 400, { message: { toolCallId: 'reused' } }));
  assert.equal(state.recent.length, 2);
  assert.notEqual(state.recent[0].id, state.recent[1].id);
});
test('quiet periods are uncertain and known waiting states take precedence', () => {
  const state = started();
  assert.equal(displayStatus(state, { ...running, now: 120100 }), 'quiet');
  assert.equal(displayStatus(state, { ...running, now: 120100, waiting: true }), 'waiting');
  assert.equal(displayStatus(state, { ...running, now: 120100, connected: false }), 'disconnected');
  assert.equal(displayStatus(state, { ...running, now: 120100, running: false }), 'idle');
});
test('text and reasoning deltas advance the heartbeat without copying their contents', () => {
  const state = reduceEvent(started(), event('assistant/live-chunk', 120000, { chunk: { type: 'reasoning-delta', text: 'private reasoning' } }));
  assert.equal(displayStatus(state, { ...running, now: 121000 }), 'output');
  assert.equal(state.lastActivityAt, 120000);
  assert.ok(!JSON.stringify(state).includes('private reasoning'));
  assert.strictEqual(reduceEvent(state, event('assistant/live-chunk', 122000, { chunk: { type: 'usage' } })), state);
});
test('approval audit records remain pending until the matching decision', () => {
  let state = reduceEvent(started(), event('approval/asked', 200, { id: 'r1' }));
  state = reduceEvent(state, event('approval/asked', 300, { id: 'r2' }));
  state = reduceEvent(state, event('approval/decided', 400, { id: 'r1' }));
  assert.equal(displayStatus(state, running), 'waiting');
  state = reduceEvent(state, event('approval/decided', 500, { id: 'r2' }));
  assert.equal(displayStatus(state, running), 'preparing');
});
test('failures do not increment success and never retain raw tool results or arguments', () => {
  let state = reduceEvent(started(), event('tool/call', 200, { callId: 'a', name: 'fetch', arguments: '{"token":"secret-value"}' }));
  state = reduceEvent(state, event('tool/result', 300, { message: { toolCallId: 'a', isError: true, content: 'secret-value' }, error: { name: 'NetworkError', code: 'OFFLINE', reason: 'secret-value' } }));
  assert.equal(state.completedTools, 0);
  assert.equal(state.error, 'NetworkError: OFFLINE');
  assert.ok(!JSON.stringify(state).includes('secret-value'));
});
test('new turns clear pending tools, approvals and counters; recent entries stay bounded', () => {
  let state = started();
  for (let n = 0; n < 30; n++) state = reduceEvent(state, event('tool/result', 200 + n, { message: { toolCallId: `a${n}` } }));
  assert.equal(state.recent.length, RECENT_LIMIT);
  state = reduceEvent(state, event('turn/start', 900, { turn: 2 }));
  assert.equal(state.completedTools, 0);
  assert.equal(state.startedAt, 900);
  assert.equal(state.recent.length, RECENT_LIMIT);
});
test('unknown events and invalid timestamps do not alter state', () => {
  const state = started();
  for (const input of [null, {}, event('plugin/custom', 900), event('turn/start', NaN)]) assert.strictEqual(reduceEvent(state, input), state);
});
test('error excerpts redact common credentials and remain bounded', () => {
  const value = errorExcerpt('Bearer abc.def api_key=abc token=secret sk-abcdefgh ' + 'x'.repeat(900));
  assert.ok(!value.includes('abc.def'));
  assert.ok(!value.includes('token=secret'));
  assert.ok(!value.includes('sk-abcdefgh'));
  assert.ok(value.length <= 400);
});
test('session-unavailable and disconnected states override cached successful history', () => {
  const state = reduceEvent(started(), event('turn/end', 500, { reason: { kind: 'completed' } }));
  assert.equal(displayStatus(state, { ...running, running: false, openState: 'error' }), 'unavailable');
  assert.equal(displayStatus(state, { ...running, running: false, connected: false }), 'disconnected');
});

class Source {
  listeners = new Set<() => void>();
  window: EventWindow = { revision: 0, entries: [], change: { kind: 'replace', entries: [] } };
  getSnapshot = () => this.window;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(kind: string, entries: EventWindow['entries'], all = entries) {
    this.window = { revision: this.window.revision + 1, entries: all, change: { kind, entries } };
    for (const listener of this.listeners) listener();
  }
}
test('monitor replays reconnect baselines, settles streams, and releases subscriptions', () => {
  const source = new Source();
  const monitor = createMonitor(source);
  const dispose = monitor.subscribe(() => {});
  const start = { event: event('turn/start', 100, { turn: 1 }) };
  source.set('append', [start]);
  const chunk = { event: event('assistant/live-chunk', 200, { chunk: { type: 'text-delta', text: 'hello' } }) };
  source.set('append', [chunk], [start, chunk]);
  assert.equal(monitor.getSnapshot().phase, 'output');
  const settlement = { event: event('assistant/message', 300) };
  source.set('settle-assistant', [], [start, settlement]);
  assert.equal(monitor.getSnapshot().phase, 'preparing');
  const end = { event: event('turn/end', 400, { reason: { kind: 'completed' } }) };
  source.set('replace', [start, settlement, end]);
  assert.equal(monitor.getSnapshot().phase, 'complete');
  assert.equal(monitor.getSnapshot().recent.length, 1);
  dispose();
  assert.equal(source.listeners.size, 0);
});
test('separate monitors never mix sessions, and two consumers share one listener', () => {
  const one = new Source(); const two = new Source();
  const a = createMonitor(one); const b = createMonitor(two);
  const off1 = a.subscribe(() => {}); const off2 = a.subscribe(() => {}); const off3 = b.subscribe(() => {});
  assert.equal(one.listeners.size, 1);
  one.set('append', [{ event: event('tool/call', 200, { callId: 'a', name: 'private_session_tool' }) }]);
  assert.equal(b.getSnapshot().tools.length, 0);
  off1(); assert.equal(one.listeners.size, 1);
  off2(); off3(); assert.equal(one.listeners.size + two.listeners.size, 0);
});
