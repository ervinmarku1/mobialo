import {build} from 'esbuild';
await build({entryPoints:['src/auth.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'dist/auth.js',minify:true,legalComments:'eof'});
console.log('Built local authentication bundle.');
