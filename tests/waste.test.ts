import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a } from '../src/waste.ts';
import { initialState, reduceEvent, type PulseState } from '../src/state.ts';
import { createMonitor, type EventWindow } from '../src/monitor.ts';

const event = (type: string, time: number, data: Record<string, unknown> = {}) => ({ type, time, seq: time, data });
const start = () => reduceEvent(initialState(), event('turn/start', 0, { turn: 1 }));
const step = (n: number, at: number) => event('step/start', at, { turn: 1, step: n });
const call = (id: string, at: number, args = '{}', name = 'read', n = 1) =>
  event('tool/call', at, { turn: 1, step: n, callId: id, name, arguments: args });
const result = (id: string, at: number, isError = false, n = 1) =>
  event('tool/result', at, { turn: 1, step: n, message: { toolCallId: id, isError } });
const endStep = (n: number, at: number) => event('step/end', at, { turn: 1, step: n });
const end = (at: number) => event('turn/end', at, { turn: 1, reason: { kind: 'completed' } });
const message = (n: number, at: number, usage?: Record<string, number>, stream: unknown[] = []) =>
  event('assistant/message', at, { turn: 1, step: n, usage, stream });
const replay = (events: unknown[], state = start()): PulseState => events.reduce<PulseState>(reduceEvent, state);

test('FNV-1a hashes raw UTF-8 arguments without normalizing JSON', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('hello'), 0x4f9f2cab);
  assert.notEqual(fnv1a('{"a":1}'), fnv1a('{ "a": 1 }'));
  assert.notEqual(fnv1a('é'), fnv1a('e\u0301'));
});

test('R1 starts at count three, is not required to be consecutive, and accumulates', () => {
  let state = replay([step(1, 1), call('a', 2), call('other', 3, '{"x":1}'), call('b', 4)]);
  assert.deepEqual(state.findings, []);
  state = reduceEvent(state, call('c', 5));
  assert.equal(state.findings.length, 1);
  assert.equal(state.findings[0].rule, 'R1');
  assert.equal(state.findings[0].count, 3);
  assert.equal(state.findings[0].firstAt, 2);
  const id = state.findings[0].id;
  state = reduceEvent(state, call('d', 6));
  assert.equal(state.findings[0].id, id);
  assert.equal(state.findings[0].count, 4);
  assert.equal(state.findings[0].lastAt, 6);
});

test('R1 distinguishes names and hashes and ignores missing arguments', () => {
  const state = replay([call('a', 1, '{"x":1}'), call('b', 2, '{"x":2}'), call('c', 3, '{"x":3}'),
    call('d', 4, '{"x":1}', 'write'),
    ...[5, 6, 7].map(at => event('tool/call', at, { callId: `missing-${at}`, name: 'missing' }))]);
  assert.deepEqual(state.findings, []);
});

test('R2 success breaks a tool failure streak; other tools do not', () => {
  const state = replay([call('a', 1), result('a', 2, true), call('b', 3), result('b', 4, true),
    call('c', 5, '{"ok":true}'), result('c', 6), call('d', 7, '{"next":true}'), result('d', 8, true)]);
  assert.ok(!state.findings.some(finding => finding.rule === 'R2'));
  const failures = replay([call('a', 1), result('a', 2, true), call('b', 3), result('b', 4, true),
    call('other', 5, '{}', 'write'), result('other', 6), call('c', 7), result('c', 8, true)]);
  assert.equal(failures.findings.find(finding => finding.rule === 'R2')?.count, 3);
});

test('R2 accumulates qualifying streaks and does not mistake error metadata for isError', () => {
  const events: unknown[] = [];
  for (let n = 0; n < 7; n++) events.push(call(`${n}`, n * 2 + 1, `${n}`), result(`${n}`, n * 2 + 2, n !== 3));
  const state = replay(events);
  assert.equal(state.findings.find(finding => finding.rule === 'R2')?.count, 6);
  const success = replay([call('a', 1), event('tool/result', 2, {
    step: 1, message: { toolCallId: 'a' }, error: { name: 'Ignored', code: 'IGNORED' }
  })]);
  assert.ok(!success.findings.some(finding => finding.rule === 'R2'));
});

test('R3 needs two attempts in the same step and accumulates without inventing a tool', () => {
  const attempt = (n: number, at: number) => event('assistant/attempt', at, { turn: 1, step: n, stream: [] });
  let state = replay([step(1, 1), attempt(1, 2), endStep(1, 3), step(2, 4), attempt(2, 5)]);
  assert.deepEqual(state.findings, []);
  state = reduceEvent(state, attempt(2, 6));
  assert.equal(state.findings[0].rule, 'R3');
  assert.equal(state.findings[0].count, 2);
  assert.equal(state.findings[0].toolName, null);
  state = reduceEvent(state, attempt(2, 7));
  assert.equal(state.findings[0].count, 3);
});

test('only the third and subsequent calls qualify; finalized all-hit steps count uncached input plus output once', () => {
  const state = replay([step(1, 1), message(1, 2, { inputTokens: 100, outputTokens: 20 }),
    call('a', 3), result('a', 4), endStep(1, 5),
    step(2, 6), message(2, 7, { inputTokens: 100, outputTokens: 20 }),
    call('b', 8, '{}', 'read', 2), result('b', 9, false, 2), endStep(2, 10),
    step(3, 11), message(3, 12, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 90, cacheWriteTokens: 10, reasoningTokens: 7, totalTokens: 220 }),
    call('c', 13, '{}', 'read', 3), result('c', 14, false, 3), endStep(3, 15)]);
  assert.equal(state.wastedTokens, 120);
  assert.equal(state.totalTokens, 460);
  assert.equal(state.findings[0].wastedTokens, 120);
  assert.equal(state.findings[0].estimated, true);
});

test('a mixed step, a no-tool step and a missing-usage step do not add waste', () => {
  const base = replay([step(1, 1), call('a', 2), call('b', 3), result('a', 4), result('b', 5), endStep(1, 6)]);
  const mixed = replay([step(2, 7), message(2, 8, { inputTokens: 10, outputTokens: 5 }),
    call('c', 9, '{}', 'read', 2), call('new', 10, '{}', 'write', 2),
    result('c', 11, false, 2), result('new', 12, false, 2), endStep(2, 13)], base);
  assert.equal(mixed.wastedTokens, 0);
  const missing = replay([step(3, 14), message(3, 15), call('d', 16, '{}', 'read', 3), result('d', 17, false, 3), endStep(3, 18)], mixed);
  assert.equal(missing.wastedTokens, 0);
  assert.equal(missing.findings[0].estimated, false);
  const noTools = replay([step(4, 19), message(4, 20, { inputTokens: 10, outputTokens: 5 }), endStep(4, 21)], missing);
  assert.equal(noTools.wastedTokens, 0);
});

test('R1 and R2 on the same step share one token budget; duplicate settlement does not double totals', () => {
  const state = replay([step(1, 1), call('a', 2), result('a', 3, true), call('b', 4), result('b', 5, true), endStep(1, 6),
    step(2, 7), message(2, 8, { inputTokens: 10, outputTokens: 5 }), message(2, 8, { inputTokens: 10, outputTokens: 5 }),
    call('c', 9, '{}', 'read', 2), result('c', 10, true, 2), endStep(2, 11)]);
  assert.equal(state.wastedTokens, 15);
  assert.equal(state.totalTokens, 15);
  assert.equal(state.findings.reduce((total, finding) => total + finding.wastedTokens, 0), 15);
});

test('findings cap at five while total waste continues to account for suppressed findings', () => {
  const events: unknown[] = [step(0, 1)];
  for (let n = 1; n <= 7; n++) for (let k = 0; k < 2; k++) {
    const at = 2 + n * 4 + k * 2;
    events.push(call(`warm-${n}-${k}`, at, '{}', `tool-${n}`, 0), result(`warm-${n}-${k}`, at + 1, false, 0));
  }
  events.push(endStep(0, 40));
  for (let n = 1; n <= 7; n++) {
    const at = 100 + n * 10;
    events.push(step(n, at), message(n, at + 1, { inputTokens: 1, outputTokens: 1 }));
    events.push(call(`${n}`, at + 2, '{}', `tool-${n}`, n), result(`${n}`, at + 3, false, n), endStep(n, at + 4));
  }
  const state = replay(events);
  assert.equal(state.findings.length, 5);
  assert.equal(state.wastedTokens, 14);
  assert.equal(state.findings.reduce((sum, finding) => sum + finding.wastedTokens, 0), 10);
});

test('two fully overlapping ten-second tools count as ten seconds', () => {
  const state = replay([call('a', 0), call('b', 0, '{}', 'write'), result('a', 10000), result('b', 10000), end(10000)]);
  assert.equal(state.timing.toolMs, 10000);
  assert.equal(Object.values(state.timing).reduce((sum, value) => sum + value, 0), 10000);
});

test('thirty seconds of approval wait followed by five seconds of work excludes approval from tool time', () => {
  const state = replay([call('a', 0), event('approval/asked', 0, { id: 'approval' }),
    event('approval/decided', 30000, { id: 'approval' }), result('a', 35000), end(35000)]);
  assert.equal(state.timing.waitUserMs, 30000);
  assert.equal(state.timing.toolMs, 5000);
});

test('model wait, output, tools, user wait and other partition the full turn', () => {
  const state = replay([step(1, 1000), event('assistant/live-chunk', 3000, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'private' } }),
    message(1, 5000), call('a', 6000), event('approval/asked', 7000, { id: 'a' }),
    event('approval/decided', 9000, { id: 'a' }), result('a', 12000), endStep(1, 13000), end(15000)]);
  assert.deepEqual(state.timing, { waitModelMs: 2000, modelOutputMs: 2000, toolMs: 4000, waitUserMs: 2000, otherMs: 5000 });
  assert.equal(Object.values(state.timing).reduce((sum, value) => sum + value, 0), 15000);
});

test('durable compact streams reproduce timing after transient chunks disappear', () => {
  const durable = [step(1, 1000), message(1, 5000, undefined, [
    { type: 'text-chunks', time0: 2000, index: 0, dt: [1000], texts: ['', 'private'] }
  ]), endStep(1, 6000), end(7000)];
  const live = replay([durable[0], event('assistant/live-chunk', 3000, { step: 1, chunk: { type: 'text-delta', text: 'private' } }), ...durable.slice(1)]);
  assert.deepEqual(replay(durable), live);
  assert.equal(live.timing.waitModelMs, 2000);
  assert.equal(live.timing.modelOutputMs, 2000);
});

test('attempt settlement replay restores both status and compact retry timing', () => {
  const attempt = event('assistant/attempt', 5000, { turn: 1, step: 1, stream: [
    { type: 'reasoning-chunks', time0: 3000, index: 0, dt: [], texts: ['private'] },
    { type: 'chunk', time: 4000, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 } } }
  ] });
  const durable = [step(1, 1000), attempt];
  const live = replay([durable[0], event('assistant/live-chunk', 3000, { turn: 1, step: 1, chunk: { type: 'reasoning-delta', text: 'private' } }), attempt]);
  assert.deepEqual(replay(durable), live);
  assert.equal(live.totalTokens, 17);
  assert.equal(live.timing.waitModelMs, 2000);
  assert.equal(live.timing.modelOutputMs, 2000);
});

test('compact stream gaps are cumulative and raw delta records recover the same first token', () => {
  const compact = replay([step(1, 1000), message(1, 5000, undefined, [
    { type: 'text-chunks', time0: 1500, index: 0, dt: [500, 1000], texts: ['', '', 'yes'] }
  ])]);
  const raw = replay([step(1, 1000), message(1, 5000, undefined, [
    { type: 'chunk', time: 3000, chunk: { type: 'text-delta', index: 0, text: 'yes' } }
  ])]);
  assert.deepEqual(compact.timing, raw.timing);
  assert.equal(compact.timing.waitModelMs, 2000);
});

test('tool argument deltas count as output; usage frames and empty text do not', () => {
  const state = replay([step(1, 1000), message(1, 5000, undefined, [
    { type: 'chunk', time: 1500, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } } },
    { type: 'reasoning-chunks', time0: 2000, index: 0, dt: [], texts: [''] },
    { type: 'tool-call-chunks', time0: 3000, index: 1, id: 'a', dt: [], args: [''], name: 'read' }
  ]), end(6000)]);
  assert.equal(state.timing.waitModelMs, 2000);
  assert.equal(state.timing.modelOutputMs, 2000);
});

test('open and overlapping approvals merge; unfinished tools close at turn end', () => {
  const state = replay([step(1, 0), call('a', 1000), event('approval/asked', 2000, { id: 'a' }),
    event('approval/asked', 3000, { id: 'b' }), event('approval/decided', 4000, { id: 'a' }), end(6000)]);
  assert.equal(state.timing.waitUserMs, 4000);
  assert.equal(state.timing.toolMs, 1000);
  assert.equal(Object.values(state.timing).reduce((sum, value) => sum + value, 0), 6000);
});

test('new turns reset all detection, token and timing state', () => {
  const dirty = replay([step(1, 1), call('a', 2), result('a', 3), call('b', 4), result('b', 5), endStep(1, 6),
    step(2, 7), message(2, 8, { inputTokens: 10, outputTokens: 5 }),
    call('c', 9, '{}', 'read', 2), result('c', 10, false, 2), endStep(2, 11), end(12)]);
  assert.equal(dirty.findings.length, 1);
  assert.equal(dirty.wastedTokens, 15);
  assert.equal(dirty.totalTokens, 15);
  const clean = reduceEvent(dirty, event('turn/start', 100, { turn: 2 }));
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.wastedTokens, 0);
  assert.equal(clean.totalTokens, 0);
  assert.deepEqual(clean.timing, { waitModelMs: 0, modelOutputMs: 0, toolMs: 0, waitUserMs: 0, otherMs: 0 });
  const next = reduceEvent(clean, event('tool/call', 101, { turn: 2, step: 1, callId: 'd', name: 'read', arguments: '{}' }));
  assert.deepEqual(next.findings, []);
});

test('no arguments, outputs, files or reasoning text enter serializable state', () => {
  const secret = 'sk-abc123secret';
  const state = replay([step(1, 1), message(1, 2, { inputTokens: 10, outputTokens: 5 }, [
    { type: 'reasoning-chunks', time0: 1, index: 0, dt: [], texts: [secret] }
  ]), call('a', 3, JSON.stringify({ token: secret })),
    event('tool/result', 4, { step: 1, message: { toolCallId: 'a', isError: true, content: secret }, error: { name: 'Failure', code: 'FAIL', reason: secret } })]);
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes('"arguments":'));
  assert.ok(!serialized.includes('"stream":'));
});

test('monitor batched refresh replay deeply equals incremental append', () => {
  const events = [event('turn/start', 0, { turn: 1 }), step(1, 1), message(1, 2, { inputTokens: 10, outputTokens: 5 }),
    call('a', 3), result('a', 4, true), call('b', 5), result('b', 6, true), call('c', 7), result('c', 8, true), endStep(1, 9), end(10)];
  let window: EventWindow = { entries: [], revision: 0, change: { kind: 'replace' } };
  let notify = () => {};
  const source = { getSnapshot: () => window, subscribe: (listener: () => void) => { notify = listener; return () => {}; } };
  const incremental = createMonitor(source);
  const off = incremental.subscribe(() => {});
  for (const input of events) {
    const entry = { event: input };
    window = { entries: [...window.entries, entry], revision: window.revision + 1, change: { kind: 'append', entries: [entry] } };
    notify();
  }
  const batch = createMonitor(source);
  assert.deepEqual(batch.getSnapshot(), incremental.getSnapshot());
  off();
});

test('monitor settlement replaces transient frames without changing token or timing results', () => {
  const entries = [event('turn/start', 0, { turn: 1 }), step(1, 1000)];
  const chunk = event('assistant/live-chunk', 3000, { turn: 1, step: 1, attemptId: 'a', chunk: { type: 'text-delta', index: 0, text: 'private' } });
  const settlement = message(1, 5000, { inputTokens: 10, outputTokens: 5 }, [
    { type: 'text-chunks', index: 0, time0: 3000, dt: [], texts: ['private'] }
  ]);
  let window: EventWindow = { entries: entries.map(event => ({ event })), revision: 0, change: { kind: 'replace' } };
  let notify = () => {};
  const source = { getSnapshot: () => window, subscribe: (listener: () => void) => { notify = listener; return () => {}; } };
  const monitor = createMonitor(source);
  const off = monitor.subscribe(() => {});
  window = { entries: [...window.entries, { event: chunk }], revision: 1, change: { kind: 'append', entries: [{ event: chunk }] } };
  notify();
  window = { entries: [...entries, settlement].map(event => ({ event })), revision: 2, change: { kind: 'settle-assistant' } };
  notify();
  assert.deepEqual(monitor.getSnapshot(), replay([...entries, settlement], initialState()));
  assert.equal(monitor.getSnapshot().timing.waitModelMs, 2000);
  assert.equal(monitor.getSnapshot().totalTokens, 15);
  off();
});

test('reduction never mutates a prior snapshot or the caller-owned event', () => {
  function freeze<T>(value: T): T {
    if (value && typeof value === 'object') {
      Object.freeze(value);
      for (const item of Object.values(value)) freeze(item);
    }
    return value;
  }
  const state = freeze(replay([step(1, 1), call('a', 2), result('a', 3, true), call('b', 4), result('b', 5, true)]));
  const input = freeze(call('c', 6));
  const before = JSON.stringify(state);
  const next = reduceEvent(state, input);
  assert.equal(JSON.stringify(state), before);
  assert.equal(next.findings[0].count, 3);
  assert.notStrictEqual(next, state);
});
