import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeUrl, diffLines, fileUrl, matchingAnnotations, type Annotation } from '../src/github.ts';

test('companion accepts only loopback HTTP without credentials/query or remote host', () => {
  assert.equal(bridgeUrl('http://127.0.0.1:43127/'), 'http://127.0.0.1:43127');
  for (const value of ['https://example.com', 'http://127.0.0.1.evil.com', 'http://user@127.0.0.1:4', 'http://127.0.0.1:4/path', 'http://localhost:4/?token=secret'])
    assert.throws(() => bridgeUrl(value));
});
test('diff retains real old/new line coordinates and escaping is left to React', () => {
  const rows = diffLines('a\nb\nc\n', 'a\nnew\nc\n');
  assert.deepEqual(rows.filter(row => row.kind === 'removed').map(row => [row.oldLine, row.text]), [[2, 'b']]);
  assert.deepEqual(rows.filter(row => row.kind === 'added').map(row => [row.newLine, row.text]), [[2, 'new']]);
  assert.equal(rows.filter(row => row.kind === 'same').at(-1)?.newLine, 3);
  assert.deepEqual(diffLines('', ''), []);
});
test('annotations from another commit never navigate as current evidence', () => {
  const data: Annotation[] = [
    { path: 'src/App.java', line: 2, endLine: 2, level: 'failure', message: 'x', sha: 'a'.repeat(40), check: 'tests' },
    { path: 'src/App.java', line: 9, endLine: 9, level: 'failure', message: 'old', sha: 'b'.repeat(40), check: 'tests' }
  ];
  assert.equal(matchingAnnotations(data, 'a'.repeat(40)).length, 1);
});
test('GitHub line links pin a SHA and encode individual path segments', () => {
  assert.equal(fileUrl('a/repo', 'a'.repeat(40), 'src/a b.java', 12), `https://github.com/a/repo/blob/${'a'.repeat(40)}/src/a%20b.java#L12`);
});

test('diff exposes final newline and CRLF changes without inventing extra source lines', () => {
  const rows = diffLines('same\nlast\n', 'same\nlast');
  assert.deepEqual(rows.filter(row => row.kind !== 'same').map(row => [row.kind, row.text, row.ending]),
    [['removed', 'last', 'lf'], ['added', 'last', 'none']]);
  assert.equal(rows.at(-1)?.newLine, 2);
  assert.deepEqual(diffLines('a\r\n', 'a\n').map(row => row.ending), ['crlf', 'lf']);
});

test('bounded large-file diff reconstructs both revisions with correct coordinates', () => {
  const before = Array.from({ length: 1000 }, (_, n) => `line ${n}\n`).join('');
  const after = before.replace('line 500\n', 'changed\nmore\n');
  const rows = diffLines(before, after);
  const restore = (side: 'old' | 'new') => rows.filter(row => side === 'old' ? row.kind !== 'added' : row.kind !== 'removed')
    .map(row => row.text + (row.ending === 'crlf' ? '\r\n' : row.ending === 'lf' ? '\n' : '')).join('');
  assert.equal(restore('old'), before);
  assert.equal(restore('new'), after);
  assert.equal(rows.find(row => row.text === 'more')?.newLine, 502);
});
