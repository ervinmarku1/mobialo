import {execFile} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {availableParallelism} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';

// Offline checks run by `npm run check` and CI before the tests: every script and JSON file parses,
// and the docs name every environment variable the server reads and every migration.
const root=fileURLToPath(new URL('../',import.meta.url));
const run=promisify(execFile);
const read=file=>readFileSync(join(root,file),'utf8');
const list=(dir,pattern,recursive=true)=>readdirSync(join(root,dir),{recursive}).filter(name=>pattern.test(name)).map(name=>join(dir,name).replaceAll('\\','/'));

export const scriptFiles=()=>['api','scripts','src','dist'].flatMap(dir=>list(dir,/\.m?js$/));
// node --check reads only its first file argument, so every file gets its own process.
export async function syntaxErrors(files,cwd=root){
  const errors=[],queue=[...files];
  await Promise.all(Array.from({length:Math.min(availableParallelism(),8)},async()=>{
    for(let file;(file=queue.shift());)await run(process.execPath,['--check',file],{cwd}).catch(error=>errors.push(file+': '+String(error.stderr||error.message).trim()));
  }));
  return errors.sort();
}
export function jsonErrors(files=[...list('.',/\.json$/,false),...list('dist',/\.json$/),...list('supabase/email-templates',/\.json$/)]){
  return files.flatMap(file=>{try{JSON.parse(read(file));return [];}catch(error){return [file+': '+error.message];}});
}
// Commented entries in .env.example count as documented (PORT and similar are read from the shell only).
export function undocumentedEnv(){
  const documented=new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(match=>match[1]));
  const used=[...list('api',/\.mjs$/),...list('scripts',/\.mjs$/,false)].filter(file=>!file.endsWith('.test.mjs')).flatMap(file=>[...read(file).matchAll(/\benv(?:\?\.|\.)([A-Z][A-Z0-9_]*)/g)].map(match=>match[1]));
  return [...new Set(used)].filter(name=>!documented.has(name)).sort();
}
export function unlistedMigrations(){
  const doc=read('supabase/DELIVERY-SETUP.md');
  return list('supabase/migrations',/\.sql$/,false).map(file=>file.split('/').pop()).filter(name=>!doc.includes(name));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const files=scriptFiles();
  const problems=[...await syntaxErrors(files),...jsonErrors(),...undocumentedEnv().map(name=>'.env.example does not list '+name),...unlistedMigrations().map(name=>'supabase/DELIVERY-SETUP.md does not list '+name)];
  for(const problem of problems)console.error(problem);
  console.log(`Checked ${files.length} scripts${problems.length?`: ${problems.length} problem(s)`:', JSON files and docs: ok'}.`);
  if(problems.length)process.exitCode=1;
}
