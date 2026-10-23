// Phone compatibility page: /devices (English), /sq/devices and /it/devices. Each language is its own static page
// (dist/devices.html, devices-sq.html, devices-it.html) whose <main> is render(language), written by scripts/build-devices.mjs.
// The address decides the language, as on the store pages: a stored choice of another language moves to its address in
// <head> before the first paint; a detected language only gets the "also in your language" link. Nothing is re-rendered here.
// Works in browsers and under node:vm (no DOM at load), so the generator and the tests reuse render().
(()=>{
// Selected models checked against manufacturer support pages on 2026-10-16 (the list of the former homepage popup, devices.js).
// A model name alone never guarantees support for every regional/carrier variant.
const brands=[
 {name:'iPhone',models:['iPhone XS','iPhone XS Max','iPhone XR','iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max','iPhone SE (2020)','iPhone SE (2022)','iPhone 12 mini','iPhone 12','iPhone 12 Pro','iPhone 12 Pro Max','iPhone 13 mini','iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 14','iPhone 14 Plus','iPhone 14 Pro','iPhone 14 Pro Max','iPhone 15','iPhone 15 Plus','iPhone 15 Pro','iPhone 15 Pro Max','iPhone 16','iPhone 16 Plus','iPhone 16 Pro','iPhone 16 Pro Max','iPhone 16e','iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max','iPhone 17e','iPhone Air'],
  en:'iPhone XS/XR and later support eSIM in eligible markets. Mainland China, Hong Kong and Macao variants have model-specific exceptions. Check Apple’s regional guidance for your exact phone.',
  sq:'iPhone XS/XR dhe modelet më të reja mbështesin eSIM në tregjet përkatëse. Variantet nga Kina kontinentale, Hong Kongu dhe Makao kanë përjashtime sipas modelit. Kontrollo udhëzimin rajonal të Apple për telefonin tënd.',
  it:'iPhone XS/XR e successivi supportano eSIM nei mercati idonei. Le varianti per Cina continentale, Hong Kong e Macao hanno eccezioni specifiche per modello. Consulta le indicazioni regionali Apple per il tuo telefono.',
  sources:[['Apple','https://support.apple.com/en-euro/118669']]},
 {name:'Samsung',models:['Galaxy S20','Galaxy S20+','Galaxy S20 Ultra','Galaxy S21','Galaxy S21+','Galaxy S21 Ultra','Galaxy S22','Galaxy S22+','Galaxy S22 Ultra','Galaxy S23','Galaxy S23+','Galaxy S23 Ultra','Galaxy S23 FE','Galaxy S24','Galaxy S24+','Galaxy S24 Ultra','Galaxy S24 FE','Galaxy S25','Galaxy S25+','Galaxy S25 Ultra','Galaxy S25 Edge','Galaxy S25 FE','Galaxy S26','Galaxy S26+','Galaxy S26 Ultra','Galaxy Note20','Galaxy Note20 Ultra','Galaxy Z Fold2','Galaxy Z Fold3','Galaxy Z Fold4','Galaxy Z Fold5','Galaxy Z Fold6','Galaxy Z Fold7','Galaxy Z Flip','Galaxy Z Flip 5G','Galaxy Z Flip3','Galaxy Z Flip4','Galaxy Z Flip5','Galaxy Z Flip6','Galaxy Z Flip7','Galaxy Z Flip7 FE','Galaxy A36 5G','Galaxy A55 5G','Galaxy A56 5G','Galaxy XCover7','Galaxy XCover7 Pro'],
  en:'Availability varies by country, carrier and model number. Samsung’s linked list covers Australian variants; confirm your regional specifications under SIM size / Embedded-SIM. S20 FE and S21 FE are not included in this list.',
  sq:'Mbështetja ndryshon sipas shtetit, operatorit dhe numrit të modelit. Lista e Samsung në link është për variantet australiane; kontrollo specifikimet e variantit tënd te SIM size / Embedded-SIM. S20 FE dhe S21 FE nuk përfshihen në këtë listë.',
  it:'Il supporto varia in base al paese, all’operatore e al numero di modello. L’elenco Samsung collegato riguarda le varianti australiane; verifica le specifiche della tua variante alla voce SIM size / Embedded-SIM. S20 FE e S21 FE non sono inclusi in questo elenco.',
  sources:[['Samsung','https://www.samsung.com/au/support/mobile-devices/esim-compatibility/']]},
 {name:'Google Pixel',models:['Pixel 3a','Pixel 3a XL','Pixel 4','Pixel 4 XL','Pixel 4a','Pixel 4a (5G)','Pixel 5','Pixel 5a','Pixel 6','Pixel 6 Pro','Pixel 6a','Pixel 7','Pixel 7 Pro','Pixel 7a','Pixel Fold','Pixel 8','Pixel 8 Pro','Pixel 8a','Pixel 9','Pixel 9 Pro','Pixel 9 Pro XL','Pixel 9 Pro Fold','Pixel 9a','Pixel 10','Pixel 10 Pro','Pixel 10 Pro XL','Pixel 10 Pro Fold'],
  en:'Google confirms eSIM on Pixel 4 and later. Pixel 3a devices bought with Verizon service or in Japan are excluded. Older Pixel 2/3 devices have additional restrictions; consult Google’s guide. Carrier support is still required.',
  sq:'Google konfirmon eSIM në Pixel 4 dhe më të rinjtë. Përjashtohen Pixel 3a të blerë me shërbimin Verizon ose në Japoni. Pixel 2/3 kanë kufizime shtesë; shiko udhëzuesin e Google. Kërkohet edhe mbështetja nga operatori.',
  it:'Google conferma eSIM sui Pixel 4 e successivi. Sono esclusi Pixel 3a acquistati con Verizon o in Giappone. I Pixel 2/3 hanno ulteriori limitazioni: consulta la guida Google. È necessario il supporto dell’operatore.',
  sources:[['Google','https://support.google.com/pixelphone/answer/7086887?hl=en']]},
 {name:'Xiaomi',models:['Xiaomi 14T','Xiaomi 14T Pro','Xiaomi 15','Xiaomi 15 Ultra','Xiaomi 15T'],
  en:'Selected models confirmed in Xiaomi support documentation. eSIM availability depends on the regional version and carrier. This is not a complete Xiaomi/Redmi list; check the exact product specifications if your model is missing.',
  sq:'Modele të përzgjedhura të konfirmuara në dokumentacionin e Xiaomi. eSIM varet nga varianti rajonal dhe operatori. Kjo nuk është lista e plotë Xiaomi/Redmi; kontrollo specifikimet e produktit nëse modeli yt mungon.',
  it:'Modelli selezionati confermati dalla documentazione Xiaomi. La disponibilità dipende dalla variante regionale e dall’operatore. Questo non è un elenco completo Xiaomi/Redmi: controlla le specifiche esatte se il modello non è presente.',
  sources:[['Xiaomi','https://www.mi.com/my/support/faq/details/KA-535492/'],['Xiaomi 15T','https://www.mi.com/bd/support/faq/details/KA-607966/']]}
];
// iOS has no Albanian interface, so the Albanian text names the English menus; Android menu names vary anyway.
// home, breadcrumb and alsoIn are the store's words (storefront-core.js); crumb is the quick-links name of this page.
const copy={
 en:{title:'Does my phone support eSIM?',description:'How to check whether your phone supports eSIM: where to look in iPhone and Android settings, how to find the EID with *#06#, and a searchable list of models confirmed by manufacturers.',language:'Language',
  home:'Home',breadcrumb:'Breadcrumb',crumb:'Phone compatibility',alsoIn:'This page is also in English →',alsoInShort:'English →',
  intro:'To use a travel eSIM, your phone needs eSIM support and must be unlocked for other networks. Here is how to check both before you buy.',
  checkTitle:'How to check',ways:[['iPhone','Open Settings › Mobile Service (Cellular or Mobile Data on some versions). If you see “Add eSIM”, your iPhone supports eSIM. On iPhones with eSIM, Settings › General › About also shows an EID.'],['Android','Open the SIM settings (Samsung: Settings › Connections › SIM manager; Pixel: Settings › Network & internet › SIMs). An option such as “Add eSIM” means the phone supports eSIM. Menu names vary by manufacturer and Android version.'],['*#06#','Dial *#06# on the phone keypad. If an EID (a 32-digit number) appears, the phone has an eSIM. Not every phone shows the EID here, so if it is missing, check the settings as well.']],
  lockTitle:'Is your phone unlocked?',lockText:'A phone locked to one operator may not accept a travel eSIM, even if it supports eSIM. Phones bought with a contract are often locked. Ask your operator to confirm, or on iPhone open Settings › General › About: “No SIM restrictions” means the phone is unlocked.',
  listTitle:'Phones with eSIM',listIntro:'Selected models, checked against the manufacturers’ support pages on 16 October 2026. The list is not complete, and a model name alone does not guarantee eSIM: versions sold in some countries or by some operators may not have it. Check your exact model number with the manufacturer.',
  search:'Search your phone model',placeholder:'iPhone 15, Galaxy S24, Pixel 9…',count:'{n} models',countOf:'{n} of {total} models',empty:'This model is not in our list. That does not necessarily mean it lacks eSIM; check the manufacturer’s specifications.',source:'Official source:',newTab:'(opens in a new tab)',emptyLink:'How to check your phone',
  note:'This guide does not confirm compatibility for a particular model. Check your manufacturer’s specifications before purchasing.',
  ctaTitle:'Ready for your trip?',ctaText:'Choose a data plan for your destination. Prices are in EUR and the QR code arrives by email after payment.',ctaButton:'Browse destinations'},
 sq:{title:'A e mbështet telefoni im eSIM-in?',description:'Si të kontrollosh nëse telefoni yt mbështet eSIM: ku të shohësh te cilësimet e iPhone dhe Android, si ta gjesh EID-in me *#06# dhe një listë modelesh të konfirmuara nga prodhuesit, me kërkim.',language:'Gjuha',
  home:'Kreu',breadcrumb:'Vendndodhja në faqe',crumb:'Përputhshmëria e telefonit',alsoIn:'Kjo faqe është edhe në shqip →',alsoInShort:'Shqip →',
  intro:'Për të përdorur një eSIM gjatë udhëtimit, telefoni duhet të mbështesë eSIM dhe të jetë i zhbllokuar për rrjete të tjera. Ja si t’i kontrollosh të dyja para se të blesh.',
  checkTitle:'Si ta kontrollosh',ways:[['iPhone','Hap Settings › Mobile Service (në disa versione Cellular ose Mobile Data). Nëse sheh “Add eSIM”, iPhone-i yt mbështet eSIM. Te iPhone-ët me eSIM, Settings › General › About shfaq edhe një EID.'],['Android','Hap cilësimet e kartave SIM (Samsung: Settings › Connections › SIM manager; Pixel: Settings › Network & internet › SIMs). Një opsion si “Add eSIM” tregon se telefoni mbështet eSIM. Emërtimet ndryshojnë sipas prodhuesit, versionit të Android dhe gjuhës së telefonit.'],['*#06#','Thirr *#06# nga tastiera e telefonit. Nëse shfaqet një EID (numër me 32 shifra), telefoni ka eSIM. Jo çdo telefon e shfaq EID-in këtu, ndaj nëse mungon, kontrollo edhe cilësimet.']],
  lockTitle:'A është telefoni i zhbllokuar?',lockText:'Një telefon i bllokuar te një operator mund të mos e pranojë eSIM-in e udhëtimit, edhe nëse mbështet eSIM. Telefonat e blerë me kontratë shpesh janë të bllokuar. Pyet operatorin tënd, ose te iPhone hap Settings › General › About: “No SIM restrictions” do të thotë që telefoni është i zhbllokuar.',
  listTitle:'Telefonat me eSIM',listIntro:'Modele të përzgjedhura, të kontrolluara në faqet e mbështetjes së prodhuesve më 16 tetor 2026. Lista nuk është e plotë dhe emri i modelit vetëm nuk e garanton eSIM-in: versionet që shiten në disa shtete ose nga disa operatorë mund të mos e kenë. Kontrollo numrin e saktë të modelit te prodhuesi.',
  search:'Kërko modelin e telefonit',placeholder:'iPhone 15, Galaxy S24, Pixel 9…',count:'{n} modele',countOf:'{n} nga {total} modele',empty:'Modeli nuk u gjet në listën tonë. Kjo nuk do të thotë që nuk e mbështet eSIM; kontrollo specifikimet e prodhuesit.',source:'Burimi zyrtar:',newTab:'(hapet në një skedë të re)',emptyLink:'Si ta kontrollosh telefonin',
  note:'Ky udhëzues nuk konfirmon përshtatshmërinë e një modeli të caktuar. Kontrollo specifikimet e prodhuesit para blerjes.',
  ctaTitle:'Gati për udhëtimin?',ctaText:'Zgjidh një paketë interneti për destinacionin tënd. Çmimet janë në EUR dhe kodi QR vjen me email pas pagesës.',ctaButton:'Shiko destinacionet'},
 it:{title:'Il mio telefono supporta eSIM?',description:'Come verificare se il tuo telefono supporta eSIM: dove guardare nelle impostazioni di iPhone e Android, come trovare l’EID con *#06# e un elenco di modelli confermati dai produttori, con ricerca.',language:'Lingua',
  home:'Home',breadcrumb:'Percorso',crumb:'Compatibilità del telefono',alsoIn:'Questa pagina è anche in italiano →',alsoInShort:'Italiano →',
  intro:'Per usare una eSIM in viaggio, il telefono deve supportare eSIM ed essere sbloccato per altre reti. Ecco come verificare entrambe le cose prima di acquistare.',
  checkTitle:'Come verificare',ways:[['iPhone','Apri Impostazioni › Cellulare (Dati cellulare su alcune versioni). Se vedi “Aggiungi eSIM”, il tuo iPhone supporta eSIM. Sugli iPhone con eSIM, Impostazioni › Generali › Info mostra anche un EID.'],['Android','Apri le impostazioni delle SIM (Samsung: Impostazioni › Connessioni › Gestione SIM; Pixel: Impostazioni › Rete e Internet › SIM). Un’opzione come “Aggiungi eSIM” indica che il telefono supporta eSIM. I nomi dei menu variano in base al produttore e alla versione di Android.'],['*#06#','Componi *#06# sulla tastiera del telefono. Se compare un EID (un numero di 32 cifre), il telefono ha una eSIM. Non tutti i telefoni mostrano l’EID qui: se manca, controlla anche le impostazioni.']],
  lockTitle:'Il telefono è sbloccato?',lockText:'Un telefono bloccato su un operatore potrebbe non accettare una eSIM da viaggio, anche se supporta eSIM. I telefoni acquistati con un contratto sono spesso bloccati. Chiedi conferma al tuo operatore oppure, su iPhone, apri Impostazioni › Generali › Info: “Nessuna restrizione SIM” indica che il telefono è sbloccato.',
  listTitle:'Telefoni con eSIM',listIntro:'Modelli selezionati, verificati sulle pagine di assistenza dei produttori il 16 ottobre 2026. L’elenco non è completo e il nome del modello da solo non garantisce la eSIM: le versioni vendute in alcuni paesi o da alcuni operatori potrebbero non averla. Controlla il numero di modello esatto con il produttore.',
  search:'Cerca il modello del telefono',placeholder:'iPhone 15, Galaxy S24, Pixel 9…',count:'{n} modelli',countOf:'{n} di {total} modelli',empty:'Questo modello non è nel nostro elenco. Non significa necessariamente che non supporti eSIM: controlla le specifiche del produttore.',source:'Fonte ufficiale:',newTab:'(si apre in una nuova scheda)',emptyLink:'Come verificare il telefono',
  note:'Questa guida non garantisce la compatibilità di un modello specifico. Controlla le specifiche del produttore prima di acquistare.',
  ctaTitle:'Pronto per il viaggio?',ctaText:'Scegli un piano dati per la tua destinazione. I prezzi sono in EUR e il codice QR arriva via email dopo il pagamento.',ctaButton:'Vedi le destinazioni'}
};
const origin='https://www.mobialo.eu';
const total=brands.reduce((sum,brand)=>sum+brand.models.length,0);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize=value=>String(value??'').normalize('NFD').replace(/\p{M}+/gu,'').toLowerCase().replace(/[^a-z0-9+]+/g,' ').trim();
const pick=language=>Object.hasOwn(copy,String(language))?language:'en';
const pathLanguage=path=>(/^\/(sq|it)(?:\/|$)/.exec(String(path||''))||[])[1]||null;
const prefix=language=>pick(language)==='en'?'':'/'+language;
const pageUrl=language=>prefix(language)+'/devices';
const hubUrl=language=>prefix(language)+'/esim';
// Every word of the query must appear in 'brand model'; the query without spaces also matches ('pixel9' finds Pixel 9).
function matcher(query){
 const words=normalize(query).split(' ').filter(Boolean),compact=words.join('');
 return (brand,model)=>{const text=normalize(brand.name+' '+model);return words.every(word=>text.includes(word))||text.replace(/ /g,'').includes(compact);};
}
function filter(query){const match=matcher(query);return brands.map(brand=>({brand,models:brand.models.filter(model=>match(brand,model))})).filter(result=>result.models.length);}
const countText=(language,shown,filtered)=>(filtered?copy[pick(language)].countOf:copy[pick(language)].count).replace('{n}',filtered?shown:total).replace('{total}',total);
function render(language){
 language=pick(language);const t=copy[language],e=escapeHtml;
 const ways=t.ways.map(([title,text])=>`<article class="devices-way"><h3>${e(title)}</h3><p>${e(text)}</p></article>`).join('');
 const list=brands.map((brand,i)=>`<section class="devices-brand" aria-labelledby="brand-${i}"><h3 id="brand-${i}">${e(brand.name)}</h3><p>${e(brand[language])}</p><ul class="devices-models">${brand.models.map(model=>`<li>${e(model)}</li>`).join('')}</ul><p class="devices-source">${e(t.source)} ${brand.sources.filter(([,url])=>url.startsWith('https://')).map(([name,url])=>`<a href="${e(url)}" target="_blank" rel="noopener noreferrer"><span>${e(name)}</span><span aria-hidden="true">↗</span><span class="visually-hidden"> ${e(t.newTab)}</span></a>`).join(' · ')}</p></section>`).join('');
 // The breadcrumb row of the store pages, with the slot for the "also in your language" link; it never adds a line.
 return `<div class="page-trail"><nav class="breadcrumb" aria-label="${e(t.breadcrumb)}"><ol><li><a href="/">${e(t.home)}</a></li><li><span aria-current="page">${e(t.crumb)}</span></li></ol></nav><a class="lang-suggest" id="lang-suggest" hidden></a></div>`
  +`<header class="devices-hero"><span class="eyebrow">MOBIALO · eSIM</span><h1 id="devices-title">${e(t.title)}</h1><p class="devices-lead">${e(t.intro)}</p></header>`
  +`<section id="check" class="devices-section" aria-labelledby="check-title"><h2 id="check-title">${e(t.checkTitle)}</h2><div class="devices-ways">${ways}</div></section>`
  +`<section id="unlocked" class="devices-section" aria-labelledby="unlocked-title"><h2 id="unlocked-title">${e(t.lockTitle)}</h2><p>${e(t.lockText)}</p></section>`
  +`<section id="models" class="devices-section" aria-labelledby="models-title"><h2 id="models-title">${e(t.listTitle)}</h2><p>${e(t.listIntro)}</p><div class="devices-search"><label for="device-query">${e(t.search)}</label><input id="device-query" class="devices-input" type="search" placeholder="${e(t.placeholder)}" autocomplete="off" spellcheck="false" aria-describedby="device-count"><p id="device-count" class="devices-count" role="status">${e(countText(language,total,false))}</p></div><div id="device-results" class="devices-results">${list}<p class="devices-empty" hidden>${e(t.empty)} <a href="#check">${e(t.emptyLink)}</a></p></div></section>`
  +`<p class="devices-note">${e(t.note)}</p>`
  +`<section class="devices-cta" aria-labelledby="cta-title"><h2 id="cta-title">${e(t.ctaTitle)}</h2><p>${e(t.ctaText)}</p><a class="button" href="${hubUrl(language)}">${e(t.ctaButton)} <span aria-hidden="true">→</span></a></section>`;
}
globalThis.MobialoDevicesPage={brands,copy,total,normalize,pathLanguage,pageUrl,hubUrl,filter,countText,render,origin};

if(typeof document==='undefined'||!document.getElementById('devices-main'))return;
const root=document.documentElement,main=document.getElementById('devices-main'),select=document.getElementById('devices-language'),locale=window.MobialoLocale;
const language=pick(root.lang),storage=(store,key)=>{try{return globalThis[store].getItem(key)||'';}catch{return '';}};
// Filters by hiding list items, so nothing above the list moves; the results area keeps a minimum height (build-devices.mjs).
function update(){
 const input=document.getElementById('device-query');if(!input)return;
 const query=input.value,match=matcher(query),filtered=normalize(query)!=='';let shown=0;
 main.querySelectorAll('.devices-brand').forEach((section,i)=>{let visible=0;section.querySelectorAll('li').forEach((item,j)=>{const ok=match(brands[i],brands[i].models[j]);item.hidden=!ok;if(ok)visible++;});section.hidden=!visible;shown+=visible;});
 main.querySelector('.devices-empty').hidden=shown>0;
 const count=document.getElementById('device-count'),text=countText(language,shown,filtered);if(count.textContent!==text)count.textContent=text;
}
update();
main.addEventListener('input',event=>{if(event.target.id==='device-query')update();});
// A page restored by the back button may still show the language picked before leaving it, or an older query.
addEventListener('pageshow',()=>{if(select)select.value=language;update();});
// The menu opens this page in the other language and remembers the choice.
select?.addEventListener('change',()=>{const value=pick(select.value);locale?.choose(value);location.assign(pageUrl(value)+location.search+location.hash);});
// A stored session (html.signed-in, set in <head>) already shows "My account" from the first paint; the link follows.
if(root.classList.contains('signed-in'))document.querySelector('.account-link')?.setAttribute('href','/account');
// A detected language that differs from the page only gets a link in the breadcrumb row (crawler-safe, never moves the
// page): the visitor's language is a guess, the URL is not. Phones get the short label, the full sentence stays its name.
const note=document.getElementById('lang-suggest');
if(note&&locale&&!storage('localStorage','mobialo-language-choice'))locale.ready.then(detected=>{
 if(detected===language||pick(detected)!==detected||storage('sessionStorage','mobialo-detected-language').split(':')[0]!==detected)return;
 const t=copy[detected],short=typeof matchMedia==='function'&&matchMedia('(max-width:600px)').matches;
 note.href=pageUrl(detected);note.lang=note.hreflang=detected;note.textContent=short?t.alsoInShort:t.alsoIn;
 if(short)note.setAttribute('aria-label',t.alsoIn.replace(/\s*→$/,''));
 note.hidden=false;note.addEventListener('click',()=>locale.choose(detected));
});
})();
