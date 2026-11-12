/** GitHub workbench wire types and pure helpers. No DSH or credential storage. */
export interface Repository { name: string; defaultBranch: string; writable: boolean }
export interface Entry { path: string; type: string; sha: string; size: number }
export interface RepoContext { id: string; sessionId: string; repo: string; branch: string; baseSha: string; writable: boolean; entries: Entry[]; truncated: boolean }
export interface SourceFile { path: string; sha: string; commit: string; content: string }
export interface Change { path: string; originalSha: string; original: string; content: string }
export interface Draft { contextId: string; changes: Change[]; status: string; publishedUrl?: string; branch?: string }
export interface Annotation { path: string; line: number; endLine: number; level: string; message: string; sha: string; check: string }
export interface Checks { annotations: Annotation[]; truncated: boolean; sha: string; checkCount: number }
export interface Page<T> { items: T[]; page: number; more: boolean }
export function bridgeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('bridge-loopback-only');
  return url.origin;
}
export function matchingAnnotations(items: Annotation[], sha: string): Annotation[] { return items.filter(item => item.sha === sha && item.line > 0); }
export function fileUrl(repo: string, sha: string, path: string, line = 1): string {
  return `https://github.com/${repo}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}#L${Math.max(1, line)}`;
}
export interface DiffLine { kind: 'same' | 'added' | 'removed'; text: string; ending: 'lf' | 'crlf' | 'none'; oldLine: number | null; newLine: number | null }
function lines(value: string): string[] {
  // Keep terminators in comparisons: final-newline-only changes are real edits.
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
/** LCS for normal files; bounded fallback groups the changed middle for large files.
 * Coordinates always refer to their own old/new side, never guessed line offsets. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before), b = lines(after);
  const result: DiffLine[] = [];
  let i = 0, j = 0;
  const push = (kind: DiffLine['kind']) => {
    const raw = kind === 'added' ? b[j] : a[i];
    const ending = raw.endsWith('\r\n') ? 'crlf' : raw.endsWith('\n') ? 'lf' : 'none';
    result.push({ kind, text: raw.slice(0, raw.length - (ending === 'crlf' ? 2 : ending === 'lf' ? 1 : 0)), ending,
      oldLine: kind === 'added' ? null : i + 1, newLine: kind === 'removed' ? null : j + 1 });
    if (kind !== 'added') i++;
    if (kind !== 'removed') j++;
  };
  if (a.length * b.length > 250_000) {
    while (i < a.length && j < b.length && a[i] === b[j]) push('same');
    let suffix = 0;
    while (a.length - suffix > i && b.length - suffix > j && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix++;
    while (i < a.length - suffix) push('removed');
    while (j < b.length - suffix) push('added');
    while (i < a.length) push('same');
    return result;
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let x = a.length - 1; x >= 0; x--) for (let y = b.length - 1; y >= 0; y--)
    table[x][y] = a[x] === b[y] ? table[x + 1][y + 1] + 1 : Math.max(table[x + 1][y], table[x][y + 1]);
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) push('same');
    else if (j < b.length && (i === a.length || table[i][j + 1] > table[i + 1][j])) push('added');
    else push('removed');
  }
  return result;
}
export type WorkbenchApi = <T>(path: string, body?: unknown, signal?: AbortSignal) => Promise<T>;
export function createWorkbenchApi(address: string, token: string): WorkbenchApi {
  const origin = bridgeUrl(address);
  return async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!path.startsWith('/') || path.includes('://')) throw new Error('invalid-api-path');
    const response = await fetch(`${origin}/api${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error ?? (response.status === 401 ? 'pairing-or-login-required' : `bridge-error-${response.status}`));
    }
    return response.json() as Promise<T>;
  };
}
