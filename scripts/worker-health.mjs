import {readFile,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const file=()=>process.env.WORKER_HEALTH_FILE||join(tmpdir(),'mobialo-worker-health.json');
export async function writeWorkerHealth(state){
  const target=file();
  const temporary=target+'.'+process.pid+'.tmp';
  await writeFile(temporary,JSON.stringify({...state,updatedAt:Date.now()}),{mode:0o600});
  await rename(temporary,target);
}
export function healthy(state,now=Date.now()){
  return state?.ok===true&&Number.isFinite(state.updatedAt)&&now>=state.updatedAt&&now-state.updatedAt<300000;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{process.exitCode=healthy(JSON.parse(await readFile(file(),'utf8')))?0:1;}
  catch{process.exitCode=1;}
}
