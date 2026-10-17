import {localeForCountry} from '../scripts/locale.mjs';
export default function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','x-vercel-ip-country');
  if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  return res.status(200).json({language:localeForCountry(req.headers['x-vercel-ip-country'])});
}
