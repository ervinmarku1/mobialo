import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Writes the phone compatibility page once per language, so every address is complete without JavaScript (crawlers,
// link previews): dist/devices.html (/devices), dist/devices-sq.html (/sq/devices), dist/devices-it.html (/it/devices);
// vercel.json rewrites the addresses to these files. <main> is MobialoDevicesPage.render(lang) (dist/devices-page.js); the
// header uses the store pages' markup and words (scripts/storefront-pages.mjs, dist/storefront-core.js).
// After changing either script, run `node scripts/build-devices.mjs` and commit the three pages; scripts/devices-page.test.mjs
// fails while a committed page differs from this output.
const dist=name=>new URL('../dist/'+name,import.meta.url);
const run=name=>{const context=vm.createContext({});vm.runInContext(readFileSync(dist(name),'utf8'),context,{filename:name});return context;};
export const FILES={en:'devices.html',sq:'devices-sq.html',it:'devices-it.html'};
export const load=()=>({page:run('devices-page.js').MobialoDevicesPage,S:run('storefront-core.js').MobialoStorefront});
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const locales={en:'en_GB',sq:'sq_AL',it:'it_IT'};
const search='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></svg>';
// The page's own styles (styles.css has the header, the breadcrumb row and html.lang-redirect). The results area keeps a
// minimum height, so a search never pulls the note and the call to action up under the visitor.
const STYLE=".devices-main{max-width:880px;padding-block:0 65px;overflow-wrap:anywhere}.devices-main [hidden]{display:none!important}.devices-hero{padding:30px;background:#fff1e6;border-radius:18px;margin-bottom:8px}.devices-hero h1{font-size:clamp(30px,5vw,46px);letter-spacing:-1px;margin:14px 0 12px}.devices-lead{font-size:16px;line-height:1.75;color:#5c554f;max-width:660px;margin:0}.devices-section{padding:30px 0;border-bottom:1px solid var(--line)}.devices-section h2,.devices-cta h2{font-size:23px;letter-spacing:-.4px;margin:0 0 12px}.devices-section>p{line-height:1.85;color:var(--muted);margin:0}.devices-ways{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.devices-way{padding:20px;border:1px solid #e7e7e7;border-radius:14px}.devices-way h3{font-size:16px;margin:0 0 8px}.devices-way p{font-size:14px;line-height:1.75;color:var(--muted);margin:0}.devices-search{margin-top:22px}.devices-search label{display:block;font-size:14px;font-weight:600;margin-bottom:8px}.devices-input{width:100%;min-height:48px;padding:12px 14px;font-size:16px;border:1px solid #8f8a85;border-radius:10px;background:#fff;color:var(--ink)}.devices-input:focus-visible{outline:2px solid #a7400c;outline-offset:2px}.devices-count{font-size:13px;line-height:20px;color:var(--muted);margin:10px 0 14px}.devices-results{min-height:320px}.devices-brand{padding:20px;border:1px solid #e7e7e7;border-radius:14px;margin-bottom:14px}.devices-brand h3{font-size:18px;margin:0 0 6px}.devices-brand>p{font-size:13px;line-height:1.7;color:var(--muted);margin:0}.devices-models{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 18px;list-style:none;padding:0;margin:16px 0;font-size:14px;line-height:1.5}.devices-models li{position:relative;padding-left:13px}.devices-models li:before{content:'';position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--accent)}.devices-brand .devices-source{border-top:1px solid #eee;padding-top:8px}.devices-source a,.devices-empty a{display:inline-flex;align-items:center;gap:4px;min-height:32px;color:var(--accent)}.devices-source a>span:first-child,.devices-empty a{text-decoration:underline;text-underline-offset:3px}.devices-empty{padding:18px 20px;border:1px dashed #d6ccc4;border-radius:14px;font-size:14px;line-height:1.7;color:var(--muted);margin:0}.devices-note{font-size:13px;line-height:1.7;color:#5f5f5f;background:#f6f6f6;border-radius:12px;padding:14px 16px;margin:28px 0}.devices-cta{padding:28px 30px;border:1px solid #edcfb8;border-radius:18px;background:#fff6ed}.devices-cta p{line-height:1.75;color:#5c554f;margin:0 0 18px}@media(max-width:800px){.devices-ways{grid-template-columns:1fr}.devices-models{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:600px){.devices-hero{padding:24px 18px}.devices-lead{font-size:15px}.devices-section h2,.devices-cta h2{font-size:21px}.devices-section>p{font-size:14px}.devices-brand,.devices-way{padding:16px}.devices-models{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px}.devices-cta{padding:22px 18px}}@media(max-width:340px){.devices-models{grid-template-columns:1fr}}";

// The whole page for one language. Only the device data and the copy of the two scripts end up in it, all escaped.
export function devicesHtml(lang,{page,S}=load()){
  const t=page.copy[lang],c=S.copy(lang),esc=S.escape,hub=page.hubUrl(lang),canonical=page.origin+page.pageUrl(lang);
  const alternates=Object.fromEntries(S.LANGUAGES.map(code=>[code,page.pageUrl(code)]));
  const options=S.LANGUAGES.map(code=>`<option value="${code}"${code===lang?' selected':''}>${code.toUpperCase()}</option>`).join('');
  const graph={'@context':'https://schema.org','@graph':[{'@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:t.home,item:page.origin+'/'},{'@type':'ListItem',position:2,name:t.crumb,item:canonical}]}]};
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    // Before the first paint: a language chosen earlier opens its own address (crawlers have none stored; hidden meanwhile,
    // 3 s at most), and a stored session shows "My account" instead of "Sign in" (html.signed-in, styles.css).
    +`<script>(function(d,a){var l='';try{l=localStorage.getItem('mobialo-language-choice')||'';for(var i=0;i<localStorage.length;i++)if(/^sb-.+-auth-token$/.test(localStorage.key(i))){d.classList.add('signed-in');break}}catch(e){}if(a.hasOwnProperty(l)&&l!==d.lang){d.classList.add('lang-redirect');setTimeout(function(){d.classList.remove('lang-redirect')},3000);location.replace(a[l]+location.search+location.hash)}})(document.documentElement,${json(alternates)})</script><script src="/locale.js"></script>`
    +`<meta name="theme-color" content="#fff5ed"><title>${esc(t.title)} · MOBIALO</title><meta name="description" content="${esc(t.description)}">`
    +`<link rel="canonical" href="${esc(canonical)}">${S.LANGUAGES.map(code=>`<link rel="alternate" hreflang="${code}" href="${esc(page.origin+alternates[code])}">`).join('')}<link rel="alternate" hreflang="x-default" href="${esc(page.origin+alternates.en)}">`
    +`<meta property="og:type" content="website"><meta property="og:site_name" content="MOBIALO"><meta property="og:url" content="${esc(canonical)}"><meta property="og:locale" content="${locales[lang]}"><meta property="og:title" content="${esc(t.title)}"><meta property="og:description" content="${esc(t.description)}"><meta name="twitter:card" content="summary">`
    +`<script type="application/ld+json">${json(graph)}</script>`
    +`<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/brand-mark.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/quick-links.css"><script src="/quick-links.js" defer></script><script src="/devices-page.js" defer></script><style>${STYLE}</style></head>
<body><a class="skip" href="#devices-main">${esc(c.skip)}</a>`
    +`<header class="header wrap"><a href="/" class="logo" aria-label="MOBIALO"><img class="brand-mark" src="/brand-mark.svg" width="42" height="42" alt=""><span class="brand-word">mobialo<span class="brand-domain">.eu</span></span></a>`
    +`<nav aria-label="${esc(c.mainNav)}"><a href="${hub}">${esc(c.destinations)}</a><a href="/#how">${esc(c.how)}</a><a href="/#why">${esc(c.why)}</a><a href="/#faq">${esc(c.help)}</a></nav>`
    +`<div class="header-actions"><a class="header-search" href="${hub}#search" aria-label="${esc(c.searchLabel)}">${search}</a><label class="language-label"><span aria-hidden="true">◎</span><select id="devices-language" aria-label="${esc(c.language)}">${options}</select></label><span class="currency">EUR €</span><a class="account-link" href="/sign-in"><span class="account-out">${esc(c.signIn)}</span><span class="account-in">${esc(c.myAccount)}</span></a></div></header>
<main id="devices-main" class="devices-main wrap" data-language="${lang}">${page.render(lang)}</main>
<footer class="wrap"><p>© 2026 MOBIALO · iSmart Shop &amp; Service · NIPT L71614008L</p></footer>
</body></html>
`;
}
export function buildDevices(deps=load()){return Object.fromEntries(Object.entries(FILES).map(([lang,name])=>[name,devicesHtml(lang,deps)]));}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  for(const [name,html] of Object.entries(buildDevices()))writeFileSync(dist(name),html);
  console.log('Wrote dist/'+Object.values(FILES).join(', dist/')+'.');
}
