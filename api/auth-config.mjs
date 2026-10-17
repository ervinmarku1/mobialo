import {publicAuthConfig} from '../scripts/supabase-config.mjs';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  try{return res.status(200).json(await publicAuthConfig());}
  catch{return res.status(200).json({enabled:false});}
}
