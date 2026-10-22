import {workerSweep} from '../../scripts/worker-sweep.mjs';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const result=await workerSweep(req);
  return res.status(result.status).json(result.body);
}
