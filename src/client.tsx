import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-connection/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import { createMonitor } from './monitor.ts';
import { en, zh } from './locales.ts';
import { PulseView } from './view.tsx';
import { initialState } from './state.ts';

export const inject = ['slots', 'sidebarRightTabs', 'sessions', 'connection', 'locale', 'uiSession'];
const NS = 'dsh-pulse';
const SETTING = 'dsh-pulse.quiet-seconds.v1';
const DEFAULT_THRESHOLD = 120;
const CHOICES = [30, 60, 120, 300];
const emptyState = initialState();
const emptySubscribe = () => () => {};
const emptySnapshot = () => emptyState;
function readThreshold(): number {
  try { const value = Number(localStorage.getItem(SETTING)); return CHOICES.includes(value) ? value : DEFAULT_THRESHOLD; }
  catch { return DEFAULT_THRESHOLD; }
}

export function apply(ctx: Context & { connection: ConnectionHandle }) {
  ctx.effect(() => ctx.locale.register(NS, 'en', en));
  ctx.effect(() => ctx.locale.register(NS, 'zh', zh));
  const t = ctx.locale.bind(NS);

  function Body(props: PropsRuntime<'sidebar.right.pane.tab'>) {
    const session = props.useSession(value => value);
    const tab = props.useTabInfo();
    const interaction = props.useSessionStatus(values => values.get(props.sessionId)?.pendingInteraction);
    const connection = useSyncExternalStore(ctx.connection.state.subscribe.bind(ctx.connection.state), ctx.connection.state.getSnapshot.bind(ctx.connection.state));
    const locale = useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), ctx.locale.getLocale.bind(ctx.locale));
    void locale; // Locale changes refresh both copy and guide labels.
    const binding = ctx.sessions.binding(props.sessionId);
    const monitor = useMemo(() => binding ? createMonitor(binding.eventSource) : undefined, [binding]);
    const state = useSyncExternalStore(monitor?.subscribe ?? emptySubscribe, monitor?.getSnapshot ?? emptySnapshot);
    const [now, setNow] = useState(Date.now);
    const [threshold, setThreshold] = useState(readThreshold);
    useEffect(() => {
      if (!tab.tab.visible) return;
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }, [tab.tab.visible]);
    if (!monitor) return <p>{t('loading')}</p>;
    return <PulseView state={state} input={{ connected: connection === 'connected', openState: session.openState,
        running: session.running, waiting: !!interaction, now, quietSeconds: threshold,
        lastAgentError: session.lastAgentError ?? session.openError?.message ?? null }}
        partial={session.hasMore} threshold={threshold} onThreshold={value => {
          setThreshold(value);
          try { localStorage.setItem(SETTING, String(value)); } catch { /* In-memory preference still works. */ }
        }} t={t} />;
  }

  ctx.effect(() => ctx.sidebarRightTabs.register({ id: NS, kind: NS, title: () => t('title'),
    guide: [{ id: NS, order: 35, title: () => `Pulse · ${t('title')}`, description: () => t('subtitle') }] }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: NS,
  }, Body)));
}
