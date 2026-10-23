import {publicCatalog,shareable,WARM_AGE,RECHECK_AGE} from '../scripts/public-catalog.mjs';
import {createStorefront,routeFromPath,routeFromQuery} from '../scripts/storefront-pages.mjs';

// The storefront pages and /sitemap.xml (vercel.json rewrites /esim/... and /sq|it/esim/... here). They are built from the
// same catalog and prices as /api/catalog, and checkout refuses a price other than the one the plan page showed. The CDN
// keeps a page for 5 minutes and serves a stale copy for 10 more while it refreshes. Prices built without readable
// settings, catalog failures and the warm-up stay no-store.
let storefront;
// Shown when the page code itself cannot load (e.g. a file missing from includeFiles): no catalog, no copy tables.
const broken='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>MOBIALO</title></head><body style="font:16px/1.5 system-ui,sans-serif;margin:40px 16px;color:#262321;background:#fff5ed"><h1>MOBIALO</h1><p lang="en">This page is temporarily unavailable. Please try again in a minute.</p><p lang="sq">Kjo faqe nuk është e disponueshme për momentin. Provo përsëri pas një minute.</p><p lang="it">Questa pagina non è momentaneamente disponibile. Riprova tra un minuto.</p><p><a href="/">mobialo.eu</a></p></body></html>\n';
export default async function handler(req,res,deps={}){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.setHeader('Allow','GET, HEAD');return res.end();}
  const url=new URL(req.url||'/','https://www.mobialo.eu');
  const route=req.query?.page||url.searchParams.has('page')?routeFromQuery(req.query?.page?req.query:Object.fromEntries(url.searchParams)):routeFromPath(url.pathname,url.search);
  const done=(status,type,body)=>{res.statusCode=status;if(type)res.setHeader('Content-Type',type);return res.end(req.method==='HEAD'||body==null?undefined:body);};
  let site=null;
  try{site=deps.storefront||(deps.createStorefront?deps.createStorefront():(storefront??=createStorefront()));}
  catch(error){console.error('Storefront unavailable',error?.message);}
  // pg_cron calls this every minute (no body, never cached): the catalog is refreshed before its 5-minute lifetime ends
  // and grouped for the pages, so no page of a warm instance waits for MobiMatter.
  if(route.page==='warm'){
    try{const catalog=await publicCatalog({...deps,maxAge:WARM_AGE});site?.destinationsFor(catalog.body);return done(204);}
    catch{res.setHeader('Retry-After','60');return done(503);}
  }
  if(!site){res.setHeader('Retry-After','60');return done(503,route.page==='sitemap'?'text/plain; charset=utf-8':'text/html; charset=utf-8',route.page==='sitemap'?'Storefront unavailable':broken);}
  // A plan page reloaded after checkout reported a changed price (?r=) shows a catalog at most a minute old; not shared.
  const recheck=route.page==='plan'&&(req.query?.r!==undefined||url.searchParams.has('r'));
  let result,cacheable=!recheck;
  // A route rejected before the catalog (junk slug or id), or an old link whose id is not a product id, needs no catalog.
  if(route.page==='missing'||route.page==='legacy'&&!route.product)result=site.render(route,null);
  else try{
    const catalog=await publicCatalog(recheck?{...deps,maxAge:RECHECK_AGE}:deps);
    result=site.render(route,catalog.body);cacheable&&=catalog.shareable;
  }catch{
    result=site.unavailable(route);res.setHeader('Retry-After','60');cacheable=false;
  }
  // Pages and the 301 of an old plan link are shared; a 404, and the homepage redirect of an unknown old link, briefly.
  if(cacheable&&[200,301].includes(result.status))shareable(res,300);
  else if(cacheable&&[302,404].includes(result.status)){res.setHeader('Cache-Control','public, max-age=0, must-revalidate');res.setHeader('Vercel-CDN-Cache-Control','s-maxage=60');}
  if(result.location){res.setHeader('Location',result.location);return done(result.status,result.type,'');}
  if(route.page!=='sitemap')res.setHeader('Content-Language',route.lang);
  return done(result.status,result.type,result.body);
}
