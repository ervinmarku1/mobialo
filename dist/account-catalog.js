// Reuse the storefront catalog and checkout inside the authenticated account shell.
if(window.parent!==window&&new URLSearchParams(location.search).get('view')==='account-catalog'){
 document.documentElement.classList.add('account-catalog-view');
 const style=document.createElement('style');
 style.textContent=`html.account-catalog-view{scroll-padding-top:12px} .account-catalog-view body{background:white}.account-catalog-view body> :not(main):not(dialog):not(script){display:none!important}.account-catalog-view main> :not(#destinations){display:none!important}.account-catalog-view #destinations{width:100%;max-width:none;padding:16px 4px}.account-catalog-view .section-heading{display:none}.account-catalog-view .catalog-toolbar{margin-top:18px}.account-catalog-view .destination-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.account-catalog-view .search-box{max-width:none;margin:0}.account-catalog-view .search{max-width:none}.account-catalog-view .catalog-bottom{margin-bottom:20px}.account-catalog-view dialog{position:fixed;top:16px;bottom:auto;max-height:calc(100vh - 32px);margin:0 auto}.account-catalog-view .tabs button{padding-inline:12px}@media(max-width:400px){.account-catalog-view .destination-grid{grid-template-columns:1fr}.account-catalog-view .catalog-toolbar{align-items:stretch}}`;
 document.head.append(style);
 window.addEventListener('DOMContentLoaded',()=>{
  const destinations=document.querySelector('#destinations');
  const search=document.querySelector('.search-box')||document.querySelector('#search-form');
  if(search)destinations.prepend(search);
  const sendHeight=()=>window.parent.postMessage({type:'mobialo-catalog-height',height:Math.ceil(document.documentElement.scrollHeight)},location.origin);
  new ResizeObserver(sendHeight).observe(document.body);sendHeight();
  window.addEventListener('message',event=>{
   if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='mobialo-catalog-language')return;
   if(!['en','sq','it'].includes(event.data.language))return;
   if(typeof setLanguage==='function')setLanguage(event.data.language);
  });
 });
}
