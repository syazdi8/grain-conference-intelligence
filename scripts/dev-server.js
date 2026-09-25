// Local test server only (Vercel does this in production): serves the static files and runs the
// same /api/relationship-read function. Usage: `npm run dev`, then open http://localhost:3000
// To try the AI read locally, set ANTHROPIC_API_KEY in your own terminal environment. Never commit it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from '../api/relationship-read.js';

const ROOT = join(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/relationship-read') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); return res; };
    return handler({ method: req.method, body: raw }, res);
  }
  const path = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
  if (path.includes('..')) { res.statusCode = 400; return res.end(); }
  try {
    const data = await readFile(join(ROOT, path));
    res.setHeader('content-type', TYPES[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
