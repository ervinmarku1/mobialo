import {adminAccess} from '../../scripts/admin-access-api.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Authorization');
 const result=await adminAccess(req);return res.status(result.status).json(result.body);
}
