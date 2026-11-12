/** Pure event analysis. Never retain arguments, result bodies or stream content. */
export interface Finding {
  id: string;
  rule: 'R1' | 'R2' | 'R3';
  toolName: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
  wastedTokens: number;
  estimated: boolean;
}
export interface TurnTiming {
  waitModelMs: number;
  modelOutputMs: number;
  toolMs: number;
  waitUserMs: number;
  otherMs: number;
}
export interface WasteSummary {
  findings: Finding[];
  wastedTokens: number;
  totalTokens: number;
  timing: TurnTiming;
}
interface Usage { inputTokens: number; outputTokens: number; totalTokens: number }
interface Step {
  id: number;
  startedAt: number;
  firstOutputAt: number | null;
  settledAt: number | null;
  endedAt: number | null;
  usage: Usage | null;
  attempts: number;
  firstAttemptAt: number | null;
  attemptTokens: number;
}
interface Call {
  id: string;
  step: number | null;
  toolName: string;
  argsHash: number | null;
  startedAt: number;
  endedAt: number | null;
  hits: string[];
}
interface Counter { key: string; count: number; firstAt: number }
interface Approval { id: string; startedAt: number; endedAt: number | null }
/** Numeric metadata and tool identities only; reset at every turn/start. */
export interface WasteState {
  turn: number | null;
  startedAt: number | null;
  lastAt: number | null;
  endedAt: number | null;
  step: number | null;
  steps: Step[];
  calls: Call[];
  repeats: Counter[];
  failures: Counter[];
  approvals: Approval[];
  findings: Finding[];
}
export const FINDING_LIMIT = 5;
export function initialWaste(): WasteState {
  return { turn: null, startedAt: null, lastAt: null, endedAt: null, step: null,
    steps: [], calls: [], repeats: [], failures: [], approvals: [], findings: [] };
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function count(value: unknown): number | null {
  const n = finite(value);
  return n !== null && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function usage(value: unknown): Usage | null {
  const data = record(value);
  const inputTokens = count(data.inputTokens);
  const outputTokens = count(data.outputTokens);
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens: count(data.totalTokens) ??
    inputTokens + outputTokens + (count(data.cacheReadTokens) ?? 0) + (count(data.cacheWriteTokens) ?? 0) };
}
/** Standard 32-bit FNV-1a over UTF-8 bytes of the exact, unparsed JSON string.
 * This is a comparison fingerprint, not encryption or collision resistance. */
export function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}
function isOutput(value: unknown): boolean {
  const chunk = record(value);
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return typeof chunk.text === 'string' && chunk.text !== '';
  return chunk.type === 'tool-call-delta' &&
    (typeof chunk.name === 'string' || (typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta !== ''));
}
/** Read compact DSH records transiently. dt contains gaps BETWEEN members;
 * member zero is at time0. Only timestamps and aggregate usage leave this reader. */
function streamMetadata(value: unknown): { firstAt: number | null; usage: Usage | null } {
  let firstAt: number | null = null;
  let reported: Usage | null = null;
  for (const valueRecord of Array.isArray(value) ? value : []) {
    const item = record(valueRecord);
    let time: number | null = null;
    if (item.type === 'chunk') {
      if (isOutput(item.chunk)) time = finite(item.time);
      const chunk = record(item.chunk);
      if (chunk.type === 'usage') reported = usage(chunk.usage) ?? reported;
    } else if (item.type === 'text-chunks' || item.type === 'reasoning-chunks' || item.type === 'tool-call-chunks') {
      const fragments = item.type === 'tool-call-chunks' ? item.args : item.texts;
      const gaps = Array.isArray(item.dt) ? item.dt : [];
      let memberAt = finite(item.time0);
      if (Array.isArray(fragments)) for (let n = 0; n < fragments.length && memberAt !== null; n++) {
        if (n > 0) {
          const gap = finite(gaps[n - 1]);
          if (gap === null || gap < 0) break;
          memberAt += gap;
        }
        if ((item.type === 'tool-call-chunks' && typeof item.name === 'string') ||
          (typeof fragments[n] === 'string' && fragments[n] !== '')) { time = memberAt; break; }
      }
    }
    if (time !== null) firstAt = firstAt === null ? time : Math.min(firstAt, time);
  }
  return { firstAt, usage: reported };
}
function finding(state: WasteState, id: string, rule: Finding['rule'], toolName: string | null,
  increment: number, firstAt: number, lastAt: number): WasteState {
  const existing = state.findings.find(item => item.id === id);
  if (!existing && state.findings.length === FINDING_LIMIT) return state;
  const next: Finding = existing ? { ...existing, count: existing.count + increment, lastAt } :
    { id, rule, toolName, count: increment, firstAt, lastAt, wastedTokens: 0, estimated: false };
  return { ...state, findings: existing ? state.findings.map(item => item.id === id ? next : item) : [...state.findings, next] };
}
function replaceCounter(items: Counter[], next: Counter): Counter[] {
  return [...items.filter(item => item.key !== next.key), next];
}
export function reduceWaste(state: WasteState, input: unknown): WasteState {
  const event = record(input);
  const data = record(event.data);
  const at = finite(event.time);
  if (at === null) return state;
  if (event.type === 'turn/start') return { ...initialWaste(), turn: finite(data.turn), startedAt: at, lastAt: at };
  if (state.startedAt === null || state.endedAt !== null ||
    (finite(data.turn) !== null && finite(data.turn) !== state.turn)) return state;
  const stepId = finite(data.step) ?? state.step;
  const activeStep = state.steps.find(item => item.id === stepId);
  let next = state;
  switch (event.type) {
    case 'step/start':
      if (stepId === null || activeStep) return state;
      next = { ...state, step: stepId, steps: [...state.steps, { id: stepId, startedAt: at,
        firstOutputAt: null, settledAt: null, endedAt: null, usage: null, attempts: 0, firstAttemptAt: null, attemptTokens: 0 }] };
      break;
    case 'assistant/live-chunk':
    case 'assistant/message':
    case 'assistant/attempt': {
      if (!activeStep) return state;
      const live = event.type === 'assistant/live-chunk';
      if (live && !isOutput(data.chunk)) return state;
      const meta = live ? { firstAt: at, usage: null } : streamMetadata(data.stream);
      const firstOutputAt = meta.firstAt === null ? activeStep.firstOutputAt :
        Math.min(activeStep.firstOutputAt ?? meta.firstAt, Math.max(activeStep.startedAt, Math.min(at, meta.firstAt)));
      const attempt = event.type === 'assistant/attempt';
      const updated = { ...activeStep, firstOutputAt,
        ...(event.type === 'assistant/message' ? { settledAt: at, usage: usage(data.usage) } : {}),
        ...(attempt ? { attempts: activeStep.attempts + 1, firstAttemptAt: activeStep.firstAttemptAt ?? at,
          attemptTokens: activeStep.attemptTokens + (meta.usage?.totalTokens ?? 0) } : {}) };
      next = { ...state, steps: state.steps.map(item => item.id === stepId ? updated : item) };
      if (attempt && updated.attempts >= 2) next = finding(next, 'R3:model', 'R3', null,
        updated.attempts === 2 ? 2 : 1, updated.firstAttemptAt!, at);
      break;
    }
    case 'tool/call': {
      if (typeof data.callId !== 'string' || typeof data.name !== 'string' ||
        state.calls.some(item => item.id === data.callId && item.step === stepId)) return state;
      const argsHash = typeof data.arguments === 'string' ? fnv1a(data.arguments) : null;
      const hits: string[] = [];
      if (argsHash !== null) {
        const key = JSON.stringify([data.name, argsHash]);
        const previous = state.repeats.find(item => item.key === key);
        const counter = { key, count: (previous?.count ?? 0) + 1, firstAt: previous?.firstAt ?? at };
        next = { ...state, repeats: replaceCounter(state.repeats, counter) };
        if (counter.count >= 3) {
          const id = `R1:${key}`;
          hits.push(id);
          next = finding(next, id, 'R1', data.name, counter.count === 3 ? 3 : 1, counter.firstAt, at);
        }
      }
      next = { ...next, calls: [...state.calls, { id: data.callId, step: stepId, toolName: data.name,
        argsHash, startedAt: at, endedAt: null, hits }] };
      break;
    }
    case 'tool/result': {
      const message = record(data.message);
      const call = state.calls.find(item => item.id === message.toolCallId && item.step === stepId && item.endedAt === null);
      if (!call) return state;
      const previous = state.failures.find(item => item.key === call.toolName);
      const failed = message.isError === true;
      const counter = { key: call.toolName, count: failed ? (previous?.count ?? 0) + 1 : 0,
        firstAt: failed && previous?.count ? previous.firstAt : at };
      let updated = { ...call, endedAt: Math.max(call.startedAt, at) };
      next = { ...state, failures: replaceCounter(state.failures, counter) };
      if (counter.count >= 3) {
        const id = `R2:${call.toolName}`;
        updated = { ...updated, hits: [...call.hits, id] };
        next = finding(next, id, 'R2', call.toolName, counter.count === 3 ? 3 : 1, counter.firstAt, at);
      }
      next = { ...next, calls: state.calls.map(item => item === call ? updated : item) };
      break;
    }
    case 'approval/asked':
      if (typeof data.id !== 'string' || state.approvals.some(item => item.id === data.id)) return state;
      next = { ...state, approvals: [...state.approvals, { id: data.id, startedAt: at, endedAt: null }] };
      break;
    case 'approval/decided':
      next = { ...state, approvals: state.approvals.map(item => item.id === data.id && item.endedAt === null ?
        { ...item, endedAt: Math.max(item.startedAt, at) } : item) };
      break;
    case 'step/end':
      if (!activeStep) return state;
      next = { ...state, steps: state.steps.map(item => item.id === stepId ? { ...item, endedAt: at } : item) };
      break;
    case 'turn/end':
      next = { ...state, endedAt: Math.max(state.lastAt ?? at, at) };
      break;
    default:
      return state;
  }
  return { ...next, lastAt: Math.max(state.lastAt ?? at, at) };
}
type Interval = readonly [number, number];
function unionDuration(intervals: Interval[], start: number, end: number): number {
  const sorted = intervals.map(([a, b]) => [Math.max(start, a), Math.min(end, b)] as const)
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let coveredUntil = start;
  for (const [a, b] of sorted) {
    total += Math.max(0, b - Math.max(a, coveredUntil));
    coveredUntil = Math.max(coveredUntil, b);
  }
  return total;
}
/** Disjoint wall-clock buckets: user wait > tools > model output > model wait.
 * The priority handles concurrent or partial histories without double counting.
 * An active turn is measured only through its latest accepted event timestamp. */
function turnTiming(state: WasteState): TurnTiming {
  const timing: TurnTiming = { waitModelMs: 0, modelOutputMs: 0, toolMs: 0, waitUserMs: 0, otherMs: 0 };
  if (state.startedAt === null) return timing;
  const start = state.startedAt;
  const end = Math.max(start, state.endedAt ?? state.lastAt ?? start);
  const intervals: Interval[] = state.approvals.map(item => [item.startedAt, item.endedAt ?? end]);
  let allocated = timing.waitUserMs = unionDuration(intervals, start, end);
  intervals.push(...state.calls.map((item): Interval => [item.startedAt, item.endedAt ?? end]));
  const withTools = unionDuration(intervals, start, end);
  timing.toolMs = withTools - allocated;
  allocated = withTools;
  for (const step of state.steps) if (step.firstOutputAt !== null)
    intervals.push([step.firstOutputAt, step.settledAt ?? step.endedAt ?? end]);
  const withOutput = unionDuration(intervals, start, end);
  timing.modelOutputMs = withOutput - allocated;
  allocated = withOutput;
  for (const step of state.steps) intervals.push([step.startedAt, step.firstOutputAt ?? step.settledAt ?? step.endedAt ?? end]);
  const withModelWait = unionDuration(intervals, start, end);
  timing.waitModelMs = withModelWait - allocated;
  timing.otherMs = end - start - withModelWait;
  return timing;
}
/** Heuristic, never proven waste: ONLY threshold-reaching/subsequent calls hit.
 * Settle attribution at step/end (or turn/end), require at least one tool and
 * every requested tool to hit R1/R2. No retroactive marking of the first two.
 * DSH inputTokens is ALREADY uncached; budget = inputTokens + outputTokens.
 * Missing usage contributes zero with estimated:false. Cache/reasoning fields
 * are never subtracted/added again. R3 alone has no attributable tool-step cost.
 * Split each budget once between its distinct matching findings, stable id order;
 * suppressed findings still contribute to the turn total. See docs/accuracy.md. */
export function summarizeWaste(state: WasteState): WasteSummary {
  const findings = state.findings.map(item => ({ ...item, wastedTokens: 0, estimated: false }));
  let wastedTokens = 0;
  let totalTokens = 0;
  for (const step of state.steps) {
    totalTokens += (step.usage?.totalTokens ?? 0) + step.attemptTokens;
    const calls = state.calls.filter(item => item.step === step.id);
    if ((step.endedAt === null && state.endedAt === null) || !calls.length || calls.some(item => !item.hits.length) || !step.usage) continue;
    const budget = step.usage.inputTokens + step.usage.outputTokens;
    wastedTokens += budget;
    const ids = [...new Set(calls.flatMap(item => item.hits))].sort();
    // Include hidden IDs in the divisor so the cap cannot inflate visible shares.
    for (let n = 0; n < ids.length; n++) {
      const item = findings.find(finding => finding.id === ids[n]);
      if (item) {
        item.wastedTokens += Math.floor(budget / ids.length) + (n < budget % ids.length ? 1 : 0);
        item.estimated = true;
      }
    }
  }
  return { findings, wastedTokens, totalTokens, timing: turnTiming(state) };
}
