import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {getCatalog, CatalogError} from './mobimatter.mjs';
import {publicAuthConfig} from './supabase-config.mjs';
import {createOrder,captureOrder,publicPayPalConfig} from './paypal.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 3000);
const types = {'.svg':'image/svg+xml','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if(pathname==='/api/paypal/config'&&request.method==='GET'){
      response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
      try{response.end(JSON.stringify(await publicPayPalConfig()));}catch{response.writeHead(503);response.end('{}');}return;
    }
    if(pathname.startsWith('/api/paypal/')){
      response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
      const origin=`http://${request.headers.host}`;
      if(request.method!=='POST'||!['localhost','127.0.0.1'].some(host=>request.headers.host===`${host}:${port}`)||request.headers.origin!==origin||!request.headers['content-type']?.startsWith('application/json')){response.writeHead(403);response.end('{}');return;}
      try{
        let raw='';for await(const chunk of request){raw+=chunk;if(raw.length>4096)throw Error('INVALID_REQUEST');}
        const body=JSON.parse(raw);
        const result=pathname==='/api/paypal/create'?await createOrder(body.productId,origin,body.smart===true):pathname==='/api/paypal/capture'?await captureOrder(body.state,body.token):null;
        if(!result)throw Error('INVALID_REQUEST');
        response.end(JSON.stringify(result));
      }catch(error){const allowed=['PAYPAL_SANDBOX_NOT_CONFIGURED','PAYPAL_CREDENTIALS_FAILED','PAYPAL_REQUEST_FAILED','INVALID_PRODUCT','TEST_ORDER_EXPIRED','PAYMENT_NOT_COMPLETED','TOO_MANY_TEST_ORDERS'];response.writeHead(400);response.end(JSON.stringify({error:allowed.includes(error.message)?error.message:'PAYPAL_UNAVAILABLE'}));}
      return;
    }
    if(pathname==='/api/auth-config'){
      response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');
      if(request.method!=='GET'){response.writeHead(405);response.end('{}');return;}
      try{const config=await publicAuthConfig();response.writeHead(200);response.end(JSON.stringify(config));}
      catch{response.writeHead(503);response.end(JSON.stringify({error:'AUTH_NOT_CONFIGURED'}));}
      return;
    }
    if (pathname === '/api/catalog') {
      response.setHeader('Content-Type','application/json; charset=utf-8');
      response.setHeader('Cache-Control','no-store');
      if (request.method !== 'GET') {response.writeHead(405,{'Allow':'GET'});response.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
      try {const catalog=await getCatalog();response.writeHead(200);response.end(JSON.stringify(catalog));}
      catch(error) {
        // Set status before writing any bytes, and never expose upstream bodies.
        response.statusCode = error instanceof CatalogError ? error.status : 500;
        response.end(JSON.stringify({error:error instanceof CatalogError ? error.code : 'CATALOG_FAILED'}));
      }
      return;
    }
    const isAuth=['/join','/sign-in','/forgot-password','/update-password','/account'].includes(pathname.replace(/\/$/,''));
    const file = path.resolve(root, `.${isAuth ? '/auth.html' : pathname === '/' ? '/index.html' : pathname}`);
    const relative=path.relative(root,file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part=>part.startsWith('.'))) {response.writeHead(403);response.end();return;}
    const content = await readFile(file);
    response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    response.end(content);
  } catch {response.writeHead(404);response.end('Not found');}
}).listen(port, '127.0.0.1', () => console.log(`MOBIALO preview: http://localhost:${port}`));
