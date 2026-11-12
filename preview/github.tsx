import React from 'react';
import { GithubView } from '../src/github-view.tsx';
import type { WorkbenchApi, RepoContext, Draft, SourceFile } from '../src/github.ts';
import { zh, type Translation } from '../src/locales.ts';
const t: Translation = key => zh[key as keyof typeof zh] ?? key;
const sha = 'a'.repeat(40), blob = 'b'.repeat(40);
const original = 'package demo;\n\nclass LoginService {\n  boolean login(String password) {\n    return password.length() > 0;\n  }\n}\n';
const context: RepoContext = { id: 'fixture', sessionId: 'preview', repo: 'demo/login-service', branch: 'main', baseSha: sha, writable: true, truncated: false,
  entries: [{ path: 'src/main/java/demo/LoginService.java', type: 'blob', sha: blob, size: original.length }, { path: 'README.md', type: 'blob', sha: blob, size: 16 }] };
let draft: Draft = { contextId: 'fixture', changes: [], status: 'draft' };
const api: WorkbenchApi = async <T,>(path: string, body?: unknown): Promise<T> => {
  if (path.startsWith('/repos')) return { items: [{ name: context.repo, defaultBranch: 'main', writable: true }], page: 1, more: false } as T;
  if (path === '/contexts') return context as T;
  if (path.endsWith('/changes')) return structuredClone(draft) as T;
  if (path.endsWith('/checks')) return { sha, truncated: false, checkCount: 1, annotations: [{ path: context.entries[0].path, line: 5, endLine: 5, level: 'failure', message: '模拟检查：password 为 null 时会抛出异常。', sha, check: 'Demo · unit tests' }] } as T;
  if (path.includes('/file?')) return { path: decodeURIComponent(path.split('path=')[1]), sha: blob, commit: sha, content: original } as SourceFile as T;
  if (path.endsWith('/stage')) {
    const change = body as { path: string; content: string };
    draft = { ...draft, changes: [{ path: change.path, originalSha: blob, original, content: change.content }] }; return structuredClone(draft) as T;
  }
  if (path.endsWith('/publish')) { draft = { ...draft, status: 'published', publishedUrl: 'https://github.com/demo/login-service/pull/1' }; return { url: draft.publishedUrl } as T; }
  if (path.endsWith('/close')) return {} as T;
  throw new Error('fixture-endpoint-not-found');
};
export function GithubDemo() {
  return <><p style={{ padding: '12px 20px', background: 'rgba(210,160,30,.15)', fontSize: 12 }}>交互演示 · 仓库、检查与发布均为模拟数据</p><GithubView sessionId="preview" t={t} testApi={api} /></>;
}
