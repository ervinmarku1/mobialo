import {readFile,writeFile} from 'node:fs/promises';
import {emailLanguages} from './locale.mjs';
const root=new URL('../supabase/email-templates/',import.meta.url);
const translations=JSON.parse(await readFile(new URL('languages.json',root),'utf8'));
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
for(const language of emailLanguages){if(!translations[language])throw Error(`Missing ${language}`);}
for(const [file,reset] of [['confirm-signup',false],['reset-password',true]]){
  const order=[...emailLanguages.filter(language=>language!=='en'),'en'];
  const blocks=order.map((language,index)=>{
    const copy=translations[language];
    const condition=language==='en'?'{{ else }}':`{{ ${index?'else if':'if'} eq .Data.language "${language}" }}`;
    return `${condition}
<section lang="${language}" dir="${['ar','he'].includes(language)?'rtl':'ltr'}">
  <h1 style="font-size:26px;color:#111">${escape(reset?copy.resetTitle:copy.title)}</h1>
  <p>${escape(copy.intro)}</p>
  <p style="margin:30px 0"><a href="{{ .ConfirmationURL }}" style="background:#c95413;color:#fff;padding:14px 22px;border-radius:9px;text-decoration:none;display:inline-block">${escape(reset?copy.resetButton:copy.button)}</a></p>
  <p style="color:#666;font-size:13px">${escape(copy.ignore)}</p>
</section>`;
  });
  await writeFile(new URL(`${file}.html`,root),'<!doctype html><html><head><meta charset="utf-8"></head><body style="background:#fff;color:#222;font-family:Arial,sans-serif;line-height:1.6"><main style="max-width:560px;margin:32px auto;padding:24px"><div style="font-size:25px;font-weight:bold">mobialo<span style="color:#c95413">.eu</span></div>\n'+blocks.join('\n')+'\n{{ end }}\n<p><a href="mailto:support@mobialo.eu">support@mobialo.eu</a></p></main></body></html>\n');
}
console.log(`Generated confirmation and recovery templates for ${emailLanguages.length} languages, with English fallback.`);
