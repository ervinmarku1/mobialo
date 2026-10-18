(()=>{
 const copy={
  en:{heading:'Quick links',pending:'Coming soon',items:['Blog','Guides','About MOBIALO','eSIM support','Terms & conditions','Privacy policy','Delivery & refunds policy','Sitemap','Affiliate','Destinations','MOBIALO vs others','Editorial policy']},
  sq:{heading:'Lidhje të shpejta',pending:'Në përgatitje',items:['Blog','Udhëzime','Rreth MOBIALO','Mbështetje eSIM','Kushtet e përdorimit','Politika e privatësisë','Dërgesa dhe rimbursimet','Harta e faqes','Partneritet','Destinacionet','MOBIALO dhe alternativat','Politika editoriale']},
  it:{heading:'Link rapidi',pending:'Prossimamente',items:['Blog','Guide','Chi è MOBIALO','Assistenza eSIM','Termini e condizioni','Informativa sulla privacy','Consegna e rimborsi','Mappa del sito','Affiliazione','Destinazioni','MOBIALO e le alternative','Politica editoriale']}
 };
 const section=document.createElement('section');section.className='quick-links-section';
 const footer=document.querySelector('footer');if(!footer)return;
 footer.prepend(section);
 function render(){
  const t=copy[document.documentElement.lang]||copy.en;
  const destinations=location.pathname==='/account'?'/account#destinations':'/#destinations';
  const links=['/blog.html','/#how','/about.html','mailto:support@mobialo.eu','/terms.html','/privacy.html','/delivery-refunds.html','/sitemap.html','/partners.html',destinations,'/compare.html','/editorial.html'];
  section.replaceChildren();const heading=document.createElement('h2');heading.id='quick-links-title';heading.textContent=t.heading;section.append(heading);
  const nav=document.createElement('nav');nav.setAttribute('aria-labelledby',heading.id);
  t.items.forEach((label,i)=>{const item=document.createElement(links[i]?'a':'span');item.className='quick-link';if(links[i])item.href=links[i];else{item.classList.add('quick-link-pending');item.setAttribute('aria-disabled','true');}const text=document.createElement('span');text.textContent=label;item.append(text);if(!links[i]){const badge=document.createElement('small');badge.textContent=t.pending;item.append(badge);}nav.append(item);});section.append(nav);
 }
 render();new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
