(()=>{
 const copy={
  en:{heading:'Quick links',pending:'Coming soon',items:['Blog','Guides','About MOBIALO','eSIM support','Terms & conditions','Privacy policy','Delivery & refund policy','Sitemap','Affiliate','Destinations','MOBIALO vs others','Editorial policy']},
  sq:{heading:'Lidhje të shpejta',pending:'Në përgatitje',items:['Blog','Udhëzime','Rreth MOBIALO','Mbështetje eSIM','Kushtet e përdorimit','Politika e privatësisë','Politika e dërgesës dhe rimbursimit','Harta e faqes','Partneritet','Destinacionet','MOBIALO dhe alternativat','Politika editoriale']},
  it:{heading:'Link rapidi',pending:'Prossimamente',items:['Blog','Guide','Chi è MOBIALO','Assistenza eSIM','Termini e condizioni','Informativa sulla privacy','Politica di consegna e rimborso','Mappa del sito','Affiliazione','Destinazioni','MOBIALO e le alternative','Politica editoriale']}
 };
 const section=document.createElement('section');section.className='quick-links-section';
 const footer=document.querySelector('footer');if(!footer)return;
 // Below the homepage's footer columns (above its bottom line); first in the one-line footers of the other pages.
 const bottom=footer.querySelector('.footer-bottom');if(bottom)bottom.before(section);else footer.prepend(section);
 // A page that already links somewhere in its footer (the homepage columns) does not repeat it here.
 const listed=new Set([...footer.querySelectorAll('a[href]')].filter(link=>!section.contains(link)).map(link=>link.href));
 function render(){
  const t=copy[document.documentElement.lang]||copy.en;
  const links=['/blog.html','/#how','/about.html','mailto:support@mobialo.eu','/terms.html','/privacy.html','/delivery-refunds.html','/sitemap.html','/partners.html','/#destinations','/compare.html','/editorial.html'];
  section.replaceChildren();const heading=document.createElement('h2');heading.id='quick-links-title';heading.textContent=t.heading;section.append(heading);
  const nav=document.createElement('nav');nav.setAttribute('aria-labelledby',heading.id);
  t.items.forEach((label,i)=>{if(links[i]&&listed.has(new URL(links[i],location.href).href))return;const item=document.createElement(links[i]?'a':'span');item.className='quick-link';if(links[i])item.href=links[i];else{item.classList.add('quick-link-pending');item.setAttribute('aria-disabled','true');}const text=document.createElement('span');text.textContent=label;item.append(text);if(!links[i]){const badge=document.createElement('small');badge.textContent=t.pending;item.append(badge);}nav.append(item);});section.append(nav);
 }
 render();new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
