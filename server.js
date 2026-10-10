import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createStore } from './store.js';
const root = dirname(fileURLToPath(import.meta.url));
const store = createStore(process.env.DB_PATH || resolve(root, 'data/shiftswap.sqlite'), process.env.SEED_PATH || resolve(root, 'seed.json'));
const files = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/view-model.js':['view-model.js','text/javascript'], '/style.css':['style.css','text/css']};
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const send = (status, body) => {res.writeHead(status, {'Content-Type':'application/json'}); res.end(JSON.stringify(body));};
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/state') return send(200, store.view(url.searchParams.get('actor')));
    if (req.method === 'POST' && url.pathname === '/api/actions') {
      const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType !== 'application/json') return send(415, {error:'Use application/json.'});
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) return send(403, {error:'Origin not allowed.'});
      const chunks = [];
      let bodyBytes = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bodyBytes += chunk.length;
        if (bodyBytes > 16384) {
          req.resume();
          return send(413, {error:'Request too large.'});
        }
        chunks.push(chunk);
      }
      // Decode once so a multibyte character split across network chunks survives.
      const body = Buffer.concat(chunks).toString('utf8');
      let input; try {input = JSON.parse(body);} catch {return send(400,{error:'Invalid JSON.'});}
      if (!input || !['actor_id','action','target_id'].every(k => typeof input[k] === 'string' && input[k].length > 0)) return send(400, {error:'actor_id, action and target_id are required strings.'});
      const result = store.act(input.actor_id, input.action, input.target_id);
      return send(result.ok ? 200 : 409, result);
    }
    if (req.method === 'GET' && files[url.pathname]) {
      const [file,type] = files[url.pathname]; res.writeHead(200, {'Content-Type':`${type}; charset=utf-8`}); res.end(await readFile(resolve(root,'public',file))); return;
    }
    send(404, {error:'Not found.'});
  } catch (error) { console.error(error); send(500, {error:'Unexpected server error.'}); }
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log(`ShiftSwap running at http://localhost:${server.address().port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => {store.close(); process.exit(0);}));
