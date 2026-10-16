import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root)) {response.writeHead(403);response.end();return;}
    const content = await readFile(file);
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
    response.end(content);
  } catch {response.writeHead(404);response.end('Not found');}
}).listen(port, '127.0.0.1', () => console.log(`MOBIALO preview: http://localhost:${port}`));
