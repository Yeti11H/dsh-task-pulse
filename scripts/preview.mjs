import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1]) || 4173;
const result = await build({ entryPoints: ['preview/main.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const html = await readFile(fileURLToPath(new URL('../preview/index.html', import.meta.url)));
createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(result.outputFiles[0].contents); }
  else if (new URL(req.url, 'http://127.0.0.1').pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); }
  else { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
