import React from 'react';
import { displayStatus, errorExcerpt, type DisplayInput, type PulseState } from './state.ts';
import type { Translation } from './locales.ts';

export interface PulseViewProps {
  state: PulseState;
  input: DisplayInput;
  partial: boolean;
  threshold: number;
  onThreshold: (value: number) => void;
  t: Translation;
}
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function PulseIcon() {
  return <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M2 17h7l4-9 6 17 4-8h7" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
export function PulseView({ state, input, partial, threshold, onThreshold, t }: PulseViewProps) {
  const status = displayStatus(state, input);
  const busy = input.running && input.connected && status !== 'waiting';
  const active = state.tools;
  const error = input.lastAgentError ? errorExcerpt(input.lastAgentError) : state.error;
  // Completed and stopped counters freeze at the final observed event.
  const endpoint = input.running && input.connected ? input.now : state.lastActivityAt;
  const elapsed = state.startedAt !== null && endpoint !== null ? duration(endpoint - state.startedAt) : '—';
  const since = state.lastActivityAt === null ? '—' : duration(input.now - state.lastActivityAt);
  return <section className="pulse" data-pulse-status={status} aria-label={t('title')}>
    <style>{styles}</style>
    <header className="pulse-heading"><div className="pulse-brand"><PulseIcon /><span>{t('marker')}</span></div>
      <span className={`pulse-live ${busy ? 'is-live' : ''}`}><i />{t(busy ? 'live' : 'history')}</span></header>
    <h1>{t('title')}</h1><p className="pulse-subtitle">{t('subtitle')}</p>
    <div className="pulse-status" role="status" aria-live="polite">
      <span className="pulse-eyebrow">{t('activity')}</span>
      <h2><span className={`pulse-status-dot ${busy ? 'is-live' : ''}`} />{t(status)}</h2>
      {input.connected && active.length > 0 && <ul className="pulse-tools">{active.map(tool => <li key={tool.id}>
        <span className="pulse-tool-name">{tool.name}</span><span>{duration((input.running ? input.now : state.lastActivityAt ?? input.now) - tool.startedAt)}</span>
      </li>)}</ul>}
      <div className="pulse-metrics"><div><span>{t('elapsed')}</span><strong>{elapsed}</strong></div>
        <div><span>{t('since')}</span><strong>{since}</strong></div>
        <div><span>{t('completed')}</span><strong>{state.completedTools}</strong></div></div>
    </div>
    {status === 'waiting' && <Notice title={t('attention')} body={t('attentionBody')} tone="warm" />}
    {status === 'quiet' && <Notice title={t('quietTitle')} body={t('quietBody')} tone="warm" />}
    {status === 'disconnected' && <Notice title={t('connectionTitle')} body={t('connectionBody')} tone="warm" />}
    {error && <details className="pulse-error"><summary>{t('errorTitle')}</summary><pre>{error}</pre></details>}
    <div className="pulse-section-heading"><h3>{t('recent')}</h3><span>{state.recent.length.toString().padStart(2, '0')}</span></div>
    {state.recent.length ? <ol className="pulse-timeline">{[...state.recent].reverse().map(item => <li key={item.id}>
      <span className={`pulse-mark ${item.outcome}`}>{item.outcome === 'ok' ? '✓' : item.outcome === 'error' ? '!' : '−'}</span>
      <div><strong>{item.kind === 'turn' ? t('turn') : item.name}</strong><span>{t(item.outcome)}{item.startedAt !== null ? ` · ${duration(item.at - item.startedAt)}` : ''}</span></div>
      <time title={new Date(item.at).toISOString()} dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
    </li>)}</ol> : <p className="pulse-empty">{t('empty')}</p>}
    <footer><label className="pulse-setting">{t('threshold')}<select aria-label={t('threshold')} value={threshold} onChange={event => onThreshold(Number(event.target.value))}>
      {[30, 60, 120, 300].map(value => <option key={value} value={value}>{value < 60 ? `${value} ${t('seconds')}` : `${value / 60} ${t('minutes')}`}</option>)}
    </select></label><p className="pulse-privacy">{t('privacy')}</p><p>{t('scope')}</p>{partial && <p>{t('partial')}</p>}<p>{t('boundary')}</p></footer>
  </section>;
}
function Notice({ title, body, tone }: { title: string; body: string; tone: string }) {
  return <aside className={`pulse-notice ${tone}`} role="status"><strong>{title}</strong><p>{body}</p></aside>;
}
const styles = `
.pulse{--pulse-green:light-dark(#287c62,#78c7a5);--pulse-soft:light-dark(rgba(40,124,98,.08),rgba(120,199,165,.08));--pulse-muted:var(--dsw-alias-label-secondary,light-dark(#747d79,#a6b0aa));--pulse-line:rgba(127,143,136,.18);box-sizing:border-box;padding:24px 22px 18px;width:100%;height:100%;overflow:auto;color:inherit;font-family:inherit;font-size:13px;line-height:1.6;container-type:inline-size}
.pulse *{box-sizing:border-box}.pulse h1,.pulse h2,.pulse h3,.pulse p{margin:0}.pulse-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}.pulse-brand{display:flex;align-items:center;gap:8px;color:var(--pulse-green);font-size:11px;letter-spacing:2px;font-weight:750}.pulse-live{font-size:9px;letter-spacing:1px;color:var(--pulse-muted);display:flex;align-items:center;gap:6px}.pulse-live i,.pulse-status-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor}.pulse-live.is-live{color:var(--pulse-green)}.pulse h1{font-size:26px;font-weight:650;letter-spacing:-.7px;line-height:1.3}.pulse-subtitle{color:var(--pulse-muted);margin-top:5px!important;margin-bottom:24px!important}.pulse-status{border:1px solid var(--pulse-line);border-radius:16px;padding:20px;background:var(--pulse-soft)}.pulse-eyebrow{font-size:10px;letter-spacing:1px;color:var(--pulse-muted)}.pulse h2{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:600;margin-top:10px}.pulse-status-dot{color:var(--pulse-green);width:7px;height:7px;flex-shrink:0}.pulse [data-pulse-status=error]{color:#bd5849}.pulse-metrics{display:grid;grid-template-columns:1fr 1fr;gap:18px 12px;padding-top:20px;margin-top:20px;border-top:1px solid var(--pulse-line)}.pulse-metrics div:last-child{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.pulse-metrics span{display:block;font-size:11px;color:var(--pulse-muted)}.pulse-metrics strong{display:block;margin-top:3px;font-size:22px;font-weight:550;font-variant-numeric:tabular-nums;letter-spacing:-.5px}.pulse-metrics div:last-child strong{font-size:15px;margin:0}.pulse-tools{padding:0;margin:16px 0 0;list-style:none;max-height:180px;overflow:auto}.pulse-tools li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;font-size:11px;color:var(--pulse-muted)}.pulse-tool-name{color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace}.pulse-notice{margin-top:14px;padding:14px 15px;border-radius:12px;border:1px solid rgba(181,130,45,.25);background:rgba(181,130,45,.07)}.pulse-notice strong{font-size:12px;color:#ab7522}.pulse-notice p{margin-top:5px;color:var(--pulse-muted);font-size:11px;line-height:1.8}.pulse-error{margin-top:14px;padding:12px;border-radius:10px;border:1px solid rgba(189,88,73,.25);color:#bd5849;font-size:12px}.pulse-error summary{cursor:pointer}.pulse-error pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:180px;overflow:auto}.pulse-section-heading{display:flex;justify-content:space-between;align-items:center;margin:26px 0 8px}.pulse h3{font-size:12px;font-weight:600}.pulse-section-heading>span{font-size:11px;color:var(--pulse-muted);font-variant-numeric:tabular-nums}.pulse-timeline{list-style:none;padding:0;margin:0}.pulse-timeline li{display:flex;align-items:flex-start;gap:12px;padding:13px 0;border-bottom:1px solid var(--pulse-line)}.pulse-mark{width:22px;height:22px;display:grid;place-items:center;flex-shrink:0;border-radius:50%;background:var(--pulse-soft);color:var(--pulse-green);font-size:11px}.pulse-mark.error{background:rgba(189,88,73,.09);color:#bd5849}.pulse-mark.cancelled{color:var(--pulse-muted)}.pulse-timeline li>div{min-width:0;flex:1}.pulse-timeline strong{display:block;font-size:12px;font-weight:550;overflow-wrap:anywhere}.pulse-timeline li>div>span{display:block;font-size:10px;color:var(--pulse-muted);margin-top:2px}.pulse-timeline time{color:var(--pulse-muted);font-size:10px;flex-shrink:0;margin-top:3px;font-variant-numeric:tabular-nums}.pulse-empty{padding:22px 0;color:var(--pulse-muted);font-size:12px}.pulse footer{margin-top:26px;border-top:1px solid var(--pulse-line);padding-top:16px}.pulse-setting{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--pulse-muted);margin-bottom:18px}.pulse select{font:inherit;color:inherit;border:1px solid var(--pulse-line);background:transparent;border-radius:7px;padding:5px 8px}.pulse option{color:CanvasText;background:Canvas}.pulse footer p{font-size:10px;color:var(--pulse-muted);line-height:1.8;margin-top:7px}.pulse .pulse-privacy{color:var(--pulse-green);font-weight:550}.pulse[data-pulse-status=quiet] .pulse-status-dot,.pulse[data-pulse-status=waiting] .pulse-status-dot{color:#b5822d}.pulse[data-pulse-status=error] .pulse-status-dot{color:#bd5849}.pulse[data-pulse-status=disconnected] .pulse-status-dot{color:var(--pulse-muted)}.pulse .is-live i,.pulse-status-dot.is-live{animation:pulse-breathe 2s ease-in-out infinite}@keyframes pulse-breathe{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.pulse .is-live i,.pulse-status-dot.is-live{animation:none}}@container(max-width:240px){.pulse-metrics{grid-template-columns:1fr}.pulse-metrics div:last-child{grid-column:auto}.pulse-heading{gap:4px}.pulse-live{letter-spacing:0}}
`;
