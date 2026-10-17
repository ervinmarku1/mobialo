import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

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
  return {merchantId,apiKey};
}

const cleanText = value => typeof value === 'string' ? value : '';
// Merchant pricing rule: numerical USD retail price treated as EUR, plus 20%.
// This is a selling-price policy, not a market exchange-rate conversion.
export function sellingPrice(retailPrice, currency) {
  if (currency !== 'USD') throw new CatalogError('UNSUPPORTED_CURRENCY',502);
  return Math.round((retailPrice * 1.2 + Number.EPSILON) * 100) / 100;
}
function parseDetails(raw) {
  try {
    const data = JSON.parse(raw);
    return {heading:cleanText(data.heading),description:cleanText(data.description),items:Array.isArray(data.items)?data.items.filter(item=>typeof item==='string'):[]};
  } catch {return {heading:'',description:'',items:[]};}
}

// Explicit allowlist: never send merchant cost, credentials, or raw responses
// to the browser. Product text is data and must be rendered as text, not HTML.
export function normalizeProducts(body) {
  const rows = Array.isArray(body) ? body : body?.result ?? body?.products;
  if (!Array.isArray(rows)) throw new CatalogError('INVALID_CATALOG',502);
  return rows.filter(product=>['esim_realtime','esim_delayed'].includes(product?.productCategory)).map(product=>{
    if (typeof product.productId !== 'string' || !product.productId || typeof product.retailPrice !== 'number' || !Number.isFinite(product.retailPrice) || product.retailPrice<0 || !/^[A-Z]{3}$/.test(product.currencyCode || '') || !Array.isArray(product.countries)) throw new CatalogError('INVALID_CATALOG',502);
    const details = new Map((Array.isArray(product.productDetails)?product.productDetails:[]).filter(item=>item && typeof item.name==='string').map(item=>[item.name,cleanText(item.value)]));
    const validity = details.get('PLAN_VALIDITY');
    const hours = validity && Number.isFinite(Number(validity)) && Number(validity)>0 ? Number(validity) : null;
    return {
      id:product.productId,
      category:product.productCategory,
      requiresIdentityVerification:product.productCategory==='esim_delayed',
      provider:cleanText(product.providerName),
      title:details.get('PLAN_TITLE') || cleanText(product.providerName) || 'eSIM',
      price:sellingPrice(product.retailPrice, product.currencyCode),
      currency:'EUR',
      countries:[...new Set(product.countries.filter(code=>typeof code==='string' && /^[A-Z]{2}$/.test(code)))],
      regions:Array.isArray(product.regions)?product.regions.filter(region=>typeof region==='string'):[],
      dataAmount:details.get('PLAN_DATA_LIMIT') || null,
      dataUnit:details.get('PLAN_DATA_UNIT') || null,
      validityHours:hours,
      details:parseDetails(details.get('PLAN_DETAILS')),
      updated:cleanText(product.updated)
    };
  });
}

export async function fetchProducts({merchantId,apiKey}, request=fetch) {
  let response;
  try {
    response = await request(productsUrl, {method:'GET',redirect:'error',headers:{'MerchantId':merchantId,'api-key':apiKey,'Accept':'application/json'},signal:AbortSignal.timeout(15000)});
  } catch {throw new CatalogError('UPSTREAM_UNAVAILABLE',502);}
  if ([401,403].includes(response.status)) throw new CatalogError('AUTH_FAILED',502);
  if (response.status===429) throw new CatalogError('RATE_LIMITED',503);
  if (!response.ok) throw new CatalogError('UPSTREAM_UNAVAILABLE',502);
  let body;
  try {body=await response.json();} catch {throw new CatalogError('INVALID_CATALOG',502);}
  return {source:'mobimatter',fetchedAt:new Date().toISOString(),products:normalizeProducts(body)};
}

export async function getCatalog() {
  const config=await credentials();
  const key=JSON.stringify(config); // Memory only, never logged or persisted.
  if (cached && cachedFor===key && Date.now()-cached.time<300000) return cached.value;
  if (pending && pending.key===key) return pending.promise;
  const promise=fetchProducts(config).then(value=>{cached={time:Date.now(),value};cachedFor=key;return value;});
  const operation={key,promise};pending=operation;
  try {return await promise;} finally {if(pending===operation) pending=null;}
}
