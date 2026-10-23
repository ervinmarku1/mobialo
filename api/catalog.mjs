import {CatalogError} from '../scripts/mobimatter.mjs';
import {publicCatalog,shareable} from '../scripts/public-catalog.mjs';
// The CDN keeps the catalog for a minute (then serves it stale for 10 minutes while it refreshes), the function
// answers from the last good catalog while MobiMatter is refreshed, and checkout recomputes the charged price.
// Errors, and prices built without readable settings, stay no-store.
export default async function handler(req,res,deps={}){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    const {body,shareable:cacheable}=await publicCatalog(deps);
    if(cacheable)shareable(res,60);
    return res.status(200).json(body);
  }catch(error){return res.status(error instanceof CatalogError?error.status:503).json({error:'CATALOG_UNAVAILABLE'});}
}
