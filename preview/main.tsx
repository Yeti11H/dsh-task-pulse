import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PulseView } from '../src/view.tsx';
import { initialState, reduceEvent } from '../src/state.ts';
import { zh, type Translation } from '../src/locales.ts';

const t: Translation = key => zh[key as keyof typeof zh] ?? key;
function Demo() {
  const [mode, setMode] = useState('tools');
  const [now, setNow] = useState(Date.now);
  const [threshold, setThreshold] = useState(120);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const start = now - 62000;
  const events: unknown[] = [
    { type: 'turn/start', time: start, data: { turn: 1 } },
    { type: 'tool/call', time: start + 1000, data: { callId: 'read', name: 'read_file' } },
    { type: 'tool/result', time: start + 3000, data: { message: { toolCallId: 'read' } } },
    { type: 'tool/call', time: start + 4000, data: { callId: 'edit', name: 'edit_file' } },
    { type: 'tool/result', time: start + 19000, data: { message: { toolCallId: 'edit' } } },
    { type: 'tool/call', time: start + 20000, data: { callId: 'test', name: 'run_tests' } },
  ];
  if (mode === 'complete') events.push({ type: 'tool/result', time: now - 1000, data: { message: { toolCallId: 'test' } } }, { type: 'turn/end', time: now, data: { reason: { kind: 'completed' } } });
  if (mode === 'error') events.push({ type: 'turn/end', time: now, data: { reason: { kind: 'error', error: { message: 'Connection timeout: the test service did not respond.' } } } });
  const state = events.reduce(reduceEvent, initialState());
  return <><nav aria-label="预览场景">{(['tools', 'waiting', 'quiet', 'disconnected', 'complete', 'error'] as const).map((value, index) => <button key={value} aria-pressed={value === mode} onClick={() => setMode(value)}>{['工具执行', '等待用户', '静默提醒', '连接断开', '任务完成', '发生错误'][index]}</button>)}</nav>
    <p className="demo-label">交互预览 · 使用模拟事件，不代表真实任务</p>
    <PulseView state={state} input={{ connected: mode !== 'disconnected', openState: 'open', running: !['complete', 'error'].includes(mode), waiting: mode === 'waiting', now: mode === 'quiet' ? now + 180000 : now, quietSeconds: threshold }} partial={false} threshold={threshold} onThreshold={setThreshold} t={t} /></>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
