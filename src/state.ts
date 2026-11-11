/** Pure, bounded state. It depends on no DSH, browser, or model package. */
export interface Activity {
  id: string;
  kind: 'tool' | 'turn';
  name: string;
  at: number;
  startedAt: number | null;
  outcome: 'ok' | 'error' | 'cancelled';
}
export interface ActiveTool { id: string; name: string; startedAt: number }
export interface PulseState {
  startedAt: number | null;
  lastActivityAt: number | null;
  phase: 'idle' | 'preparing' | 'model' | 'output' | 'tools' | 'complete' | 'error' | 'cancelled';
  turn: number | null;
  step: number | null;
  tools: ActiveTool[];
  approvals: string[];
  recent: Activity[];
  completedTools: number;
  error: string | null;
}
export const RECENT_LIMIT = 12;
export const ACTIVE_LIMIT = 100;
export function initialState(): PulseState {
  return { startedAt: null, lastActivityAt: null, phase: 'idle', turn: null, step: null,
    tools: [], approvals: [], recent: [], completedTools: 0, error: null };
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
/** Keep error excerpts bounded and strip common credential patterns. This is
 * not a general data-loss-prevention filter; avoid collecting arguments at all. */
export function errorExcerpt(value: string): string {
  return value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 400);
}
function addRecent(state: PulseState, activity: Activity): Activity[] {
  return [...state.recent, activity].slice(-RECENT_LIMIT);
}
/** Accept public event envelopes defensively so unknown future event kinds
 * leave the visible state unchanged instead of breaking the host interface. */
export function reduceEvent(state: PulseState, input: unknown): PulseState {
  const event = record(input);
  const type = text(event.type);
  const data = record(event.data);
  const at = finite(event.time);
  if (at === null) return state;
  const lastActivityAt = Math.max(at, state.lastActivityAt ?? at);
  const touched = { ...state, lastActivityAt };
  switch (type) {
    case 'turn/start':
      return { ...initialState(), recent: state.recent, startedAt: at, lastActivityAt,
        phase: 'preparing', turn: finite(data.turn) };
    case 'step/start':
      return { ...touched, phase: 'model', step: finite(data.step), error: null };
    case 'assistant/live-chunk': {
      const chunk = record(data.chunk);
      // Usage-only frames do not establish that response text is arriving.
      const kind = text(chunk.type);
      if (!kind.includes('delta') && kind !== 'text' && kind !== 'reasoning') return state;
      return { ...touched, phase: state.tools.length ? 'tools' : 'output' };
    }
    case 'assistant/message':
      return { ...touched, phase: state.tools.length ? 'tools' : 'preparing' };
    case 'tool/call': {
      const id = text(data.callId);
      if (!id || state.tools.some(tool => tool.id === id)) return state;
      return { ...touched, phase: 'tools', tools: [...state.tools,
        { id, name: text(data.name, 'tool').slice(0, 100), startedAt: at }].slice(-ACTIVE_LIMIT) };
    }
    case 'tool/result': {
      const message = record(data.message);
      const id = text(message.toolCallId);
      const tool = state.tools.find(item => item.id === id);
      const tools = state.tools.filter(item => item.id !== id);
      const failure = record(data.error);
      const isError = message.isError === true;
      // Never copy tool result bodies: they can contain files and credentials.
      const error = isError ? errorExcerpt([text(failure.name, 'ToolError'), text(failure.code)].filter(Boolean).join(': ')) : state.error;
      return { ...touched, tools, phase: tools.length ? 'tools' : 'preparing', error,
        completedTools: state.completedTools + (isError ? 0 : 1),
        recent: addRecent(state, { id: `tool-${id}-${event.seq ?? at}`, kind: 'tool',
          name: tool?.name ?? text(message.name, 'tool'), at,
          startedAt: tool?.startedAt ?? null, outcome: isError ? 'error' : 'ok' }) };
    }
    case 'approval/asked': {
      const id = text(data.id);
      return !id || state.approvals.includes(id) ? state :
        { ...touched, approvals: [...state.approvals, id].slice(-ACTIVE_LIMIT) };
    }
    case 'approval/decided':
      return { ...touched, approvals: state.approvals.filter(id => id !== data.id) };
    case 'step/end':
      return { ...touched, phase: state.tools.length ? 'tools' : 'preparing' };
    case 'turn/end': {
      const reason = record(data.reason);
      const kind = text(reason.kind);
      const outcome = kind === 'completed' ? 'ok' : kind === 'aborted' ? 'cancelled' : 'error';
      const failure = record(reason.error);
      const error = outcome === 'error' ? errorExcerpt(text(failure.message, kind || 'Unknown turn outcome')) : state.error;
      return { ...touched, phase: outcome === 'ok' ? 'complete' : outcome, tools: [], approvals: [], error,
        recent: addRecent(state, { id: `turn-${data.turn}-${event.seq}`, kind: 'turn', name: 'turn',
          at, startedAt: state.startedAt, outcome }) };
    }
    default:
      return state;
  }
}
export type DisplayStatus = 'disconnected' | 'loading' | 'unavailable' | 'waiting' | 'quiet' |
  'model' | 'output' | 'tools' | 'preparing' | 'complete' | 'error' | 'cancelled' | 'idle';
export interface DisplayInput {
  connected: boolean;
  openState: string;
  running: boolean;
  waiting: boolean;
  now: number;
  quietSeconds: number;
  lastAgentError?: string | null;
}
export function displayStatus(state: PulseState, input: DisplayInput): DisplayStatus {
  if (!input.connected) return 'disconnected';
  if (input.openState === 'error') return 'unavailable';
  if (input.openState !== 'open') return 'loading';
  if (input.waiting || (input.running && state.approvals.length > 0)) return 'waiting';
  if (!input.running) {
    if (input.lastAgentError || state.phase === 'error') return 'error';
    if (state.phase === 'complete' || state.phase === 'cancelled') return state.phase;
    // A resumed live turn can end outside this Client's observed window.
    return 'idle';
  }
  if (state.lastActivityAt !== null && input.now - state.lastActivityAt >= input.quietSeconds * 1000) return 'quiet';
  if (state.tools.length) return 'tools';
  if (state.phase === 'output' || state.phase === 'model') return state.phase;
  return 'preparing';
}
