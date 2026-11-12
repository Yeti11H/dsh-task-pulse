import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../src/index.ts';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

test('optional Host tool uses caller session and can only read or propose', async () => {
  const saved = process.env.PULSE_BRIDGE_TOKEN;
  const savedUrl = process.env.PULSE_BRIDGE_URL;
  const fetch = globalThis.fetch;
  const tools: ToolDefinition[] = [];
  const ctx = { effect: (effect: () => void) => effect(), tools: { register: (value: ToolDefinition) => { tools.push(value); return () => {}; } } };
  try {
    delete process.env.PULSE_BRIDGE_TOKEN;
    apply(ctx as any); assert.equal(tools.length, 0);
    process.env.PULSE_BRIDGE_TOKEN = 'test-pair';
    process.env.PULSE_BRIDGE_URL = 'http://127.0.0.1:43127';
    apply(ctx as any); const tool = tools[0]; assert.equal(tool.name, 'pulse_github');
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'http://127.0.0.1:43127/api/agent/real-session/action');
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-pair');
      assert.deepEqual(JSON.parse(String(options?.body)), { action: 'context' });
      return new Response(JSON.stringify({ repo: 'alice/demo' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const exec = { agent: { session: { id: 'real-session' } }, signal: new AbortController().signal };
    assert.equal(await tool.execute({ action: 'context' }, exec as any), '{"repo":"alice/demo"}');
    await assert.rejects(tool.execute({ action: 'publish' }, exec as any), /unsupported-agent-action/);
    assert.equal(calls, 1);
    await assert.rejects(tool.execute({ action: 'context' }, { signal: exec.signal } as any), /pulse-agent-context-required/);
  } finally {
    globalThis.fetch = fetch;
    if (saved === undefined) delete process.env.PULSE_BRIDGE_TOKEN; else process.env.PULSE_BRIDGE_TOKEN = saved;
    if (savedUrl === undefined) delete process.env.PULSE_BRIDGE_URL; else process.env.PULSE_BRIDGE_URL = savedUrl;
  }
});
