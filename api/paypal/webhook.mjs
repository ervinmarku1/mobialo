import {paypalWebhook} from '../../scripts/paypal-webhook.mjs';

export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const result=await paypalWebhook(req);
  return res.status(result.status).json(result.body);
}
