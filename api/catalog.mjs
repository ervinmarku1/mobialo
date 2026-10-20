import {getCatalog,CatalogError,priceIncludingProcessing,isHiddenTestProduct} from '../scripts/mobimatter.mjs';
import {readFile} from 'node:fs/promises';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{
    if(!process.env.MOBIMATTER_MERCHANT_ID||!process.env.MOBIMATTER_API_KEY){
      const snapshot=JSON.parse(await readFile(new URL('../dist/catalog-preview.json',import.meta.url),'utf8'));
      // The checked-in snapshot stores the original marked-up prices.
      snapshot.products=snapshot.products.filter(product=>!isHiddenTestProduct(product.id)).map(product=>({...product,price:priceIncludingProcessing(product.price)}));
      return res.status(200).json(snapshot);
    }
    return res.status(200).json(await getCatalog());
  }catch(error){return res.status(error instanceof CatalogError?error.status:503).json({error:'CATALOG_UNAVAILABLE'});}
}
