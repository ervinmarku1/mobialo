import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {DEFAULT_PRICING,loadSettings,validPricing} from './app-settings.mjs';

const envFile = new URL('../.env.local', import.meta.url);
const productsUrl = 'https://api.mobimatter.com/mobimatter/api/v2/products';
let cached = null;
let cachedFor = '';
let pending = null;

export class CatalogError extends Error {
  constructor(code, status) {super(code);this.code=code;this.status=status;}
}

async function credentials() {
  let local = {};
  try {local = parseEnv(await readFile(envFile, 'utf8'));}
  catch(error) {if(error.code !== 'ENOENT') throw new CatalogError('CONFIG_READ_FAILED',503);}
  const merchantId = (process.env.MOBIMATTER_MERCHANT_ID || local.MOBIMATTER_MERCHANT_ID || '').trim();
  const apiKey = (process.env.MOBIMATTER_API_KEY || local.MOBIMATTER_API_KEY || '').trim();
  if (!merchantId || !apiKey) throw new CatalogError('NOT_CONFIGURED',503);
  if (/[\r\n]/.test(merchantId + apiKey)) throw new CatalogError('INVALID_CONFIG',503);
  return {config:{merchantId,apiKey},env:{...local,...process.env}};
}

const cleanText = value => typeof value === 'string' ? value : '';
const hiddenTestProductIds=new Set([
  '24f5ebfc-4335-4227-9ef6-d9482502e32e',
  '75b98dc7-c026-48c1-9fee-465681382d39'
]);
export const isHiddenTestProduct=id=>hiddenTestProductIds.has(id);
// All-in customer price, covering the admin-configured processing cost (default 2.5% + EUR 0.20).
// Integer cents and basis points, rounded up so the post-fee amount covers the base price.
export function priceIncludingProcessing(basePrice,pricing=DEFAULT_PRICING){
  if(!validPricing(pricing))throw new CatalogError('INVALID_PRICING',503);
  if(!Number.isFinite(basePrice)||basePrice<0)throw new CatalogError('INVALID_CATALOG',502);
  const cents=Math.round(basePrice*100);
  if(cents===0)return 0;
  const feeBps=Math.round(pricing.feePercent*100),fixedCents=Math.round(pricing.feeFixed*100);
  return Math.ceil((cents+fixedCents)*10000/(10000-feeBps))/100;
}
// Merchant pricing rule: numerical USD retail price treated as EUR, plus the markup (default 20%).
// This is a selling-price policy, not a market exchange-rate conversion.
export function sellingPrice(retailPrice, currency, pricing=DEFAULT_PRICING) {
  if (currency !== 'USD') throw new CatalogError('UNSUPPORTED_CURRENCY',502);
  if (!validPricing(pricing)) throw new CatalogError('INVALID_PRICING',503);
  return priceIncludingProcessing(Math.round((retailPrice * (1 + pricing.markupPercent / 100) + Number.EPSILON) * 100) / 100, pricing);
}
function parseDetails(raw) {
  try {
    const data = JSON.parse(raw);
    return {heading:cleanText(data.heading),description:cleanText(data.description),items:Array.isArray(data.items)?data.items.filter(item=>typeof item==='string'):[]};
  } catch {return {heading:'',description:'',items:[]};}
}

// Explicit allowlist: never send merchant cost, credentials, or raw responses
// to the browser. Product text is data and must be rendered as text, not HTML.
export function normalizeProducts(body, pricing=DEFAULT_PRICING) {
  const rows = Array.isArray(body) ? body : body?.result ?? body?.products;
  if (!Array.isArray(rows)) throw new CatalogError('INVALID_CATALOG',502);
  return rows.filter(product=>['esim_realtime','esim_delayed'].includes(product?.productCategory)&&!isHiddenTestProduct(product.productId)).map(product=>{
    if (typeof product.productId !== 'string' || !product.productId || typeof product.retailPrice !== 'number' || !Number.isFinite(product.retailPrice) || product.retailPrice<0 || !/^[A-Z]{3}$/.test(product.currencyCode || '') || !Array.isArray(product.countries)) throw new CatalogError('INVALID_CATALOG',502);
    const details = new Map((Array.isArray(product.productDetails)?product.productDetails:[]).filter(item=>item && typeof item.name==='string').map(item=>[item.name.trim(),cleanText(item.value)]));
    const supported = key => details.get(key)==='1'?true:details.get(key)==='0'?false:null;
    const validity = details.get('PLAN_VALIDITY');
    const hours = validity && Number.isFinite(Number(validity)) && Number(validity)>0 ? Number(validity) : null;
    return {
      id:product.productId,
      category:product.productCategory,
      requiresIdentityVerification:product.productCategory==='esim_delayed',
      provider:cleanText(product.providerName),
      providerLogo: (()=>{try{const url=new URL(product.providerLogo);return url.protocol==='https:'?url.href:null;}catch{return null;}})(),
      title:details.get('PLAN_TITLE') || cleanText(product.providerName) || 'eSIM',
      price:sellingPrice(product.retailPrice, product.currencyCode, pricing),
      currency:'EUR',
      countries:[...new Set(product.countries.filter(code=>typeof code==='string' && /^[A-Z]{2}$/.test(code)))],
      regions:Array.isArray(product.regions)?product.regions.filter(region=>typeof region==='string'):[],
      dataAmount:details.get('PLAN_DATA_LIMIT') || null,
      dataUnit:details.get('PLAN_DATA_UNIT') || null,
      validityHours:hours,
      features:{data:supported('HAS_DATA'),calls:supported('HAS_CALLS'),sms:supported('HAS_SMS'),hotspot:supported('HOTSPOT'),network:details.get('NETWORKS_SHORT')||null,speed:details.get('SPEED_LONG')||details.get('SPEED')||null,activation:details.get('ACTIVATION_POLICY')||null,phonePrefix:details.get('PHONE_NUMBER_PREFIX')||null},
      details:parseDetails(details.get('PLAN_DETAILS')),
      updated:cleanText(product.updated)
    };
  });
}

export async function fetchProducts({merchantId,apiKey}, request=fetch, pricing=DEFAULT_PRICING) {
  let response;
  try {
    response = await request(productsUrl, {method:'GET',redirect:'error',headers:{'MerchantId':merchantId,'api-key':apiKey,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
  } catch {throw new CatalogError('UPSTREAM_UNAVAILABLE',502);}
  if ([401,403].includes(response.status)) throw new CatalogError('AUTH_FAILED',502);
  if (response.status===429) throw new CatalogError('RATE_LIMITED',503);
  if (!response.ok) throw new CatalogError('UPSTREAM_UNAVAILABLE',502);
  let body;
  try {body=await response.json();} catch {throw new CatalogError('INVALID_CATALOG',502);}
  return {source:'mobimatter',fetchedAt:new Date().toISOString(),products:normalizeProducts(body,pricing)};
}

// Pricing is part of the cache key, so an admin change applies within the settings cache window (never a stale copy).
// Checkout (the default) takes a catalog fetched within CATALOG_TTL, else waits for MobiMatter and fails with it.
// Pages pass allowStale: the last good catalog at once while a refresh runs in the background, and for up to
// STALE_LIMIT while MobiMatter fails (checkout still refuses a price that changed). The warm-up passes a shorter
// maxAge: it refreshes in its own invocation, before a page would start a background refresh.
export const CATALOG_TTL=300000,STALE_LIMIT=3600000;
export async function getCatalog({settings=loadSettings,request=fetch,allowStale=false,maxAge=CATALOG_TTL,now=Date.now}={}) {
  const {config,env}=await credentials();
  const {pricing}=await settings(env);
  const key=JSON.stringify(config)+JSON.stringify(pricing); // Memory only, never logged or persisted.
  const age=cached&&cachedFor===key?now()-cached.time:Infinity;
  if (age<Math.min(maxAge,CATALOG_TTL)) return cached.value;
  // A refresh older than the 15 s request timeout was frozen with its instance: start another one.
  const refresh=pending&&pending.key===key&&now()-pending.at<20000?pending.promise:startRefresh(key,config,request,pricing,now);
  if (allowStale&&age<STALE_LIMIT) {refresh.catch(()=>{});return cached.value;}
  return refresh;
}
function startRefresh(key,config,request,pricing,now) {
  const operation={key,at:now()};
  operation.promise=fetchProducts(config,request,pricing).then(value=>{cached={time:now(),value};cachedFor=key;return value;}).finally(()=>{if(pending===operation) pending=null;});
  pending=operation;
  return operation.promise;
}
