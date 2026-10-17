import {build} from 'esbuild';
await build({entryPoints:['src/auth.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'dist/auth.js',minify:true,legalComments:'eof'});
console.log('Built local authentication bundle.');
await build({entryPoints:['src/admin.js'],bundle:true,format:'esm',platform:'browser',target:['es2022'],outfile:'dist/admin.js',minify:true,legalComments:'eof'});
