import {readFile} from 'node:fs/promises';
import {getCatalog,priceIncludingProcessing,isHiddenTestProduct} from './mobimatter.mjs';
import {DEFAULT_PRICING,loadSettings} from './app-settings.mjs';

// The warm-up (api/store page=warm, pg_cron every minute) refreshes a catalog older than this, and waits for it, before
// the 5-minute lifetime ends (a minute between calls plus the 15 s MobiMatter timeout): the pages of a warm instance
// then never depend on a background refresh. A plan page reloaded after checkout reported a changed price (?r=) takes
// a catalog at most a minute old, the age checkout compares with.
export const WARM_AGE=200000,RECHECK_AGE=60000;

// The public catalog behind /api/catalog and the storefront pages (api/store.mjs), so a page shows the price
// checkout charges (live-checkout.mjs prices from the same getCatalog and refuses a price that changed since). Pages
// take the last good catalog while it refreshes (getCatalog allowStale). Without MobiMatter credentials it is the
// checked-in snapshot, rescaled for the configured markup. The settings are read once, for the prices and for
// `shareable`: false when they were unreadable, and such a response must stay out of the CDN (no-store).
export async function publicCatalog({env=process.env,settings=loadSettings,catalog=getCatalog,maxAge=0}={}){
  const loaded=await settings(env);
  if(!env.MOBIMATTER_MERCHANT_ID||!env.MOBIMATTER_API_KEY){
    const snapshot=JSON.parse(await readFile(new URL('../dist/catalog-preview.json',import.meta.url),'utf8'));
    // The checked-in snapshot stores prices with the default markup; rescale for the configured one.
    const {pricing}=loaded;
    const markup=(100+pricing.markupPercent)/(100+DEFAULT_PRICING.markupPercent);
    snapshot.products=snapshot.products.filter(product=>!isHiddenTestProduct(product.id)).map(product=>({...product,price:priceIncludingProcessing(product.price*markup,pricing)}));
    return {body:snapshot,shareable:true};
  }
  // maxAge (warm-up, price recheck): wait for a catalog that recent; otherwise the last good one at once.
  const body=await catalog({settings:async()=>loaded,...(maxAge?{maxAge}:{allowStale:true})});
  return {body,shareable:!loaded.unavailable};
}

// The same for every visitor, so the Vercel CDN may keep it; browsers always revalidate. The CDN serves a stale copy
// for 10 more minutes while it refreshes in the background, so nobody waits for the function, and a shown price is
// at most minutes old (checkout compares it with the current one).
export function shareable(res,seconds){
  res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
  res.setHeader('Vercel-CDN-Cache-Control',`s-maxage=${seconds}, stale-while-revalidate=600`);
}
