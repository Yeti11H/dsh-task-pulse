import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import { bridgeUrl } from './github.ts';

/** Optional Host adapter. No token means no tools or additional network work. */
export const name = 'dsh-task-pulse';
export const inject = ['tools'];
export function apply(ctx: Context): void {
  const token = process.env.PULSE_BRIDGE_TOKEN;
  if (!token) return;
  const origin = bridgeUrl(process.env.PULSE_BRIDGE_URL ?? 'http://127.0.0.1:43127');
  ctx.effect(() => ctx.tools.register({
    name: 'pulse_github',
    description: 'Read the GitHub repository snapshot explicitly selected in the Pulse UI, or propose a replacement of an existing UTF-8 file. action=context lists files and context id; action=read needs contextId and path; action=propose needs contextId, path, exact expectedSha from read and full updated content. Does not publish or run tests.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['context', 'read', 'propose'] },
      contextId: { type: 'string' }, path: { type: 'string' }, expectedSha: { type: 'string' }, content: { type: 'string' } }, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(input, exec) {
      if (!exec.agent) throw new Error('pulse-agent-context-required');
      const args = input as Record<string, unknown>;
      if (!['context', 'read', 'propose'].includes(String(args.action))) throw new Error('unsupported-agent-action');
      const response = await fetch(`${origin}/api/agent/${encodeURIComponent(exec.agent.session.id)}/action`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args), signal: exec.signal, redirect: 'error' });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error ?? `pulse-bridge-error-${response.status}`);
      }
      return JSON.stringify(await response.json());
    },
  }));
}
