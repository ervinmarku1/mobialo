/* Storefront logic shared by the browser and the server. The homepage (app.js, live-catalog.js) and the destination
   pages (catalog-shop.js) run it in the browser; scripts/storefront-pages.mjs loads this same file with node:vm to render
   /esim and the country, region and plan pages. Destination grouping, slugs, links, copy and cards therefore exist once.
   Classic script without DOM access; supplier text (titles, providers, region labels) is escaped wherever it is rendered. */
globalThis.MobialoStorefront=(()=>{
const LANGUAGES=['en','sq','it'],ORIGIN='https://www.mobialo.eu',PAGE_SIZE=10;
// MobiMatter lists continents in regions, even for World/Global plans.
const GLOBAL=/\b(global|world|worldwide)\b/i;
const REGION_ORDER=['europe','balkans','america','north-america','south-america','caribbean','asia','middle-east','africa','oceania','multi-country'];
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
// Lowercase ASCII words joined by '-': diacritics, dots and apostrophes dropped, '&' read as 'and' ('St. Kitts & Nevis' -> 'st-kitts-and-nevis').
const slugify=text=>String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[.'’]/g,'').replace(/&/g,' and ').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const COPY={
 en:{home:'Home',destinations:'Destinations',how:'How it works',why:'Why MOBIALO',help:'Help center',signIn:'Sign in',myAccount:'My account',skip:'Skip to content',mainNav:'Main navigation',breadcrumb:'Breadcrumb',language:'Language',searchLabel:'Search destinations',searchPlaceholder:'Where are you heading?',
  from:'From',fromRegional:'Regional plans from',day:'day',days:'days',hour:'hour',hours:'hours',seeDetails:'See details',plan:'1 plan',plans:'{n} plans',showMore:'Show more',viewPlan:'View plan',coveredOne:'1 covered country',covered:'{n} covered countries',calls:'Calls',kyc:'Identity verification required',
  filters:'Filter plans',alsoCovers:'Also covers',minData:'Minimum data',minDays:'Minimum validity',maxPrice:'Maximum price',provider:'Provider',all:'All',clearFilters:'Clear filters',sortBy:'Sort by',sortPrice:'Lowest price',sortData:'Most data',sortDays:'Longest validity',removeFilter:'Remove filter',noPlans:'No plans match. Try removing some filters.',
  hubTitle:'eSIM destinations: countries, regions and global plans · MOBIALO',hubDescription:'Travel eSIM data plans for {n} countries, plus regional and global plans. Prices in EUR include processing costs; payment through PayPal and the QR code by email.',hubHeading:'eSIM for every destination',hubIntro:'Find your country, a region or a global plan. Prices in EUR include processing costs, payment is through PayPal and the QR code arrives by email.',countries:'Countries',regions:'Regions',globalPlans:'Global eSIM',noResults:'No matching destinations. Try another country or region.',resultsOne:'1 matching destination',results:'{n} matching destinations',
  countryHeading:'{name} eSIM',countryTitle:'{name} eSIM: travel data plans · MOBIALO',countryDescription:'{name} eSIM: {plans} from {price}. Prices in EUR include processing costs, payment through PayPal and the QR code by email.',destinationIntro:'Choose the data and validity that fit your trip, pay through PayPal and get your eSIM QR code by email.',regionalNote:'There is no plan for this country alone. These regional plans include it.',regionIntro:'Each plan covers several countries with one eSIM. Check the covered countries of a plan before buying.',regionCountries:'Countries covered by these plans',
  headingTitle:'{heading}: travel data plans · MOBIALO',headingDescription:'{heading}: {plans} from {price}. Prices in EUR include processing costs, payment through PayPal and the QR code by email.',descPlanOne:'1 data plan',descPlans:'{n} data plans',
  facts:'On this page: {plans} from {providers}, valid {validity}.',factsNoValidity:'On this page: {plans} from {providers}.',providerOne:'1 provider',providers:'{n} providers',validityOne:'for {min}',validityRange:'from {min} to {max}',
  planTitle:'{plan} · {name} eSIM · MOBIALO',planHeadingTitle:'{plan} · {heading} · MOBIALO',planDescription:'{plan}: {data}, {validity}, {price}. eSIM plan by {provider} for {name}. Payment through PayPal, QR code by email.',planHeadingDescription:'{plan}: {data}, {validity}, {price}. {heading} plan by {provider}. Payment through PayPal, QR code by email.',data:'Data',validity:'Validity',total:'Total price',payment:'Payment',coverage:'Covered countries',fullInfo:'Full plan information',kycPlan:'This plan requires identity verification.',
  details:'eSIM details',esimType:'eSIM type',dataOnly:'Data · no calls/SMS',servicesBelow:'See included services below',network:'Network · 4G / 5G',speed:'Speed',activation:'Activation',included:'Included',notIncluded:'Not included',unspecified:'Not specified',networkNote:'4G/5G indicates network technology, not guaranteed speed. Availability depends on location, device and operator.',
  loadingPayment:'Loading payment methods…',noScriptPayment:'Turn on JavaScript to pay with PayPal or by card.',notLive:'Check coverage, compatibility and activation terms before paying.',previewNote:'Prices include processing costs. No fee is added at checkout.',savedCatalog:'Prices from a saved catalog. The live catalog is temporarily unavailable.',closed:'Purchases are temporarily unavailable. Please try again in a few minutes.',trustPay:'Secure payment through PayPal',trustQr:'QR code by email after payment',trustHelp:'Help:',trustPolicy:'Delivery & refund policy',device:'Is my phone eSIM compatible?',
  alsoIn:'This page is also in English →',notFoundTitle:'Page not found',notFoundText:'This page does not exist or has moved.',goHome:'Go to the homepage',findEsim:'Find your eSIM',helpEmail:'Help: support@mobialo.eu',unavailableTitle:'Catalog unavailable',unavailableText:'The catalog could not be loaded. Please retry.',retry:'Retry',
  footerTag:'Go places. Stay connected.',explore:'Explore',support:'Support',deviceGuide:'Device compatibility',about:'About us',previewStore:'Secure payment through PayPal',operator:'MOBIALO is operated by iSmart Shop & Service (NIPT L71614008L), Tirana, Albania.'},
 sq:{home:'Kreu',destinations:'Destinacionet',how:'Si funksionon',why:'Pse MOBIALO',help:'Ndihmë',signIn:'Hyr',myAccount:'Llogaria ime',skip:'Kalo te përmbajtja',mainNav:'Navigimi kryesor',breadcrumb:'Vendndodhja në faqe',language:'Gjuha',searchLabel:'Kërko destinacionin',searchPlaceholder:'Ku po udhëton?',
  from:'Nga',fromRegional:'Paketa rajonale nga',day:'ditë',days:'ditë',hour:'orë',hours:'orë',seeDetails:'Shiko detajet',plan:'1 paketë',plans:'{n} paketa',showMore:'Shfaq më shumë',viewPlan:'Shiko paketën',coveredOne:'1 shtet i mbuluar',covered:'{n} shtete të mbuluara',calls:'Thirrje',kyc:'Kërkon verifikim identiteti',
  filters:'Filtro paketat',alsoCovers:'Mbulon edhe',minData:'Internet minimal',minDays:'Vlefshmëria minimale',maxPrice:'Çmimi maksimal',provider:'Ofruesi',all:'Të gjitha',clearFilters:'Pastro filtrat',sortBy:'Rendit sipas',sortPrice:'Çmimi më i ulët',sortData:'Më shumë GB',sortDays:'Vlefshmëria më e gjatë',removeFilter:'Hiq filtrin',noPlans:'Nuk u gjetën paketa me këto filtra. Provo të heqësh disa filtra.',
  hubTitle:'Destinacionet eSIM: shtete, rajone dhe paketa globale · MOBIALO',hubDescription:'Paketa interneti eSIM për udhëtim në {n} shtete, si dhe paketa rajonale dhe globale. Çmimet në EUR përfshijnë kostot e përpunimit; pagesa përmes PayPal dhe kodi QR me email.',hubHeading:'eSIM për çdo destinacion',hubIntro:'Gjej shtetin, një rajon ose një paketë globale. Çmimet në EUR përfshijnë kostot e përpunimit, pagesa bëhet përmes PayPal dhe kodi QR vjen me email.',countries:'Shtetet',regions:'Rajonet',globalPlans:'eSIM globale',noResults:'Nuk u gjet destinacioni. Provo një shtet ose rajon tjetër.',resultsOne:'1 destinacion i gjetur',results:'{n} destinacione të gjetura',
  countryHeading:'eSIM {name}',countryTitle:'{name}: paketa eSIM për udhëtim · MOBIALO',countryDescription:'Destinacioni {name}: {plans} eSIM nga {price}. Çmimet në EUR përfshijnë kostot e përpunimit, pagesa përmes PayPal dhe kodi QR me email.',destinationIntro:'Zgjidh internetin dhe vlefshmërinë që i përshtaten udhëtimit, paguaj përmes PayPal dhe merr kodin QR të eSIM-it me email.',regionalNote:'Nuk ka paketë vetëm për këtë shtet. Këto paketa rajonale e përfshijnë.',regionIntro:'Çdo paketë mbulon disa shtete me një eSIM. Kontrollo shtetet e mbuluara të paketës para blerjes.',regionCountries:'Shtetet që mbulojnë këto paketa',
  headingTitle:'{heading}: paketa interneti për udhëtim · MOBIALO',headingDescription:'{heading}: {plans} nga {price}. Çmimet në EUR përfshijnë kostot e përpunimit, pagesa përmes PayPal dhe kodi QR me email.',descPlanOne:'1 paketë interneti',descPlans:'{n} paketa interneti',
  facts:'Në këtë faqe: {plans} nga {providers}, me vlefshmëri {validity}.',factsNoValidity:'Në këtë faqe: {plans} nga {providers}.',providerOne:'1 ofrues',providers:'{n} ofrues',validityOne:'{min}',validityRange:'nga {min} deri në {max}',
  planTitle:'{plan} · eSIM {name} · MOBIALO',planHeadingTitle:'{plan} · {heading} · MOBIALO',planDescription:'{plan}: {data}, {validity}, {price}. Paketë eSIM nga {provider}, destinacioni {name}. Pagesa përmes PayPal, kodi QR me email.',planHeadingDescription:'{plan}: {data}, {validity}, {price}. Paketë {heading} nga {provider}. Pagesa përmes PayPal, kodi QR me email.',data:'Internet',validity:'Vlefshmëria',total:'Çmimi përfundimtar',payment:'Pagesa',coverage:'Shtetet e mbuluara',fullInfo:'Informacioni i plotë i paketës',kycPlan:'Kjo paketë kërkon verifikim identiteti.',
  details:'Detajet e eSIM-it',esimType:'Lloji i eSIM-it',dataOnly:'Internet · pa thirrje/SMS',servicesBelow:'Shiko shërbimet më poshtë',network:'Rrjeti · 4G / 5G',speed:'Shpejtësia',activation:'Aktivizimi',included:'Përfshihet',notIncluded:'Nuk përfshihet',unspecified:'Nuk specifikohet',networkNote:'4G/5G tregon teknologjinë e rrjetit, jo shpejtësi të garantuar. Disponueshmëria varet nga vendndodhja, pajisja dhe operatori.',
  loadingPayment:'Po ngarkohen mënyrat e pagesës…',noScriptPayment:'Aktivizo JavaScript për të paguar me PayPal ose me kartë.',notLive:'Kontrollo mbulimin, përshtatshmërinë dhe kushtet e aktivizimit para pagesës.',previewNote:'Çmimet përfshijnë kostot e përpunimit. Asnjë tarifë nuk shtohet në pagesë.',savedCatalog:'Çmime nga një katalog i ruajtur. Katalogu i përditësuar nuk është i disponueshëm për momentin.',closed:'Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.',trustPay:'Pagesë e sigurt përmes PayPal',trustQr:'Kodi QR me email pas pagesës',trustHelp:'Ndihmë:',trustPolicy:'Politika e dërgesës dhe rimbursimit',device:'A e mbështet telefoni im eSIM-in?',
  alsoIn:'Kjo faqe është edhe në shqip →',notFoundTitle:'Faqja nuk u gjet',notFoundText:'Kjo faqe nuk ekziston ose është zhvendosur.',goHome:'Shko te faqja kryesore',findEsim:'Gjej eSIM-in tënd',helpEmail:'Ndihmë: support@mobialo.eu',unavailableTitle:'Katalogu nuk është i disponueshëm',unavailableText:'Katalogu nuk u ngarkua. Provo përsëri.',retry:'Provo përsëri',
  footerTag:'Zbulo vende. Qëndro i lidhur.',explore:'Eksploro',support:'Mbështetje',deviceGuide:'Përputhshmëria e telefonit',about:'Rreth nesh',previewStore:'Pagesë e sigurt përmes PayPal',operator:'MOBIALO administrohet nga iSmart Shop & Service (NIPT L71614008L), Tiranë, Shqipëri.'},
 it:{home:'Home',destinations:'Destinazioni',how:'Come funziona',why:'Perché MOBIALO',help:'Centro assistenza',signIn:'Accedi',myAccount:'Il mio account',skip:'Vai al contenuto',mainNav:'Navigazione principale',breadcrumb:'Percorso',language:'Lingua',searchLabel:'Cerca una destinazione',searchPlaceholder:'Dove vuoi andare?',
  from:'Da',fromRegional:'Piani regionali da',day:'giorno',days:'giorni',hour:'ora',hours:'ore',seeDetails:'Vedi dettagli',plan:'1 piano',plans:'{n} piani',showMore:'Mostra di più',viewPlan:'Vedi piano',coveredOne:'1 paese coperto',covered:'{n} paesi coperti',calls:'Chiamate',kyc:'Verifica dell’identità richiesta',
  filters:'Filtra piani',alsoCovers:'Copre anche',minData:'Dati minimi',minDays:'Validità minima',maxPrice:'Prezzo massimo',provider:'Fornitore',all:'Tutti',clearFilters:'Cancella filtri',sortBy:'Ordina per',sortPrice:'Prezzo più basso',sortData:'Più dati',sortDays:'Validità più lunga',removeFilter:'Rimuovi filtro',noPlans:'Nessun piano corrispondente. Prova a rimuovere alcuni filtri.',
  hubTitle:'Destinazioni eSIM: paesi, regioni e piani globali · MOBIALO',hubDescription:'Piani dati eSIM da viaggio per {n} paesi, oltre a piani regionali e globali. I prezzi in EUR includono i costi di elaborazione; pagamento tramite PayPal e codice QR via email.',hubHeading:'eSIM per ogni destinazione',hubIntro:'Trova il tuo paese, una regione o un piano globale. I prezzi in EUR includono i costi di elaborazione, il pagamento avviene tramite PayPal e il codice QR arriva via email.',countries:'Paesi',regions:'Regioni',globalPlans:'eSIM globale',noResults:'Nessuna destinazione trovata. Prova un altro paese o una regione.',resultsOne:'1 destinazione trovata',results:'{n} destinazioni trovate',
  countryHeading:'eSIM {name}',countryTitle:'{name}: piani eSIM da viaggio · MOBIALO',countryDescription:'Destinazione {name}: {plans} eSIM da {price}. I prezzi in EUR includono i costi di elaborazione, pagamento tramite PayPal e codice QR via email.',destinationIntro:'Scegli i dati e la validità adatti al tuo viaggio, paga tramite PayPal e ricevi il codice QR della eSIM via email.',regionalNote:'Non ci sono piani solo per questo paese. Questi piani regionali lo includono.',regionIntro:'Ogni piano copre più paesi con una sola eSIM. Controlla i paesi coperti dal piano prima di acquistare.',regionCountries:'Paesi coperti da questi piani',
  headingTitle:'{heading}: piani dati da viaggio · MOBIALO',headingDescription:'{heading}: {plans} da {price}. I prezzi in EUR includono i costi di elaborazione, pagamento tramite PayPal e codice QR via email.',descPlanOne:'1 piano dati',descPlans:'{n} piani dati',
  facts:'In questa pagina: {plans} di {providers}, con validità {validity}.',factsNoValidity:'In questa pagina: {plans} di {providers}.',providerOne:'1 fornitore',providers:'{n} fornitori',validityOne:'di {min}',validityRange:'da {min} a {max}',
  planTitle:'{plan} · eSIM {name} · MOBIALO',planHeadingTitle:'{plan} · {heading} · MOBIALO',planDescription:'{plan}: {data}, {validity}, {price}. Piano eSIM di {provider}, destinazione {name}. Pagamento tramite PayPal, codice QR via email.',planHeadingDescription:'{plan}: {data}, {validity}, {price}. Piano {heading} di {provider}. Pagamento tramite PayPal, codice QR via email.',data:'Dati',validity:'Validità',total:'Prezzo totale',payment:'Pagamento',coverage:'Paesi coperti',fullInfo:'Informazioni complete',kycPlan:'Questo piano richiede la verifica dell’identità.',
  details:'Dettagli eSIM',esimType:'Tipo di eSIM',dataOnly:'Dati · senza chiamate/SMS',servicesBelow:'Vedi i servizi inclusi',network:'Rete · 4G / 5G',speed:'Velocità',activation:'Attivazione',included:'Incluso',notIncluded:'Non incluso',unspecified:'Non specificato',networkNote:'4G/5G indica la tecnologia di rete, non una velocità garantita. La disponibilità dipende da posizione, dispositivo e operatore.',
  loadingPayment:'Caricamento dei metodi di pagamento…',noScriptPayment:'Attiva JavaScript per pagare con PayPal o con carta.',notLive:'Verifica copertura, compatibilità e condizioni di attivazione prima di pagare.',previewNote:'I prezzi includono i costi di elaborazione. Nessun costo aggiuntivo al pagamento.',savedCatalog:'Prezzi da un catalogo salvato. Il catalogo aggiornato non è disponibile al momento.',closed:'Gli acquisti sono temporaneamente non disponibili. Riprova tra qualche minuto.',trustPay:'Pagamento sicuro tramite PayPal',trustQr:'Codice QR via email dopo il pagamento',trustHelp:'Assistenza:',trustPolicy:'Politica di consegna e rimborso',device:'Il mio telefono supporta eSIM?',
  alsoIn:'Questa pagina è anche in italiano →',notFoundTitle:'Pagina non trovata',notFoundText:'Questa pagina non esiste o è stata spostata.',goHome:'Vai alla home page',findEsim:'Trova la tua eSIM',helpEmail:'Assistenza: support@mobialo.eu',unavailableTitle:'Catalogo non disponibile',unavailableText:'Impossibile caricare il catalogo. Riprova.',retry:'Riprova',
  footerTag:'Esplora. Resta connesso.',explore:'Esplora',support:'Assistenza',deviceGuide:'Compatibilità del dispositivo',about:'Chi siamo',previewStore:'Pagamento sicuro tramite PayPal',operator:'MOBIALO è gestito da iSmart Shop & Service (NIPT L71614008L), Tirana, Albania.'}
};
const copy=lang=>COPY[lang]||COPY.en;
const fill=(text,values={})=>String(text).replace(/\{(\w+)\}/g,(_,key)=>values[key]??'');

// Names come from the tables in country-names.js (identical in every runtime), with ICU only for a code they lack.
const displayNames={};
const icuName=(code,lang)=>{try{return (displayNames[lang]??=new Intl.DisplayNames([lang],{type:'region'})).of(code)||code;}catch{return code;}};
const nameTable=lang=>lang==='sq'?(typeof albanianCountries==='object'?albanianCountries:null):lang==='it'?(typeof italianCountries==='object'?italianCountries:null):(typeof englishCountries==='object'?englishCountries:null);
const countryName=(code,lang='en')=>nameTable(lang)?.[code]||icuName(code,lang);
// A supplier code with no name anywhere (MobiMatter's 'KT') is no destination and is left out of every covered-country
// list and count: a bare code means nothing to a buyer, and no name is made up for it.
const hasCountryName=code=>Boolean(nameTable('en')?.[code])||icuName(code,'en')!==code;
const coveredCodes=plan=>plan.countries.filter(hasCountryName);
// /esim/{slug}: the English name of the ISO code as a slug (US -> united-states). The table's slugs are unique (tested);
// a code the table lacks takes its ICU name, with '-{code}' appended when that slug already belongs to a table entry.
let tableSlugs=null;
function countrySlug(code){
 if(!tableSlugs){tableSlugs=new Map();const table=nameTable('en')||{};for(const key of Object.keys(table))tableSlugs.set(key,slugify(table[key])||key.toLowerCase());tableSlugs.taken=new Set(tableSlugs.values());}
 if(tableSlugs.has(code))return tableSlugs.get(code);
 const base=slugify(icuName(code,'en'))||code.toLowerCase();
 return tableSlugs.taken.has(base)?base+'-'+code.toLowerCase():base;
}
const regionNames={
 sq:{Europe:'Evropë',Asia:'Azi',Africa:'Afrikë',America:'Amerika','North America':'Amerika e Veriut','South America':'Amerika e Jugut','Middle East':'Lindja e Mesme',Oceania:'Oqeania',Caribbean:'Karaibet',Balkans:'Ballkani',Global:'Globale','Multi-country':'Disa shtete'},
 it:{Europe:'Europa',Asia:'Asia',Africa:'Africa',America:'America','North America':'America del Nord','South America':'America del Sud','Middle East':'Medio Oriente',Oceania:'Oceania',Caribbean:'Caraibi',Balkans:'Balcani',Global:'Globale','Multi-country':'Più paesi'}
};
const regionName=(label,lang)=>regionNames[lang]?.[label]||label;
// Headings that read better than '{name} eSIM' for the two labels that are not places; their page titles and
// descriptions are built from them too (storefront-pages.mjs).
const regionHeadings={global:{en:'Global eSIM',sq:'eSIM globale',it:'eSIM globale'},'multi-country':{en:'Multi-country eSIM',sq:'eSIM për disa shtete',it:'eSIM per più paesi'}};
const aliases={US:'USA America',GB:'UK England Angli Britain',AE:'Dubai UAE',TR:'Turkey Turqi Turchia',CZ:'Czech Republic',MK:'Macedonia',KR:'Korea',CI:'Ivory Coast',NL:'Holland',VA:'Vatican'};

// Only instant eSIMs without identity checks can be bought online, so only they are listed and counted.
const purchasable=product=>product?.category==='esim_realtime'&&!product.requiresIdentityVerification;
const isGlobal=product=>GLOBAL.test(product.title)||product.regions.some(region=>GLOBAL.test(region));
const byPrice=(a,b)=>a.price-b.price||a.title.localeCompare(b.title);
const regionRank=slug=>{const index=REGION_ORDER.indexOf(slug);return index<0?REGION_ORDER.length:index;};
// Countries (one per covered code with a name), regions (MobiMatter's region labels; 'America' and 'Americas' are one,
// multi-country plans without a label are 'Multi-country') and Global. Labels whose slugs collide are one region; a label that
// names the world is part of Global. World plans list continents among their regions, so they stay on Global and on the
// countries they cover: on every continent they would make all region pages alike. Every destination carries its slug,
// names in the three languages and its plans by price.
function buildDestinations(products){
 const countries=new Map(),regions=new Map(),globalPlans=[];
 for(const product of products){
  if(!purchasable(product))continue;
  for(const code of coveredCodes(product)){if(!countries.has(code))countries.set(code,[]);countries.get(code).push(product);}
  if(coveredCodes(product).length<2)continue;
  if(isGlobal(product)){globalPlans.push(product);continue;}
  const slugs=new Set();
  for(const raw of product.regions.length?product.regions:['Multi-country']){
   const label=raw==='Americas'?'America':raw,slug=slugify(label)||'region';
   if(GLOBAL.test(label)||slug==='global'||slugs.has(slug))continue;
   slugs.add(slug);if(!regions.has(slug))regions.set(slug,{label,plans:[]});regions.get(slug).plans.push(product);
  }
 }
 // A country's 'from' price uses the plans for that country alone; without one, its cheapest regional plan, flagged.
 const fromPrice=items=>{const own=items.filter(p=>coveredCodes(p).length===1);return {price:Math.min(...(own.length?own:items).map(p=>p.price)),regionalPrice:!own.length};};
 const taken=new Set(),destinations=[];
 for(const code of [...countries.keys()].sort()){
  let slug=countrySlug(code);if(taken.has(slug))slug+='-'+code.toLowerCase();taken.add(slug);
  const items=countries.get(code);
  destinations.push({kind:'country',type:'local',id:code.toLowerCase(),code,slug,en:countryName(code,'en'),sq:countryName(code,'sq'),it:countryName(code,'it'),aliases:aliases[code]||'',...fromPrice(items),plans:[...items].sort(byPrice)});
 }
 const preferred=['al','tr','us','it','de','jp','gb','fr','ae'];
 destinations.sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi)||a.en.localeCompare(b.en);});
 for(const [slug,{label,plans}] of [...regions].sort(([a],[b])=>regionRank(a)-regionRank(b)||a.localeCompare(b)))
  destinations.push({kind:'region',type:'regional',id:'region-'+slug,slug,label,en:label,sq:regionName(label,'sq'),it:regionName(label,'it'),aliases:'',price:Math.min(...plans.map(p=>p.price)),plans:[...plans].sort(byPrice)});
 if(globalPlans.length)destinations.push({kind:'global',type:'global',id:'global',slug:'global',label:'Global',en:'Global',sq:'Globale',it:'Globale',aliases:'World Worldwide Bota Mondo',price:Math.min(...globalPlans.map(p=>p.price)),plans:[...globalPlans].sort(byPrice)});
 return destinations;
}
// The page that stands for a product on its own (old /?plan= links): its country, Global for a world plan, else its first region.
function primaryDestination(product,destinations){
 const holds=destination=>destination.plans.some(plan=>plan.id===product.id);
 const covered=coveredCodes(product);
 if(covered.length===1)return destinations.find(d=>d.kind==='country'&&d.code===covered[0]&&holds(d))||null;
 return destinations.find(d=>d.kind==='global'&&isGlobal(product)&&holds(d))||destinations.find(d=>d.kind==='region'&&holds(d))||destinations.find(holds)||null;
}
const findDestination=(destinations,kind,slug)=>destinations.find(d=>(kind==='region'?d.kind!=='country':d.kind==='country')&&d.slug===slug)||null;

// URLs: English without a prefix, Albanian and Italian under /sq and /it.
const prefix=lang=>lang==='sq'||lang==='it'?'/'+lang:'';
const localPath=(lang,path)=>prefix(lang)+path;
const hubPath=lang=>localPath(lang,'/esim');
const destinationPath=(lang,destination)=>hubPath(lang)+(destination.kind==='country'?'/':'/region/')+destination.slug;
const planPath=(lang,destination,product)=>destinationPath(lang,destination)+'/'+encodeURIComponent(product.id);

// Albanian is written out by hand: browsers without Albanian ICU data (desktop Chrome) would print '€4.51', the server
// prints '4,51 €'. This is the CLDR form (no-break spaces; digits grouped from five on). EN and IT come from Intl.
const formats={};
const albanianMoney=value=>{const [whole,cents]=Math.abs(value).toFixed(2).split('.');return (value<0?'-':'')+(whole.length>4?whole.replace(/\B(?=(\d{3})+$)/g,' '):whole)+','+cents+' €';};
const money=(value,lang)=>lang==='sq'?albanianMoney(Number(value)):(formats[lang]??=new Intl.NumberFormat(lang==='it'?'it-IT':'en-IE',{style:'currency',currency:'EUR'})).format(value);
const dataFor=(plan,lang)=>plan.dataAmount&&plan.dataUnit?`${plan.dataAmount} ${plan.dataUnit}`:copy(lang).seeDetails;
const durationFor=(plan,lang)=>{
 const hours=plan.validityHours,c=copy(lang);if(!hours)return c.seeDetails;
 const [n,one,many]=hours%24===0?[hours/24,c.day,c.days]:[hours,c.hour,c.hours];
 return `${n} ${n===1?one:many}`;
};
const plansLabel=(n,lang)=>n===1?copy(lang).plan:fill(copy(lang).plans,{n});
const coverageLabel=(n,lang)=>n===1?copy(lang).coveredOne:fill(copy(lang).covered,{n});
const resultsLabel=(n,lang)=>n===1?copy(lang).resultsOne:fill(copy(lang).results,{n});
// A country without a plan of its own shows its cheapest regional plan, labelled as such.
const fromLabel=(destination,lang)=>copy(lang)[destination.regionalPrice?'fromRegional':'from'];
const ownHeading=destination=>destination.kind!=='country'&&Object.prototype.hasOwnProperty.call(regionHeadings,destination.slug);
const destinationHeading=(destination,lang)=>(ownHeading(destination)&&regionHeadings[destination.slug][lang])||fill(copy(lang).countryHeading,{name:destination[lang]});
// Prefix matches in the current language first, then word prefixes in any language, then any substring.
function searchRank(destination,term,lang){
 if(normalize(destination[lang]||'').startsWith(term))return 0;
 const names=normalize(`${destination.en} ${destination.sq} ${destination.it||''} ${destination.aliases||''}`);
 return names.split(/[^a-z0-9]+/).some(word=>word.startsWith(term))?1:names.includes(term)?2:-1;
}

// region-icons.js draws one icon per region; this globe is only the fallback when that script did not load.
const GLOBE='<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9s1.2-6.4 3.7-9z"/></svg>';
const regionIcon=label=>{let svg='';try{svg=typeof globalThis.MobialoRegionIcon==='function'?String(globalThis.MobialoRegionIcon(label)||''):'';}catch{}return /^<svg[\s>]/.test(svg)&&!/<script|\son\w+=|javascript:/i.test(svg)?svg:GLOBE;};
const flag=destination=>`<span class="flag${destination.kind==='country'?'':' region-icon'}" aria-hidden="true">${destination.kind==='country'?`<img src="https://flagcdn.com/w80/${escape(destination.id)}.png" alt="" width="30" height="22" loading="lazy">`:regionIcon(destination.label)}</span>`;
const destinationCard=(destination,lang,attributes='')=>`<a class="destination-card" href="${escape(destinationPath(lang,destination))}"${attributes}>${flag(destination)}<div><h3>${escape(destination[lang])}</h3><p>${escape(fromLabel(destination,lang))} <b>${escape(money(destination.price,lang))}</b></p></div><span class="card-arrow" aria-hidden="true">→</span></a>`;
const providerBrand=plan=>`<div class="provider-brand">${plan.providerLogo?`<img src="${escape(plan.providerLogo)}" alt="" width="64" height="38" loading="lazy" referrerpolicy="no-referrer">`:''}<span>${escape(plan.provider)}</span></div>`;
const badges=(plan,lang)=>[plan.features?.network&&/\b5G\b/i.test(plan.features.network)?'5G':null,plan.features?.hotspot===true?'Hotspot':null,plan.features?.calls===true?copy(lang).calls:null].filter(Boolean).map(text=>`<span>${escape(text)}</span>`).join('');
// One compact row of a destination page: plan facts on the left, price and "View plan" on the right. The title link
// covers the whole card; data-* carries what the filters compare. On a country page a plan for that country alone needs
// no "1 covered country".
const planCard=(plan,destination,lang,hidden=false)=>{
 const tags=badges(plan,lang),covered=coveredCodes(plan),alone=destination.kind==='country'&&covered.length===1&&covered[0]===destination.code;
 const meta=(tags?`<span class="shop-badges">${tags}</span>`:'')+(alone?'':`<span class="shop-coverage">${escape(coverageLabel(covered.length,lang))}</span>`);
 return `<li class="shop-card" data-price="${escape(plan.price)}" data-provider="${escape(plan.provider)}" data-countries="${escape(plan.countries.join(' '))}" data-amount="${escape(plan.dataAmount??'')}" data-unit="${escape(plan.dataUnit??'')}" data-hours="${escape(plan.validityHours??'')}"${hidden?' hidden':''}><div class="shop-card-main">${providerBrand(plan)}<h3><a href="${escape(planPath(lang,destination,plan))}">${escape(plan.title)}</a></h3><p class="shop-allowance"><strong>${escape(dataFor(plan,lang))}</strong><span>${escape(durationFor(plan,lang))}</span></p>${meta?`<p class="shop-meta">${meta}</p>`:''}${plan.requiresIdentityVerification?`<small class="kyc-note">${escape(copy(lang).kyc)}</small>`:''}</div><div class="shop-card-bottom"><strong>${escape(money(plan.price,lang))}</strong><span class="button" aria-hidden="true">${escape(copy(lang).viewPlan)} →</span></div></li>`;
};

return {LANGUAGES,ORIGIN,PAGE_SIZE,COPY,copy,fill,escape,normalize,slugify,countryName,hasCountryName,coveredCodes,countrySlug,regionName,purchasable,isGlobal,buildDestinations,primaryDestination,findDestination,
 localPath,hubPath,destinationPath,planPath,money,dataFor,durationFor,plansLabel,coverageLabel,resultsLabel,fromLabel,ownHeading,destinationHeading,searchRank,regionIcon,flag,destinationCard,providerBrand,badges,planCard};
})();
