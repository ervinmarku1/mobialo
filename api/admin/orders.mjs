import {adminOrders} from '../../scripts/admin-orders.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
 try{const result=await adminOrders(req);return res.status(result.status).json(result.body);}catch{return res.status(503).json({error:'ORDERS_UNAVAILABLE'});}
}
