import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWorkbenchApi, diffLines, fileUrl, matchingAnnotations, type Repository, type RepoContext, type SourceFile,
  type Draft, type Checks, type Page, type Entry, type WorkbenchApi } from './github.ts';
import type { Translation } from './locales.ts';

export interface GithubViewProps { sessionId: string; t: Translation; onAsk?: (text: string) => Promise<void>; testApi?: WorkbenchApi }
/** Source and pairing material live only in this mounted view, outside PulseState. */
export function GithubView({ sessionId, t, onAsk, testApi }: GithubViewProps) {
  const [address, setAddress] = useState('http://127.0.0.1:43127');
  const [token, setToken] = useState('');
  const [api, setApi] = useState<WorkbenchApi | null>(() => testApi ?? null);
  const [login, setLogin] = useState(testApi ? 'demo' : '');
  const [repos, setRepos] = useState<Repository[]>([]);
  const [page, setPage] = useState(1), [more, setMore] = useState(false);
  const [repo, setRepo] = useState(''), [branch, setBranch] = useState('');
  const [context, setContext] = useState<RepoContext | null>(null);
  const [source, setSource] = useState<SourceFile | null>(null), [editor, setEditor] = useState('');
  const [line, setLine] = useState(1), [side, setSide] = useState<'base' | 'draft'>('base');
  const [draft, setDraft] = useState<Draft | null>(null), [checks, setChecks] = useState<Checks | null>(null);
  const [title, setTitle] = useState(''), [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const viewer = useRef<HTMLDivElement>(null), generation = useRef(0), controller = useRef(new AbortController());
  const latestContext = useRef(context); latestContext.current = context;
  const latestApi = useRef(api); latestApi.current = api;
  const sourceRequest = useRef(0);
  useEffect(() => () => {
    generation.current++; controller.current.abort();
    const id = latestContext.current?.id;
    if (id && latestApi.current) void latestApi.current(`/contexts/${id}/close`, {}).catch(() => {});
  }, []);
  useEffect(() => {
    viewer.current?.querySelector('[data-selected=true]')?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [source, line, side]);
  async function action(run: () => Promise<void>) {
    if (busy) return;
    const current = generation.current; setBusy(true); setError('');
    try { await run(); } catch (e) { if (current === generation.current && !controller.current.signal.aborted) setError(e instanceof Error ? e.message : 'request-failed'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const signal = () => controller.current.signal;
  async function loadRepos(client: WorkbenchApi, n = 1) {
    const result = await client<Page<Repository>>(`/repos?page=${n}`, undefined, signal());
    setRepos(previous => n === 1 ? result.items : [...previous, ...result.items]); setPage(n); setMore(result.more);
  }
  useEffect(() => { if (testApi) void action(() => loadRepos(testApi)); }, []);
  async function refresh(client = api, selected = context) {
    if (!client || !selected) return;
    const changes = await client<Draft>(`/contexts/${selected.id}/changes`, undefined, signal()); setDraft(changes);
    try { setChecks(await client<Checks>(`/contexts/${selected.id}/checks`, undefined, signal())); }
    catch (e) { setChecks(null); throw e; }
  }
  async function openFile(path: string, target = 1, targetSide: 'base' | 'draft' = 'base') {
    if (!api || !context) return;
    const request = ++sourceRequest.current;
    const file = await api<SourceFile>(`/contexts/${context.id}/file?path=${encodeURIComponent(path)}`, undefined, signal());
    if (request !== sourceRequest.current) return;
    setSource(file); setEditor(draft?.changes.find(item => item.path === path)?.content ?? file.content); setLine(target); setSide(targetSide);
  }
  function disconnect() {
    const id = context?.id;
    if (id && api) void api(`/contexts/${id}/close`, {}).catch(() => {});
    controller.current.abort(); controller.current = new AbortController(); generation.current++;
    setApi(null); setToken(''); setContext(null); setSource(null); setDraft(null); setChecks(null); setRepos([]); setLogin(''); setBusy(false); setError(''); setEditor('');
  }
  const selectedChange = draft?.changes.find(item => item.path === source?.path);
  const displayed = side === 'draft' && selectedChange ? selectedChange.content : source?.content ?? '';
  const sourceLines = useMemo(() => displayed.split('\n'), [displayed]);
  const annotations = checks && context ? matchingAnnotations(checks.annotations, context.baseSha) : [];
  return <section className="pulse-github" aria-label={t('ghTitle')}>
    <style>{styles}</style>
    <header><div><span className="gh-kicker">PULSE / GITHUB</span><h2>{t('ghTitle')}</h2></div>{api && <button onClick={disconnect}>{t('ghDisconnect')}</button>}</header>
    <p className="gh-muted">{t('ghIntro')}</p>
    {!api ? <form onSubmit={event => { event.preventDefault(); void action(async () => {
      const client = createWorkbenchApi(address, token);
      const account = await client<{ login: string }>('/account', undefined, signal());
      await loadRepos(client); setLogin(account.login); setApi(() => client); setToken('');
    }); }}>
      <label>{t('ghAddress')}<input value={address} onChange={event => setAddress(event.target.value)} autoComplete="off" /></label>
      <label>{t('ghPairToken')}<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" /></label>
      <button disabled={busy || !token} className="gh-primary">{t('ghConnect')}</button>
      <details><summary>{t('ghSetup')}</summary><p>{t('ghLoginHelp')}</p><code>gh auth login --web --hostname github.com</code><p>{t('ghPairHelp')}</p></details>
    </form> : <>
      <div className="gh-account"><span>● {login}</span><span>{t('ghCliAuth')}</span></div>
      <details open={!context} className="gh-card"><summary>{context ? `${context.repo} · ${context.branch}` : t('ghSelectRepo')}</summary>
        <label>{t('ghRepository')}<select aria-label={t('ghRepository')} value={repo} disabled={busy} onChange={event => {
          const value = event.target.value; setRepo(value); setBranch(repos.find(item => item.name === value)?.defaultBranch ?? '');
        }}><option value="">{t('ghSelectRepo')}</option>{repos.map(item => <option key={item.name} value={item.name}>{item.name}{item.writable ? '' : ` · ${t('ghReadOnly')}`}</option>)}</select></label>
        {more && <button disabled={busy} onClick={() => void action(() => loadRepos(api, page + 1))}>{t('ghMore')}</button>}
        <label>{t('ghBranch')}<input value={branch} onChange={event => setBranch(event.target.value)} /></label>
        <button className="gh-primary" disabled={busy || !repo || !branch} onClick={() => void action(async () => {
          sourceRequest.current++; setSource(null); setDraft(null); setChecks(null);
          const value = await api<RepoContext>('/contexts', { sessionId, repo, branch }, signal());
          setContext(value); setTitle(`Update ${value.repo.split('/')[1]}`); await refresh(api, value);
        })}>{t('ghOpenRepo')}</button>
      </details>
      {context && <>
        <div className="gh-snapshot"><span>{t('ghSnapshot')} <code>{context.baseSha.slice(0, 10)}</code></span><a href={`https://github.com/${context.repo}/tree/${context.baseSha}`} target="_blank" rel="noreferrer">GitHub ↗</a></div>
        {context.truncated && <p className="gh-warning">{t('ghTruncated')}</p>}
        <details open className="gh-card"><summary>{t('ghFiles')} <span>{context.entries.filter(item => item.type === 'blob').length}</span></summary>
          <input aria-label={t('ghFilter')} placeholder={t('ghFilter')} value={filter} onChange={event => setFilter(event.target.value)} />
          <div className="gh-tree"><FileTree entries={context.entries.filter(item => item.type === 'blob' && item.path.toLowerCase().includes(filter.toLowerCase()))} selected={source?.path} disabled={busy} onOpen={path => void action(() => openFile(path))} /></div>
        </details>
        <details open className="gh-card"><summary>{t('ghEvidence')} <span>{annotations.length}</span></summary>
          <p className="gh-muted">{t('ghEvidenceScope')}</p>
          <button disabled={busy} onClick={() => void action(() => refresh())}>{t('ghRefresh')}</button>
          {checks ? <p className="gh-muted">{checks.checkCount} {t('ghCheckCount')}</p> : <p>{t('ghEvidenceUnavailable')}</p>}
          {checks && !annotations.length && <p>{t('ghNoAnnotations')}</p>}
          {annotations.map((item, index) => <button className="gh-problem" key={index} disabled={busy} onClick={() => void action(() => openFile(item.path, item.line, 'base'))}>
            <strong>{item.path}:{item.line}</strong><span>{item.message}</span><small>{item.check} · {item.sha.slice(0, 8)}</small>
          </button>)}
          {checks?.truncated && <p className="gh-warning">{t('ghTruncated')}</p>}
        </details>
        {source && <section className="gh-card gh-source" aria-label={t('ghSource')}>
          <h3>{source.path}</h3><div className="gh-toolbar"><span>{side === 'draft' ? t('ghDraftSide') : t('ghBaseSide')}</span>
            <label>{t('ghLine')}<input type="number" min="1" max={sourceLines.length} value={line} onChange={event => setLine(Math.max(1, Math.min(sourceLines.length, Number(event.target.value) || 1)))} /></label>
            {selectedChange && <button onClick={() => { setSide(side === 'base' ? 'draft' : 'base'); setLine(1); }}>{t('ghSwitchSide')}</button>}
            <a href={fileUrl(context.repo, context.baseSha, source.path, line)} target="_blank" rel="noreferrer">{t('ghOriginalLink')} ↗</a></div>
          {side === 'draft' && <p className="gh-muted">{t('ghDraftLinkNote')}</p>}
          <div className="gh-code" ref={viewer} tabIndex={0}>{sourceLines.map((text, n) => <div key={n} data-selected={n + 1 === line} className="gh-code-line"><span>{n + 1}</span><code>{text || ' '}</code></div>)}</div>
          <details><summary>{t('ghEdit')}</summary><label>{t('ghEditBody')}<textarea aria-label={t('ghEditBody')} value={editor} onChange={event => setEditor(event.target.value)} spellCheck={false} /></label>
            <button disabled={busy || draft?.status !== 'draft'} onClick={() => void action(async () => {
              setDraft(await api<Draft>(`/contexts/${context.id}/stage`, { path: source.path, expectedSha: source.sha, content: editor }, signal())); setSide('draft');
            })}>{t('ghSaveDraft')}</button></details>
        </section>}
        {onAsk && <details className="gh-card"><summary>{t('ghAskAgent')}</summary><p>{t('ghAgentScope')}</p>
          <textarea aria-label={t('ghRequest')} placeholder={t('ghRequest')} value={prompt} onChange={event => setPrompt(event.target.value)} />
          <button disabled={busy || !prompt.trim()} onClick={() => void action(async () => {
            await onAsk(`Use pulse_github for the selected repository context. First action=context and verify context id ${context.id}, then action=read with contextId for needed files, then action=propose with contextId, exact expectedSha and full updated text. If context id has changed, stop and ask the user to reselect. Propose only; do not publish. Repository ${context.repo}; branch ${context.branch}; base ${context.baseSha}. User request:\n${prompt}`);
            setPrompt('');
          })}>{t('ghSend')}</button></details>}
        <details open className="gh-card"><summary>{t('ghReview')} <span>{draft?.changes.length ?? 0}</span></summary>
          <p className="gh-warning">{t('ghNotTested')}</p>
          {!draft?.changes.length && <p>{t('ghNoChanges')}</p>}
          {draft?.changes.map(change => <details key={change.path} className="gh-change"><summary>{change.path} <span>+{diffLines(change.original, change.content).filter(row => row.kind === 'added').length} / −{diffLines(change.original, change.content).filter(row => row.kind === 'removed').length}</span></summary>
            <div className="gh-diff">{diffLines(change.original, change.content).map((row, index) => <button key={index} className={`gh-diff-line ${row.kind}`} disabled={busy} onClick={() => void action(() => openFile(change.path, row.kind === 'removed' ? row.oldLine! : row.newLine!, row.kind === 'removed' ? 'base' : 'draft'))}>
              <span>{row.oldLine ?? ''}</span><span>{row.newLine ?? ''}</span><code>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '} {row.text}</code>{row.kind !== 'same' && <small style={{ marginLeft: 12, opacity: .65 }}>{row.ending === 'none' ? t('ghNoNewline') : row.ending.toUpperCase()}</small>}</button>)}</div>
          </details>)}
          {draft?.changes.length ? <><label>{t('ghPrTitle')}<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} /></label>
            <p className="gh-muted">{t('ghPublishScope')}</p><button className="gh-primary" disabled={busy || !context.writable || !!draft.publishedUrl || !title.trim()} onClick={() => void action(async () => {
              await api(`/contexts/${context.id}/publish`, { title }, signal()); setDraft(await api<Draft>(`/contexts/${context.id}/changes`, undefined, signal()));
            })}>{t('ghPublish')}</button></> : null}
          {draft?.publishedUrl && <a className="gh-result" href={draft.publishedUrl} target="_blank" rel="noreferrer">{t('ghPrCreated')} ↗</a>}
        </details>
      </>}
    </>}
    {busy && <p role="status" className="gh-muted">{t('ghWorking')}</p>}
    {error && <p role="alert" className="gh-warning">{t('ghError')} <code>{error}</code></p>}
    <footer>{t('ghPrivacy')}</footer>
  </section>;
}
function FileTree({ entries, prefix = '', selected, disabled, onOpen }: { entries: Entry[]; prefix?: string; selected?: string; disabled: boolean; onOpen: (path: string) => void }) {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) { const name = entry.path.slice(prefix.length).split('/')[0]; groups.set(name, [...groups.get(name) ?? [], entry]); }
  return <ul>{[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, members]) => {
    const path = prefix + name; const directory = members.some(item => item.path !== path);
    return <li key={path}>{directory ? <details open={!!selected?.startsWith(path + '/')}><summary>{name}/</summary><FileTree entries={members} prefix={path + '/'} selected={selected} disabled={disabled} onOpen={onOpen} /></details> :
      <button aria-current={selected === path ? 'true' : undefined} disabled={disabled} onClick={() => onOpen(path)}>{name}</button>}</li>;
  })}</ul>;
}
const styles = `
.pulse-github{padding:20px;color:inherit;font:13px/1.6 inherit;--gh-line:rgba(127,143,136,.25);--gh-muted:var(--dsw-alias-label-secondary,#78887e);--gh-green:light-dark(#226d53,#8edbb5)}.pulse-github *{box-sizing:border-box}.pulse-github header,.gh-account,.gh-snapshot,.gh-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.pulse-github h2{margin:4px 0 8px;font-size:23px}.pulse-github h3{font-size:12px;overflow-wrap:anywhere;margin:0 0 10px}.gh-kicker{font-size:10px;letter-spacing:2px;color:var(--gh-green)}.gh-muted,.pulse-github footer{color:var(--gh-muted);font-size:11px}.pulse-github a{color:var(--gh-green)}.pulse-github button,.pulse-github input,.pulse-github select,.pulse-github textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--gh-line);border-radius:7px;padding:7px 10px;max-width:100%}.pulse-github button{cursor:pointer}.pulse-github button:disabled{opacity:.45;cursor:default}.pulse-github button:hover:not(:disabled){background:rgba(80,160,120,.12)}.pulse-github label{display:block;font-size:11px;margin:10px 0}.pulse-github label>input,.pulse-github label>select,.pulse-github label>textarea{display:block;width:100%;margin-top:4px}.pulse-github input:not([type=number]),.pulse-github select{width:100%}.pulse-github select option{color:CanvasText;background:Canvas}.pulse-github textarea{width:100%;min-height:140px;font:12px/1.6 ui-monospace,monospace;resize:vertical;white-space:pre}.pulse-github .gh-primary{color:var(--gh-green);border-color:var(--gh-green);margin:8px 0}.pulse-github summary{cursor:pointer;overflow-wrap:anywhere}.pulse-github summary>span{float:right;font-size:10px;color:var(--gh-muted)}.gh-card{border:1px solid var(--gh-line);border-radius:12px;padding:13px;margin:14px 0}.gh-account{border-bottom:1px solid var(--gh-line);padding:14px 0;font-size:10px;color:var(--gh-muted)}.gh-account>span:first-child{color:var(--gh-green)}.gh-snapshot{font-size:11px;color:var(--gh-muted);margin:12px 0}.gh-warning{font-size:11px;color:light-dark(#96531c,#efb66d);overflow-wrap:anywhere}.gh-tree{max-height:280px;overflow:auto;margin-top:8px}.gh-tree ul{list-style:none;padding-left:13px;margin:0}.gh-tree>ul{padding-left:0}.gh-tree button{border:0;padding:4px 6px;text-align:left;font:11px ui-monospace,monospace;width:100%;overflow-wrap:anywhere}.gh-tree button[aria-current=true]{background:rgba(70,160,110,.17);color:var(--gh-green)}.gh-tree summary{font:11px/2 ui-monospace,monospace}.gh-problem{display:block;width:100%;text-align:left;margin-top:9px}.gh-problem strong,.gh-problem span,.gh-problem small{display:block;overflow-wrap:anywhere}.gh-problem strong{font:11px ui-monospace,monospace}.gh-problem span{font-size:11px;margin:5px 0}.gh-problem small{font-size:10px;color:var(--gh-muted)}.gh-toolbar{font-size:10px;margin-bottom:8px}.gh-toolbar label{display:flex;gap:5px;align-items:center;margin:0}.gh-toolbar input{width:65px!important;margin:0!important;padding:3px!important}.gh-code,.gh-diff{overflow:auto;max-height:420px;background:light-dark(#f6f8f6,#151b18);border-radius:7px;margin:9px 0}.gh-code-line{display:flex;min-width:max-content;font:11px/1.9 ui-monospace,monospace}.gh-code-line>span{min-width:44px;text-align:right;padding-right:12px;color:var(--gh-muted);user-select:none}.gh-code-line code{white-space:pre;padding-right:10px}.gh-code-line[data-selected=true]{background:rgba(220,172,50,.2);box-shadow:inset 3px 0 #d1a148}.gh-change{border-top:1px solid var(--gh-line);padding:10px 0}.gh-diff-line{display:flex!important;min-width:max-content;width:100%;border:0!important;border-radius:0!important;padding:0 6px!important;text-align:left;line-height:1.9!important;font:10px ui-monospace,monospace!important}.gh-diff-line>span{width:30px;flex:none;color:var(--gh-muted)}.gh-diff-line code{white-space:pre}.gh-diff-line.added{background:rgba(45,167,93,.13)}.gh-diff-line.removed{background:rgba(220,82,64,.13)}.gh-result{display:block;margin-top:12px;font-weight:600}.pulse-github footer{border-top:1px solid var(--gh-line);margin-top:20px;padding-top:12px}.pulse-github :focus-visible{outline:2px solid var(--gh-green);outline-offset:2px}
`;
