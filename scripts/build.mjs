import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', platform: 'node', format: 'esm', target: 'node24', bundle: true });

// DSH owns React and the browser module registry. Bundle our code only, then
// expose the factory in the exact format the Client plugin loader consumes.
const client = await build({ entryPoints: ['src/client.tsx'], platform: 'browser', format: 'cjs', target: 'es2022', bundle: true, external: ['react'], write: false });
await writeFile('dist/client.js', `window.__ModuleLoader__.load({id:"dsh-pulse",factory(require){const module={exports:{}};const exports=module.exports;\n${client.outputFiles[0].text}\nreturn module.exports;}});\n`);
