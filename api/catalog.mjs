import {getCatalog,CatalogError,priceIncludingProcessing,isHiddenTestProduct} from '../scripts/mobimatter.mjs';
import {DEFAULT_PRICING,loadSettings} from '../scripts/app-settings.mjs';
import {readFile} from 'node:fs/promises';
export default async function handler(req,res,{env=process.env,settings=loadSettings,catalog=getCatalog}={}){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    if(!env.MOBIMATTER_MERCHANT_ID||!env.MOBIMATTER_API_KEY){
      const snapshot=JSON.parse(await readFile(new URL('../dist/catalog-preview.json',import.meta.url),'utf8'));
      // The checked-in snapshot stores prices with the default markup; rescale for the configured one.
      const {pricing}=await settings(env);
      const markup=(100+pricing.markupPercent)/(100+DEFAULT_PRICING.markupPercent);
      snapshot.products=snapshot.products.filter(product=>!isHiddenTestProduct(product.id)).map(product=>({...product,price:priceIncludingProcessing(product.price*markup,pricing)}));
      return res.status(200).json(snapshot);
    }
    return res.status(200).json(await catalog());
  }catch(error){return res.status(error instanceof CatalogError?error.status:503).json({error:'CATALOG_UNAVAILABLE'});}
}
