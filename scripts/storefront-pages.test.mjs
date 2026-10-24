import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import handler from '../api/store.mjs';
import {createStorefront,loadStorefront,routeFromPath,routeFromQuery} from './storefront-pages.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
// Product ids are UUIDs, like every MobiMatter id (the routes refuse anything else): uid('al-small') is stable and unique.
const uid=name=>{const hex=[...name].map(char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('').padEnd(32,'0').slice(0,32);return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');};
const product=(name,extra={})=>({id:uid(name),category:'esim_realtime',requiresIdentityVerification:false,provider:'Sparks',providerLogo:null,title:name,price:5,currency:'EUR',countries:['AL'],regions:[],dataAmount:'1',dataUnit:'GB',validityHours:168,
  features:{data:true,calls:false,sms:false,hotspot:true,network:'5G/4G',speed:null,activation:null,phonePrefix:null},details:{heading:'',description:'',items:[]},updated:'',...extra});
const catalog=products=>({source:'mobimatter',fetchedAt:'2026-10-22T00:00:00.000Z',products});
// Region icons come from dist/region-icons.js (another builder); a stub with one icon per label stands in for it here.
const icons=label=>`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor" data-icon="${String(label).replace(/[^A-Za-z-]/g,'')}"><circle cx="12" cy="12" r="9"/></svg>`;
function site(){const context=loadStorefront();context.MobialoRegionIcon=icons;return createStorefront(context);}
const shop=site(),S=shop.S;
// Prices are formatted with a no-break space before the euro sign ('3,50 €'); the assertions use a plain space.
const spaces=text=>typeof text==='string'?text.replace(new RegExp(String.fromCharCode(160),'g'),' '):text;
const plain=value=>JSON.parse(JSON.stringify(value));
// '{al-small}' in a path stands for that product's id.
const at=path=>path.replace(/\{([\w -]+)\}/g,(_,name)=>uid(name));
const page=(path,body)=>{const url=new URL(at(path),'https://www.mobialo.eu'),result=shop.render(routeFromPath(url.pathname,url.search),body);return {...result,body:spaces(result.body)};};
const sitemapOf=body=>shop.render({page:'sitemap',lang:'en'},body).body;
const fixture=catalog([
  product('al-small',{title:'Albania 1 GB',price:3.5,countries:['AL']}),
  product('al-big',{title:'Albania 10 GB',price:12,countries:['AL'],dataAmount:'10'}),
  product('balkans',{title:'Balkans 5 GB',price:2.99,countries:['AL','XK','ME'],regions:['Europe']}),
  product('europe',{title:'Europe 3 GB',price:6,countries:['AL','IT','FR'],regions:['Europe']}),
  product('world',{title:'Global 1 GB',price:9,countries:['AL','US','JP'],regions:['Europe','Asia','America']}),
  product('gulf',{title:'Gulf 2 GB',price:7,countries:['AE','SA'],regions:['Middle East']}),
  product('kyc',{title:'Montenegro KYC',category:'esim_delayed',requiresIdentityVerification:true,countries:['ME']})
]);

test('slugs: the English name of the ISO code, lowercase ASCII words joined by "-", stable and unique',()=>{
  for(const [code,slug] of [['AL','albania'],['US','united-states'],['GB','united-kingdom'],['AE','united-arab-emirates'],['TR','turkiye'],['BA','bosnia-and-herzegovina'],['CI','cote-divoire'],['VI','us-virgin-islands'],['KN','st-kitts-and-nevis'],['RE','reunion'],['XK','kosovo'],['HK','hong-kong']])assert.equal(S.countrySlug(code),slug,code);
  assert.equal(S.slugify('São Tomé & Príncipe'),'sao-tome-and-principe');assert.equal(S.slugify('  Middle  East! '),'middle-east');assert.equal(S.slugify('<script>'),'script');
  // Every code of the name table has its own slug.
  const context=loadStorefront(),codes=vm.runInContext('Object.keys(englishCountries)',context),slugs=codes.map(code=>context.MobialoStorefront.countrySlug(code));
  assert.ok(codes.length>240);assert.equal(new Set(slugs).size,slugs.length);
  for(const slug of slugs)assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  // A code the table lacks never takes a table slug: it gets its code appended.
  assert.equal(S.countrySlug('UK'),'united-kingdom-uk');
});

test('grouping: countries, regions (labels with one slug are one region, Americas is America) and Global; slugs unique across the real catalog',async()=>{
  const destinations=shop.destinationsFor(catalog([
    product('a',{countries:['US','CA'],regions:['America','Americas']}),product('b',{countries:['AE','SA'],regions:['Middle East']}),product('c',{countries:['QA','OM'],regions:['Middle-East']}),
    product('World 5 GB',{countries:['AL','US'],regions:['Global']}),product('e',{countries:['GB'],price:4}),product('f',{countries:['UK'],price:4})]));
  const regions=plain(destinations.filter(d=>d.kind==='region').map(d=>[d.slug,d.plans.map(p=>p.title).join()]));
  assert.deepEqual(regions,[['america','a'],['middle-east','b,c']]);
  assert.deepEqual(plain(destinations.filter(d=>d.kind==='global').map(d=>[d.slug,d.plans.map(p=>p.title).join()])),[['global','World 5 GB']]);
  assert.deepEqual(['GB','UK'].map(code=>destinations.find(d=>d.code===code).slug),['united-kingdom','united-kingdom-uk']);
  const real=shop.destinationsFor(JSON.parse(await read('dist/catalog-preview.json')));
  for(const kind of ['country','region']){const slugs=real.filter(d=>(kind==='country')===(d.kind==='country')).map(d=>d.slug);assert.equal(new Set(slugs).size,slugs.length,kind);}
  assert.ok(real.filter(d=>d.kind==='country').length>150);assert.ok(real.some(d=>d.slug==='multi-country'));
});

test('world plans live on Global and on the countries they cover, never on a continent: region pages differ',async()=>{
  const body=catalog([product('Discover Global',{countries:['AL','IT','JP','US'],regions:['Europe','Asia','America'],price:9}),product('Europe 3 GB',{countries:['AL','IT'],regions:['Europe'],price:6}),product('Japan 1 GB',{countries:['JP'],price:4})]);
  const destinations=shop.destinationsFor(body),plans=slug=>destinations.find(d=>d.slug===slug).plans.map(p=>p.title);
  assert.deepEqual(plain(plans('europe')),['Europe 3 GB']);assert.deepEqual(plain(plans('global')),['Discover Global']);
  assert.equal(destinations.some(d=>['asia','america'].includes(d.slug)),false);
  assert.deepEqual(plain(plans('japan')),['Japan 1 GB','Discover Global']);assert.deepEqual(plain(plans('albania')),['Europe 3 GB','Discover Global']);
  // The covered-country list of a region reflects only its own plans.
  const europe=page('/esim/region/europe',body).body;
  assert.match(europe,/<h2>Countries covered by these plans <span class="section-count">2<\/span><\/h2><ul class="country-links"><li><a href="\/esim\/albania">Albania<\/a><\/li><li><a href="\/esim\/italy">Italy<\/a><\/li><\/ul>/);
  assert.match(page('/esim/region/global',body).body,/<span class="section-count">4<\/span><\/h2><ul class="country-links">/);
  // Across the live-sized snapshot: every continent region has fewer covered countries than Global.
  const real=shop.destinationsFor(JSON.parse(await read('dist/catalog-preview.json'))),count=d=>new Set(d.plans.flatMap(S.coveredCodes)).size;
  const global=real.find(d=>d.kind==='global');
  for(const region of real.filter(d=>d.kind==='region'&&d.slug!=='multi-country'))assert.ok(count(region)<count(global),region.slug);
  for(const region of real.filter(d=>d.kind==='region'))assert.equal(region.plans.some(S.isGlobal),false,region.slug);
});

test('a supplier code without a name (MobiMatter KT) is no destination and no covered country; its plans stay on the named countries',async()=>{
  const body=catalog([product('Turkey Premium',{countries:['TR','KT'],regions:['Europe'],price:8}),product('Turkey 1 GB',{countries:['TR'],price:3}),product('KT only',{countries:['KT'],price:2}),product('Europe 5 GB',{countries:['TR','GR'],regions:['Europe'],price:9})]);
  const destinations=shop.destinationsFor(body);
  assert.equal(destinations.some(d=>d.code==='KT'||d.slug==='kt'),false);
  assert.deepEqual(plain(destinations.find(d=>d.code==='TR').plans.map(p=>p.title)),['Turkey 1 GB','Turkey Premium','Europe 5 GB']);
  assert.equal(page('/esim/kt',body).status,404);
  const turkey=page('/esim/turkiye',body).body,plan=page('/esim/turkiye/'+uid('Turkey Premium'),body).body,europe=page('/esim/region/europe',body).body;
  for(const html of [turkey,plan,europe,page('/esim',body).body,page('/sq/esim',body).body])assert.doesNotMatch(html,/>KT<|"KT"|data-en="KT"|\/esim\/kt"|Covered countries \(2\)/);
  assert.match(plan,/<summary>Covered countries \(1\)<\/summary><ul class="purchase-country-grid"><li>Türkiye<\/li><\/ul>/);
  // It covers one named country, so it is a Türkiye plan and not a regional one.
  assert.doesNotMatch(europe,/Turkey Premium/);assert.match(europe,/Europe 5 GB/);assert.doesNotMatch(europe,/<option value="KT">/);
  assert.doesNotMatch(sitemapOf(body),/\/esim\/kt</);
  // No destination of the real catalogs is named by its bare code in any language.
  const live=JSON.parse(await read('dist/catalog-preview.json'));live.products.push({...live.products.find(p=>p.countries.includes('TR')&&S.purchasable(p)),id:uid('kt-check'),countries:['TR','KT']});
  for(const d of shop.destinationsFor(live).filter(d=>d.kind==='country'))for(const lang of S.LANGUAGES)assert.notEqual(d[lang],d.code,d.code+' '+lang);
});

test('routes: public paths and the vercel.json query rewrites describe the same pages',async()=>{
  const id=uid('abc'),upper=uid('abc').toUpperCase();
  assert.deepEqual(routeFromPath('/esim'),{page:'hub',lang:'en',kind:'country',slug:'',product:'',q:''});
  assert.deepEqual(routeFromPath('/sq/esim/albania'),{page:'country',lang:'sq',kind:'country',slug:'albania',product:'',q:''});
  assert.deepEqual(routeFromPath('/it/esim/region/europe/'+id),{page:'plan',lang:'it',kind:'region',slug:'europe',product:id,q:''});
  assert.deepEqual(routeFromPath('/esim/albania/'+upper),{page:'plan',lang:'en',kind:'country',slug:'albania',product:upper,q:''});
  assert.equal(routeFromPath('/de/esim').page,'missing');assert.equal(routeFromPath('/esim/a/b/c').page,'missing');assert.equal(routeFromPath('/sitemap.xml').page,'sitemap');
  assert.deepEqual(routeFromQuery({page:'plan',kind:'region',lang:'sq',slug:'europe',product:id}),routeFromPath('/sq/esim/region/europe/'+id));
  assert.deepEqual(routeFromQuery({page:'hub',lang:'xx',q:['ital','x'],slug:'ignored',product:id}),{...routeFromPath('/esim'),q:'ital'});
  // A slug or product that cannot exist is a 404 route, without the requested text: lowercase ASCII slugs of 80
  // characters at most, UUID products.
  const missing={page:'missing',lang:'en',kind:'country',slug:'',product:'',q:''};
  for(const path of ['/esim/Albania','/esim/'+'a'.repeat(81),'/esim/albania/abc','/esim/albania/'+id+'x','/esim/al%20bania','/esim/%E0%A4%A','/esim/region/<b>','/esim/albania/'+'a'.repeat(20000)])assert.deepEqual(routeFromPath(path),missing,path.slice(0,40));
  assert.equal(routeFromPath('/esim/'+'a'.repeat(80)).page,'country');
  assert.deepEqual(routeFromQuery({page:'country',lang:'sq',slug:'x'.repeat(100)}),{...missing,lang:'sq'});assert.equal(routeFromQuery({page:'plan',slug:'albania',product:'1'}).page,'missing');
  assert.equal(routeFromQuery({page:'country',slug:''}).page,'missing');
  // Old /?plan= links and the warm-up.
  assert.deepEqual(routeFromQuery({page:'legacy',product:id}),{page:'legacy',lang:'en',kind:'country',slug:'',product:id,q:''});
  assert.deepEqual(routeFromQuery({page:'legacy',product:'not-a-plan'}),{page:'legacy',lang:'en',kind:'country',slug:'',product:'',q:''});
  assert.deepEqual(routeFromPath('/','?plan='+id),routeFromQuery({page:'legacy',product:id}));assert.equal(routeFromQuery({page:'warm'}).page,'warm');
  const vercel=JSON.parse(await read('vercel.json'));
  const rewrites=Object.fromEntries(vercel.rewrites.map(rule=>[rule.source,rule.destination]));
  for(const [source,destination] of Object.entries({'/esim':'/api/store?page=hub&lang=en','/:lang(sq|it)/esim/:slug':'/api/store?page=country&lang=:lang&slug=:slug','/esim/region/:slug/:product':'/api/store?page=plan&kind=region&lang=en&slug=:slug&product=:product','/sitemap.xml':'/api/store?page=sitemap','/devices':'/devices.html','/sq/devices':'/devices-sq.html','/it/devices':'/devices-it.html','/account/orders/:id':'/auth.html','/admin/orders/:id':'/admin.html'}))assert.equal(rewrites[source],destination,source);
  // The pre-rendered device pages answer at their language address only.
  const redirects=vercel.redirects.filter(rule=>!rule.has).map(rule=>[rule.source,rule.destination,rule.permanent]);
  for(const rule of [['/devices.html','/devices',true],['/devices-sq.html','/sq/devices',true],['/devices-it.html','/it/devices',true]])assert.ok(redirects.some(item=>JSON.stringify(item)===JSON.stringify(rule)),rule[0]);
  // Old /?plan= links: '/' is a static file (index.html), which Vercel serves before any rewrite, so a redirect (applied
  // before the files) sends them to the server, which answers with the plan page's address.
  const legacy=vercel.redirects.find(rule=>rule.source==='/'&&rule.has);
  assert.deepEqual(legacy,{source:'/',has:[{type:'query',key:'plan',value:'(?<plan>[^&]{1,100})'}],destination:'/api/store?page=legacy&product=:plan',permanent:false});
  // Region routes come before the generic /esim/:slug/:product, which would otherwise read "region" as a country.
  const order=vercel.rewrites.map(rule=>rule.source);
  assert.ok(order.indexOf('/esim/region/:slug')<order.indexOf('/esim/:slug/:product'));
  assert.match(vercel.functions['api/store.mjs'].includeFiles,/storefront-core\.js.*country-names\.js.*plan-translations\.js.*region-icons\.js.*catalog-filters\.js/);
  // A static sitemap would win over the rewrite.
  await assert.rejects(read('dist/sitemap.xml'),{code:'ENOENT'});
});

test('every file a vercel.json includeFiles glob names exists, so no function starts without its page code',async()=>{
  const {existsSync}=await import('node:fs'),vercel=JSON.parse(await read('vercel.json'));
  const expand=glob=>{const match=/^(.*)\{([^}]+)\}(.*)$/.exec(glob);return match?match[2].split(',').flatMap(part=>expand(match[1]+part+match[3])):[glob];};
  const files=Object.values(vercel.functions).flatMap(config=>config.includeFiles?expand(config.includeFiles):[]);
  assert.ok(files.length>=6);
  for(const file of files){assert.doesNotMatch(file,/[*?[]/,file);assert.ok(existsSync(new URL('../'+file,import.meta.url)),file);}
  // The page code loads every one of them (region-icons.js may still be missing locally; it is skipped then).
  for(const name of ['storefront-core.js','country-names.js','plan-translations.js','region-icons.js','catalog-filters.js'])assert.ok(files.includes('dist/'+name),name);
});

test('known pages render; an unknown slug, product or a product of another destination is a real 404 in the URL language',()=>{
  for(const path of ['/esim','/sq/esim','/it/esim','/esim/albania','/sq/esim/kosovo','/it/esim/region/europe','/esim/region/global','/esim/albania/{al-small}','/esim/albania/{balkans}','/sq/esim/region/europe/{balkans}','/it/esim/region/global/{world}','/esim/japan/{world}'])assert.equal(page(path,fixture).status,200,path);
  for(const path of ['/esim/atlantis','/esim/region/atlantis','/esim/albania/{missing}','/esim/united-arab-emirates/{al-small}','/esim/region/europe/{al-small}','/esim/region/global/{europe}','/esim/region/europe/{world}','/esim/montenegro/{kyc}','/esim/region','/esim/Albania','/esim/global','/esim/albania/al-small','/esim/'+'x'.repeat(200)]){
    const result=page(path,fixture);
    assert.equal(result.status,404,path);assert.match(result.body,/<meta name="robots" content="noindex">/);assert.doesNotMatch(result.body,/rel="canonical"/);
  }
  const missing=page('/sq/esim/atlantis',fixture).body;
  assert.match(missing,/<html lang="sq">/);assert.match(missing,/<h1>Faqja nuk u gjet<\/h1>/);assert.match(missing,/href="\/sq\/esim">Gjej eSIM-in tënd</);
  assert.match(page('/it/esim/atlantis',fixture).body,/<h1>Pagina non trovata<\/h1>/);
  // Montenegro has only an identity-verification plan, which cannot be bought online: no page.
  assert.equal(shop.destinationsFor(fixture).some(d=>d.code==='ME'&&d.plans.some(p=>p.id===uid('kyc'))),false);
  // A route that cannot exist renders without any catalog, and the 404 never repeats the requested text.
  const long=shop.render(routeFromPath('/sq/esim/'+'x'.repeat(5000)+'/'+'y'.repeat(5000)),null);
  assert.equal(long.status,404);assert.doesNotMatch(long.body,/xxxx|yyyy/);assert.ok(long.body.length<20000);assert.match(long.body,/<html lang="sq">/);
});

test('supplier text is escaped everywhere it is rendered: HTML, attributes, JSON-LD and the page data',()=>{
  const hostile='<img src=x onerror=alert(1)>"\'</script><script>alert(2)</script>';
  const body=catalog([product('evil-1',{title:hostile,provider:hostile,providerLogo:'https://cdn.example/logo.png?a="><script>',countries:['AL','IT'],regions:[hostile],
    features:{data:true,calls:false,sms:false,hotspot:null,network:hostile,speed:hostile,activation:hostile},details:{heading:hostile,description:hostile,items:[hostile]}}),product('al-1',{countries:['AL']})]);
  const region=shop.destinationsFor(body).find(d=>d.kind==='region');
  for(const path of ['/esim','/esim/albania','/esim/region/'+region.slug,'/esim/region/'+region.slug+'/{evil-1}','/sq/esim/albania/{evil-1}']){
    const html=page(path,body).body;
    assert.doesNotMatch(html,/<img src=x|<script>alert|"><script>|<\/script><script>/,path);
    for(const [,json] of html.matchAll(/<script type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)){assert.doesNotMatch(json,/</,path);JSON.parse(json);}
  }
  const plan=page('/esim/region/'+region.slug+'/{evil-1}',body).body;
  assert.match(plan,/<h1 id="plan-title">&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&lt;\/script&gt;/);
  assert.match(plan,/"name":"\\u003cimg src=x onerror=alert\(1\)>/);
});

test('every page has its language, a translated title naming the destination and eSIM, a self canonical, hreflang alternates and a breadcrumb',()=>{
  const albania=page('/sq/esim/albania',fixture).body;
  assert.match(albania,/<html lang="sq">/);assert.match(albania,/<title>Shqipëri: paketa eSIM për udhëtim · MOBIALO<\/title>/);
  assert.match(albania,/<meta name="description" content="Destinacioni Shqipëri: 5 paketa interneti eSIM nga 3,50 €\./);
  assert.match(albania,/<link rel="canonical" href="https:\/\/www\.mobialo\.eu\/sq\/esim\/albania">/);
  for(const [lang,href] of [['en','/esim/albania'],['sq','/sq/esim/albania'],['it','/it/esim/albania'],['x-default','/esim/albania']])assert.match(albania,new RegExp(`<link rel="alternate" hreflang="${lang}" href="https://www\\.mobialo\\.eu${href.replace(/\//g,'\\/')}">`));
  assert.doesNotMatch(albania,/name="robots"/);
  assert.match(albania,/<meta property="og:url" content="https:\/\/www\.mobialo\.eu\/sq\/esim\/albania"><meta property="og:locale" content="sq_AL">/);
  assert.match(albania,/<li><a href="\/">Kreu<\/a><\/li><li><a href="\/sq\/esim">Destinacionet<\/a><\/li><li><span aria-current="page">Shqipëri<\/span><\/li>/);
  const ld=html=>JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.deepEqual(ld(albania).map(node=>node['@type']),['BreadcrumbList']);
  assert.deepEqual(ld(albania)[0].itemListElement.map(item=>[item.position,item.name,item.item]),[[1,'Kreu','https://www.mobialo.eu/'],[2,'Destinacionet','https://www.mobialo.eu/sq/esim'],[3,'Shqipëri','https://www.mobialo.eu/sq/esim/albania']]);
  assert.match(page('/it/esim/region/europe',fixture).body,/<title>Europa: piani eSIM da viaggio · MOBIALO<\/title>/);
  assert.match(page('/esim/region/global',fixture).body,/<h1>Global eSIM<\/h1>/);
  assert.match(page('/esim',fixture).body,/<title>eSIM destinations: countries, regions and global plans · MOBIALO<\/title>/);
  // Plan pages: Product with an EUR Offer, only facts we have (no ratings or reviews), kept out of the index.
  const plan=page('/it/esim/albania/{al-small}',fixture).body,nodes=ld(plan),small=uid('al-small');
  assert.match(plan,/<meta name="robots" content="noindex, follow">/);assert.ok(plan.includes(`<link rel="canonical" href="https://www.mobialo.eu/it/esim/albania/${small}">`));
  assert.match(plan,/<title>Albania 1 GB · eSIM Albania · MOBIALO<\/title>/);
  assert.deepEqual(nodes.map(node=>node['@type']),['BreadcrumbList','Product']);
  assert.deepEqual(nodes[1].offers,{'@type':'Offer',url:'https://www.mobialo.eu/it/esim/albania/'+small,price:'3.50',priceCurrency:'EUR',seller:{'@type':'Organization',name:'MOBIALO',url:'https://www.mobialo.eu/'}});
  assert.equal(nodes[1].brand.name,'Sparks');assert.doesNotMatch(plan,/aggregateRating|"review"|ratingValue/);
  assert.equal(nodes[0].itemListElement.length,4);
});

test('destination pages: own plans first (the first plan is the "from" price), ten visible, "Show more" for the rest, cards are links to plan pages',()=>{
  const many=catalog([...Array.from({length:13},(_,i)=>product('al-'+i,{title:'Albania '+i,price:4+i,countries:['AL']})),product('cheap-region',{title:'Balkans',price:1,countries:['AL','XK'],regions:['Europe']})]);
  const html=page('/esim/albania',many).body;
  const cards=[...html.matchAll(/<li class="shop-card"([^>]*)>.*?<h3><a href="([^"]+)">([^<]+)<\/a>/g)];
  assert.equal(cards.length,14);
  assert.deepEqual(cards.slice(0,2).map(card=>card[3]),['Albania 0','Albania 1']);assert.equal(cards[13][3],'Balkans');
  assert.equal(cards.filter(card=>/ hidden$/.test(card[1])).length,4);assert.doesNotMatch(cards[9][1],/hidden/);assert.match(cards[10][1],/hidden/);
  assert.equal(cards[0][2],'/esim/albania/'+uid('al-0'));
  assert.match(html,/<span class="eyebrow">14 plans · From €4\.00<\/span><h1>Albania eSIM<\/h1><p class="dest-intro">Choose the data and validity that fit your trip, pay through PayPal and get your eSIM QR code by email\. On this page: 14 plans from 1 provider, valid for 7 days\.<\/p>/);
  // A plan for this country alone needs no "1 covered country"; the regional plan says how many it covers.
  const meta=[...html.matchAll(/<li class="shop-card"[^>]*>(.*?)<\/li>/g)].map(match=>(/<span class="shop-coverage">([^<]+)</.exec(match[1])||[])[1]||null);
  assert.deepEqual([meta[0],meta[13]],[null,'2 covered countries']);
  assert.doesNotMatch(page('/esim/albania',catalog([product('al-only',{countries:['AL'],features:{}})])).body,/<p class="shop-meta">/);
  assert.match(html,/<button type="button" id="show-more" class="button outline" aria-controls="plan-list" data-label="Show more">Show more \(4\)<\/button>/);
  assert.match(page('/sq/esim/albania',many).body,/data-label="Shfaq më shumë">Shfaq më shumë \(4\)</);assert.match(page('/it/esim/albania',many).body,/data-label="Mostra di più">Mostra di più \(4\)</);
  // Without JavaScript every plan is shown and the filters (which need it) are hidden.
  assert.match(html,/<noscript><style>\.shop-cards>\[hidden\]\{display:flex!important\}/);
  // A country without a plan of its own says so; a short list has no "Show more".
  const kosovo=page('/esim/kosovo',many).body;
  assert.match(kosovo,/<p class="shop-regional-note">There is no plan for this country alone\. These regional plans include it\.<\/p>/);assert.match(kosovo,/Regional plans from €1\.00/);
  assert.match(kosovo,/id="show-more"[^>]* hidden>/);assert.doesNotMatch(html,/shop-regional-note">There is no plan/);
  // The region page lists links to its countries.
  assert.match(page('/esim/region/europe',many).body,/<ul class="country-links"><li><a href="\/esim\/albania">Albania<\/a><\/li><li><a href="\/esim\/kosovo">Kosovo<\/a><\/li><\/ul>/);
});

test('destination pages say what is on them from the catalog alone: plans, providers and the validity range, in each language',()=>{
  const body=catalog([product('a',{countries:['AL'],provider:'Sparks',validityHours:24}),product('b',{countries:['AL'],provider:'Airalo',validityHours:720}),product('c',{countries:['AL','XK'],regions:['Europe'],provider:'Sparks',validityHours:12}),product('d',{countries:['IT'],validityHours:null})]);
  const intro=path=>/<p class="dest-intro">[^<]*?((?:On this page|Në këtë faqe|In questa pagina)[^<]*)<\/p>/.exec(page(path,body).body)[1];
  assert.equal(intro('/esim/albania'),'On this page: 3 plans from 2 providers, valid from 12 hours to 30 days.');
  assert.equal(intro('/sq/esim/albania'),'Në këtë faqe: 3 paketa nga 2 ofrues, me vlefshmëri nga 12 orë deri në 30 ditë.');
  assert.equal(intro('/it/esim/albania'),'In questa pagina: 3 piani di 2 fornitori, con validità da 12 ore a 30 giorni.');
  assert.equal(intro('/esim/kosovo'),'On this page: 1 plan from 1 provider, valid for 12 hours.');
  assert.equal(intro('/sq/esim/kosovo'),'Në këtë faqe: 1 paketë nga 1 ofrues, me vlefshmëri 12 orë.');assert.equal(intro('/it/esim/kosovo'),'In questa pagina: 1 piano di 1 fornitore, con validità di 12 ore.');
  assert.equal(intro('/esim/italy'),'On this page: 1 plan from 1 provider.');
  // A number never wraps away from its unit.
  assert.ok(shop.render(routeFromPath('/esim/albania'),body).body.includes('valid from 12 hours to 30 days.'));
  // One plan reads in the singular in the meta description too.
  assert.match(page('/esim/italy',body).body,/<meta name="description" content="Italy eSIM: 1 data plan from €5\.00\./);
  assert.match(page('/sq/esim/italy',body).body,/content="Destinacioni Itali: 1 paketë interneti eSIM nga 5,00 €\./);assert.match(page('/it/esim/italy',body).body,/content="Destinazione Italia: 1 piano dati eSIM da 5,00 €\./);
});

test('Global and Multi-country are no places: titles and descriptions start with their own heading in every language',()=>{
  const body=catalog([product('World',{title:'World 5 GB',countries:['AL','US'],regions:['Global'],price:9}),product('Duo',{title:'Duo 1 GB',countries:['AL','IT'],price:4.51})]);
  const head=path=>{const html=page(path,body).body;return [/<title>([^<]+)<\/title>/.exec(html)[1],/<meta name="description" content="([^"]+)"/.exec(html)[1].split('. ')[0],/<h1>([^<]+)<\/h1>/.exec(html)?.[1]];};
  assert.deepEqual(head('/esim/region/global'),['Global eSIM: travel data plans · MOBIALO','Global eSIM: 1 data plan from €9.00','Global eSIM']);
  assert.deepEqual(head('/sq/esim/region/global'),['eSIM globale: paketa interneti për udhëtim · MOBIALO','eSIM globale: 1 paketë interneti nga 9,00 €','eSIM globale']);
  assert.deepEqual(head('/it/esim/region/global'),['eSIM globale: piani dati da viaggio · MOBIALO','eSIM globale: 1 piano dati da 9,00 €','eSIM globale']);
  assert.deepEqual(head('/esim/region/multi-country'),['Multi-country eSIM: travel data plans · MOBIALO','Multi-country eSIM: 1 data plan from €4.51','Multi-country eSIM']);
  assert.deepEqual(head('/sq/esim/region/multi-country'),['eSIM për disa shtete: paketa interneti për udhëtim · MOBIALO','eSIM për disa shtete: 1 paketë interneti nga 4,51 €','eSIM për disa shtete']);
  assert.deepEqual(head('/it/esim/region/multi-country'),['eSIM per più paesi: piani dati da viaggio · MOBIALO','eSIM per più paesi: 1 piano dati da 4,51 €','eSIM per più paesi']);
  // Their plan pages too; a place keeps "{name} eSIM".
  const plan=path=>{const html=page(path,body).body;return [/<title>([^<]+)<\/title>/.exec(html)[1],/<meta name="description" content="([^"]+)"/.exec(html)[1]];};
  assert.deepEqual(plan('/sq/esim/region/multi-country/{Duo}'),['Duo 1 GB · eSIM për disa shtete · MOBIALO','Duo 1 GB: 1 GB, 7 ditë, 4,51 €. Paketë eSIM për disa shtete nga Sparks. Pagesa përmes PayPal, kodi QR me email.']);
  assert.deepEqual(plan('/esim/region/global/{World}'),['World 5 GB · Global eSIM · MOBIALO','World 5 GB: 1 GB, 7 days, €9.00. Global eSIM plan by Sparks. Payment through PayPal, QR code by email.']);
  assert.deepEqual(plan('/it/esim/region/global/{World}')[0],'World 5 GB · eSIM globale · MOBIALO');
  assert.deepEqual(plan('/esim/albania/{Duo}'),['Duo 1 GB · Albania eSIM · MOBIALO','Duo 1 GB: 1 GB, 7 days, €4.51. eSIM plan by Sparks for Albania. Payment through PayPal, QR code by email.']);
  assert.match(page('/it/esim/region/europe',fixture).body,/<meta name="description" content="Destinazione Europa: 2 piani dati eSIM da 2,99 €\./);
});

test('region icons come from region-icons.js, one per label (never the same symbol for all), with a safe fallback',()=>{
  const body=catalog([...fixture.products,product('asia',{countries:['JP','KR'],regions:['Asia']}),product('america',{countries:['US','CA'],regions:['America']})]);
  const hub=page('/esim',body).body;
  const icons=[...hub.matchAll(/<span class="flag region-icon" aria-hidden="true"><svg[^>]*data-icon="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(icons,['Europe','America','Asia','MiddleEast','Global']);
  assert.doesNotMatch(hub,/◎<\/span><div><h3>/);
  const context=loadStorefront();context.MobialoRegionIcon=()=>'<svg onload=alert(1)></svg>';
  assert.match(createStorefront(context).render(routeFromPath('/esim/region/europe'),fixture).body,/<span class="flag region-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"/);
});

test('plan page: the whole plan, the checkout placeholder with reserved height, one way back (the breadcrumb) and the product for paypal-checkout.js',async()=>{
  const html=page('/sq/esim/albania/{balkans}',fixture).body,id=uid('balkans');
  // The breadcrumb links the destination, so there is no second "back" link under it.
  assert.ok(html.includes(`<li><a href="/sq/esim/albania">Shqipëri</a></li><li><span aria-current="page">Balkans 5 GB</span></li>`));assert.doesNotMatch(html,/shop-back|Kthehu te paketat/);
  assert.match(html,/<section id="shop-payment" class="is-guest"><div class="shop-payment-head"><h2 id="shop-payment-title">Pagesa<\/h2><p><span>Balkans 5 GB<\/span><span>Çmimi përfundimtar <strong>2,99 €<\/strong><\/span><\/p><\/div><div id="paypal-checkout"><p class="checkout-loading">Po ngarkohen mënyrat e pagesës…<\/p><\/div>/);
  assert.match(html,/<script src="\/paypal-checkout\.js\?v=pages-1" defer><\/script>/);
  // PayPal's hosts are connected early: the buttons come from www.paypal.com (only plan pages pay).
  assert.match(html,/<link rel="preconnect" href="https:\/\/www\.paypal\.com"><link rel="preconnect" href="https:\/\/www\.paypalobjects\.com">/);
  assert.doesNotMatch(page('/sq/esim/albania',fixture).body,/www\.paypal\.com/);
  // The product carries the shown price (2 decimals): paypal-checkout.js sends it, checkout refuses another one.
  const data=JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data.product,{id,category:'esim_realtime',title:'Balkans 5 GB',price:'2.99'});
  assert.equal(JSON.parse(page('/esim/albania/{al-small}',fixture).body.match(/id="page-data">([\s\S]*?)<\/script>/)[1]).product.price,'3.50');
  assert.deepEqual(data.alternates,{en:'/esim/albania/'+id,sq:'/sq/esim/albania/'+id,it:'/it/esim/albania/'+id});
  for(const text of ['Sparks','Detajet e eSIM-it','Shtetet e mbuluara (3)','4G/5G tregon teknologjinë e rrjetit','Kontrollo mbulimin, përshtatshmërinë dhe kushtet e aktivizimit para pagesës.','Kodi QR me email pas pagesës','href="/delivery-refunds.html"','href="/sq/devices"','<strong>7 ditë</strong>','<span>5G</span><span>Hotspot</span>'])assert.ok(html.includes(text),text);
  // The PayPal sentence is said once near the buttons (paypal-checkout.js), not again in the list under them.
  assert.match(html,/<ul class="shop-trust"><li>Kodi QR me email pas pagesës<\/li><li><a href="\/delivery-refunds\.html" target="_blank" rel="noopener">Politika e dërgesës dhe rimbursimit<\/a><\/li><\/ul>/);
  // A stored session (html.signed-in, set in <head>) reserves the signed-in checkout height through CSS alone: no script
  // after the box, which could only run after a frame at the guest height.
  assert.doesNotMatch(html,/classList\.remove\('is-guest'\)/);
  const styles=await read('dist/styles.css');
  assert.equal(/(^|[},])#shop-payment\.is-guest/.test(styles),false,'every guest height is scoped to html:not(.signed-in)');
  assert.match(styles,/html:not\(\.signed-in\) #shop-payment\.is-guest\{min-height:647px\}/);
  // The checkout text the loader shows is the same as paypal-checkout.js's first status, so nothing changes when it mounts.
  return read('dist/paypal-checkout.js').then(source=>{for(const text of ['Po ngarkohen mënyrat e pagesës…','Loading payment methods…','Caricamento dei metodi di pagamento…'])assert.ok(source.includes(text));});
});

test('the hub lists every country, region and Global with search; ?q= is filtered on the server too',()=>{
  const hub=page('/it/esim',fixture).body;
  assert.match(hub,/<input id="search" name="q" type="search"[^>]*aria-label="Cerca una destinazione" placeholder="Dove vuoi andare\?" value="">/);
  assert.match(hub,/<section class="store-section" id="countries" aria-labelledby="countries-title"><h2 id="countries-title">Paesi <span class="section-count">9<\/span><\/h2>/);
  assert.match(hub,/<a class="destination-card" href="\/it\/esim\/albania" data-en="Albania" data-sq="Shqipëri" data-it="Albania"/);
  const search=page('/esim?q=ital',fixture).body;
  assert.match(search,/value="ital"/);assert.match(search,/<p class="results-status" id="hub-status" role="status">1 matching destination<\/p>/);
  assert.match(search,/href="\/esim\/italy" data-en="Italy"[^>]*><span/);assert.match(search,/href="\/esim\/albania"[^>]* hidden>/);
  assert.match(search,/id="regions" aria-labelledby="regions-title" hidden>/);
  // One result is singular in every language (S.resultsLabel; the copy key resultsOne sits next to results).
  assert.match(page('/sq/esim?q=ital',fixture).body,/role="status">1 destinacion i gjetur<\/p>/);assert.match(page('/it/esim?q=ital',fixture).body,/role="status">1 destinazione trovata<\/p>/);
  assert.match(page('/esim?q=al',fixture).body,/role="status">\d+ matching destinations<\/p>/);
  assert.deepEqual(plain(S.LANGUAGES.map(lang=>[S.resultsLabel(1,lang),S.resultsLabel(2,lang)])),[['1 matching destination','2 matching destinations'],['1 destinacion i gjetur','2 destinacione të gjetura'],['1 destinazione trovata','2 destinazioni trovate']]);
});

test('header: both account labels are in the markup and a <head> snippet marks a stored session before the first paint',()=>{
  for(const [lang,signIn,account] of [['en','Sign in','My account'],['sq','Hyr','Llogaria ime'],['it','Accedi','Il mio account']]){
    const html=page(`${lang==='en'?'':'/'+lang}/esim/albania`,fixture).body;
    assert.ok(html.includes(`<a class="account-link" href="/sign-in"><span class="account-out">${signIn}</span><span class="account-in">${account}</span></a>`),lang);
    // No script after the header rewrites the link while the page paints.
    assert.doesNotMatch(html,/<\/header>\s*<script/);assert.doesNotMatch(html,/querySelector\('\.account-link'\)/);
    const code=html.match(/<script>(\/\* A stored session: the header[\s\S]*?)<\/script>/)[1];
    assert.ok(html.indexOf(code)<html.indexOf('<link rel="stylesheet"'));
    for(const [keys,signedIn] of [[['sb-abc-auth-token'],true],[['mobialo-language-choice','sb-x-auth-token-code-verifier'],false],[[],false]]){
      const classes=new Set();
      vm.runInNewContext(code,{document:{documentElement:{classList:{add:c=>classes.add(c)}}},localStorage:{length:keys.length,key:index=>keys[index]}});
      assert.equal(classes.has('signed-in'),signedIn,keys.join());assert.ok(classes.size<=1);
    }
    // Blocked storage leaves the page signed out.
    assert.doesNotThrow(()=>vm.runInNewContext(code,{document:{documentElement:{classList:{add(){}}}},get localStorage(){throw Error('blocked');}}));
  }
});

// Includes Vercel's res.status()/res.json() helpers, which the /api/catalog handler uses.
function respond(){const headers={};const res={statusCode:0,body:null,setHeader:(key,value)=>{headers[key]=value;},end(body){res.body=body??null;},status(code){res.statusCode=code;return res;},json(value){res.body=JSON.stringify(value);}};return {res,headers};}
const pricing={markupPercent:20,feePercent:2.5,feeFixed:0.2},live={MOBIMATTER_MERCHANT_ID:'fixture',MOBIMATTER_API_KEY:'fixture'};
const call=async(url,deps,method='GET')=>{const {res,headers}=respond();await handler({method,url:at(url),query:Object.fromEntries(new URL(at(url),'https://x').searchParams)},res,{storefront:shop,...deps});return {status:res.statusCode,headers,body:res.body};};
const stock=(extra={})=>({env:live,catalog:async()=>fixture,settings:async()=>({pricing}),...extra});
test('cache headers: pages are CDN-cached for 5 minutes with 10 minutes of stale-while-revalidate; a 404 for a minute; no-store without readable settings or catalog',async()=>{
  const seen=[];
  const ok=await call('/api/store?page=country&lang=it&slug=albania',stock({catalog:async options=>{seen.push(options);return fixture;}}));
  assert.equal(ok.status,200);assert.equal(ok.headers['Cache-Control'],'public, max-age=0, must-revalidate');assert.equal(ok.headers['Vercel-CDN-Cache-Control'],'s-maxage=300, stale-while-revalidate=600');
  assert.equal(ok.headers['Content-Type'],'text/html; charset=utf-8');assert.equal(ok.headers['Content-Language'],'it');
  // Pages take the last good catalog at once (getCatalog allowStale), priced with the one settings read that decides caching.
  assert.equal(seen[0].allowStale,true);assert.deepEqual(await seen[0].settings(),{pricing});
  // The page price is the catalog price, which live checkout charges (same getCatalog) after comparing it with the shown one.
  assert.match(spaces(ok.body),/<strong>3,50 €<\/strong>/);
  const unavailable=await call('/api/store?page=country&lang=en&slug=albania',stock({settings:async()=>({pricing,unavailable:true})}));
  assert.equal(unavailable.status,200);assert.equal(unavailable.headers['Cache-Control'],'no-store');assert.equal(unavailable.headers['Vercel-CDN-Cache-Control'],undefined);
  const failed=await call('/api/store?page=plan&lang=sq&slug=albania&product={al-small}',stock({catalog:async()=>{throw Error('offline');}}));
  assert.equal(failed.status,503);assert.equal(failed.headers['Cache-Control'],'no-store');assert.equal(failed.headers['Retry-After'],'60');
  assert.match(failed.body,/<h1>Katalogu nuk është i disponueshëm<\/h1>/);assert.match(failed.body,/noindex/);
  // A 404 is kept by the CDN for a minute without a stale copy; one without readable settings not at all.
  const missing=await call('/api/store?page=country&lang=en&slug=atlantis',stock());
  assert.equal(missing.status,404);assert.equal(missing.headers['Cache-Control'],'public, max-age=0, must-revalidate');assert.equal(missing.headers['Vercel-CDN-Cache-Control'],'s-maxage=60');
  assert.equal((await call('/api/store?page=country&lang=en&slug=atlantis',stock({settings:async()=>({pricing,unavailable:true})}))).headers['Cache-Control'],'no-store');
  // An address that cannot exist is a 404 without loading the catalog.
  for(const url of ['/api/store?page=country&slug='+'x'.repeat(5000),'/api/store?page=plan&slug=albania&product=abc','/api/store?page=nothing']){
    const junk=await call(url,stock({catalog:()=>assert.fail('not loaded'),settings:()=>assert.fail('not loaded')}));
    assert.equal(junk.status,404);assert.equal(junk.headers['Vercel-CDN-Cache-Control'],'s-maxage=60');assert.ok(junk.body.length<20000);
  }
  const post=await call('/api/store?page=hub',{env:live,catalog:()=>assert.fail('not loaded')},'POST');
  assert.equal(post.status,405);assert.equal(post.headers['Cache-Control'],'no-store');
  const head=await call('/api/store?page=hub',stock(),'HEAD');assert.equal(head.status,200);assert.equal(head.body,null);
  // Without MobiMatter credentials the checked-in snapshot is used, and the pages say so.
  const snapshot=await call('/sq/esim/albania',{env:{},settings:async()=>({pricing})});
  assert.equal(snapshot.status,200);assert.match(snapshot.body,/Çmime nga një katalog i ruajtur/);
});

test('a plan page reloaded after a changed price (?r=) waits for a catalog at most a minute old and is not cached',async()=>{
  const seen=[];const reload=await call('/api/store?page=plan&lang=en&slug=albania&product={al-small}&r=123',stock({catalog:async options=>{seen.push(options);return fixture;}}));
  assert.equal(reload.status,200);assert.deepEqual([seen[0].maxAge,seen[0].allowStale],[60000,undefined]);
  assert.equal(reload.headers['Cache-Control'],'no-store');assert.equal(reload.headers['Vercel-CDN-Cache-Control'],undefined);
  // Elsewhere ?r= changes nothing.
  seen.length=0;assert.equal((await call('/api/store?page=country&lang=en&slug=albania&r=1',stock({catalog:async options=>{seen.push(options);return fixture;}}))).headers['Vercel-CDN-Cache-Control'],'s-maxage=300, stale-while-revalidate=600');
  assert.equal(seen[0].allowStale,true);
});

test('warm-up (pg_cron every minute): refreshes the catalog in its own invocation and answers 204 without a body, never cached',async()=>{
  const seen=[];
  const warm=await call('/api/store?page=warm',stock({catalog:async options=>{seen.push(options);return fixture;}}));
  assert.deepEqual([warm.status,warm.body,warm.headers['Cache-Control'],warm.headers['Vercel-CDN-Cache-Control'],warm.headers['Content-Type']],[204,null,'no-store',undefined,undefined]);
  assert.equal(seen[0].maxAge,200000);assert.equal(seen[0].allowStale,undefined);
  // Grouped for the pages as well, so the first page after a refresh renders at once.
  const grouped=[];await call('/api/store?page=warm',stock({storefront:{...shop,destinationsFor:body=>grouped.push(body)}}));assert.deepEqual(grouped,[fixture]);
  const failed=await call('/api/store?page=warm',stock({catalog:async()=>{throw Error('offline');}}));
  assert.deepEqual([failed.status,failed.body,failed.headers['Cache-Control'],failed.headers['Retry-After']],[503,null,'no-store','60']);
  // The warm-up still refreshes the catalog when the page code itself fails to load.
  assert.equal((await call('/api/store?page=warm',stock({storefront:null,createStorefront:()=>{throw Error('missing file');}}))).status,204);
});

test('old /?plan= links: 301 to the plan page under its own destination, 302 home for an unknown or invalid id',async()=>{
  const go=async(id,extra)=>{const result=await call('/api/store?page=legacy&product='+id+'&plan='+id,stock(extra));return [result.status,result.headers.Location,result.headers['Vercel-CDN-Cache-Control'],result.body];};
  assert.deepEqual(await go(uid('al-small')),[301,'/esim/albania/'+uid('al-small'),'s-maxage=300, stale-while-revalidate=600','']);
  assert.deepEqual(await go(uid('balkans')),[301,'/esim/region/europe/'+uid('balkans'),'s-maxage=300, stale-while-revalidate=600','']);
  assert.deepEqual(await go(uid('world')),[301,'/esim/region/global/'+uid('world'),'s-maxage=300, stale-while-revalidate=600','']);
  for(const id of [uid('kyc'),uid('nothing'),'not-a-plan','<script>'])assert.deepEqual(await go(encodeURIComponent(id)),[302,'/','s-maxage=60',''],id);
  // An id that is not a product id goes home without loading the catalog.
  for(const id of ['not-a-plan','<script>','x'.repeat(90)])assert.deepEqual(await go(encodeURIComponent(id),{catalog:()=>assert.fail('not loaded')}),[302,'/','s-maxage=60',''],id);
  assert.deepEqual((await go(uid('al-small'),{catalog:async()=>{throw Error('offline');}})).slice(0,3),[503,undefined,undefined]);
  // The page it lands on applies a stored language in <head>, so the English address is enough.
  assert.match(page('/esim/albania/{al-small}',fixture).body,/A language chosen earlier opens this page in that language/);
});

test('a storefront that cannot load (a file missing from includeFiles) answers a small 503 page with Retry-After, not a crash',async()=>{
  const logged=[],error=console.error;console.error=(...args)=>logged.push(args.join(' '));
  try{
    for(const url of ['/api/store?page=hub&lang=sq','/api/store?page=plan&slug=albania&product={al-small}','/sitemap.xml']){
      const result=await call(url,stock({storefront:null,createStorefront:()=>{throw Error('MobialoStorefront is undefined');},catalog:()=>assert.fail('not loaded')}));
      assert.equal(result.status,503);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers['Retry-After'],'60');
      assert.match(result.headers['Content-Type'],url==='/sitemap.xml'?/^text\/plain/:/^text\/html/);
      if(url!=='/sitemap.xml'){assert.match(result.body,/<meta name="robots" content="noindex">/);assert.match(result.body,/Provo përsëri pas një minute/);}
    }
  }finally{console.error=error;}
  assert.ok(logged.every(line=>line.includes('Storefront unavailable')));assert.equal(logged.length,3);
});

test('sitemap: static pages, the hub and every country and region page in three languages, never a plan page',async()=>{
  const {res,headers}=respond();
  await handler({method:'GET',url:'/sitemap.xml',query:{page:'sitemap'}},res,{storefront:shop,env:live,catalog:async()=>fixture,settings:async()=>({pricing})});
  assert.equal(res.statusCode,200);assert.equal(headers['Content-Type'],'application/xml; charset=utf-8');
  const locs=[...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1].replace('https://www.mobialo.eu',''));
  assert.match(res.body,/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  for(const path of ['/','/about.html','/terms.html','/privacy.html','/delivery-refunds.html','/devices','/sq/devices','/it/devices','/esim','/sq/esim','/it/esim','/esim/albania','/sq/esim/albania','/it/esim/italy','/esim/region/europe','/sq/esim/region/middle-east','/it/esim/region/global'])assert.ok(locs.includes(path),path);
  const destinations=shop.destinationsFor(fixture);
  assert.equal(locs.length,13+3+3*destinations.length);assert.equal(new Set(locs).size,locs.length);
  assert.ok(!locs.some(path=>/\/esim\/[^/]+\/[^/]+$/.test(path)&&!path.includes('/region/')||/\/region\/[^/]+\/./.test(path)));
  // Every destination in the sitemap of the checked-in catalog (plus a KT plan) has a real name in each language.
  const real=JSON.parse(await read('dist/catalog-preview.json'));real.products.push({...real.products.find(S.purchasable),id:uid('kt-plan'),countries:['TR','KT'],regions:[]});
  const listed=new Set([...sitemapOf(real).matchAll(/<loc>https:\/\/www\.mobialo\.eu\/esim\/(?!region\/)([^<]+)<\/loc>/g)].map(match=>match[1]));
  const countries=shop.destinationsFor(real).filter(d=>d.kind==='country');
  assert.equal(listed.size,countries.length);assert.ok(!listed.has('kt'));
  for(const d of countries){assert.ok(listed.has(d.slug),d.slug);for(const lang of S.LANGUAGES)assert.ok(d[lang]&&d[lang]!==d.code&&S.hasCountryName(d.code),d.code);}
});

test('Albanian prices read the same in every runtime, without Albanian ICU data; English and Italian are unchanged',()=>{
  const intl=(locale,value)=>new Intl.NumberFormat(locale,{style:'currency',currency:'EUR'}).format(value);
  // Node has full ICU: the hand-written Albanian form is exactly the CLDR one (no-break spaces, grouping from 5 digits).
  for(const value of [0,0.2,4.51,9.9,12,192.2,999.99,1234.5,12345.678,1234567.891]){
    assert.equal(S.money(value,'sq'),intl('sq-AL',value),String(value));assert.equal(S.money(value,'en'),intl('en-IE',value));assert.equal(S.money(value,'it'),intl('it-IT',value));
  }
  assert.deepEqual([S.money(4.51,'sq'),S.money(4.51,'en'),S.money(4.51,'it')].map(spaces),['4,51 €','€4.51','4,51 €']);
  // Desktop Chrome resolves 'sq-AL' to English ('€4.51'); the helper never asks Intl for Albanian.
  const english={NumberFormat:function(locale,options){return new Intl.NumberFormat(/^sq/.test(locale)?'en-US':locale,options);},DisplayNames:Intl.DisplayNames};
  const chrome=loadStorefront({Intl:english});
  assert.equal(vm.runInContext("new Intl.NumberFormat('sq-AL',{style:'currency',currency:'EUR'}).format(4.51)",chrome),'€4.51');
  assert.equal(spaces(chrome.MobialoStorefront.money(4.51,'sq')),'4,51 €');assert.equal(chrome.MobialoStorefront.money(4.51,'en'),'€4.51');
});

// The inline <head> script of a page, run against a stored choice.
function headScript(html,{choice=null,search='',hash=''}={}){
  const code=html.match(/<script>(\/\* A language chosen earlier[\s\S]*?)<\/script>/)[1],classes=new Set();let replaced=null;
  vm.runInNewContext(code,{document:{documentElement:{lang:html.match(/<html lang="(\w+)">/)[1],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}},localStorage:{getItem:key=>key==='mobialo-language-choice'?choice:null},location:{search,hash,replace:url=>{replaced=url;}},setTimeout:()=>{}});
  return {replaced,hidden:classes.has('lang-redirect')};
}
test('language: a stored choice opens the same page in that language before the first paint; crawlers and matching choices stay',()=>{
  const html=page('/esim/albania',fixture).body;
  assert.deepEqual(headScript(html,{choice:'sq',search:'?utm=x',hash:'#plans'}),{replaced:'/sq/esim/albania?utm=x#plans',hidden:true});
  assert.deepEqual(headScript(html),{replaced:null,hidden:false});
  assert.deepEqual(headScript(html,{choice:'en'}),{replaced:null,hidden:false});
  assert.deepEqual(headScript(html,{choice:'constructor'}),{replaced:null,hidden:false});
  assert.ok(html.indexOf('A language chosen earlier')<html.indexOf('<link rel="stylesheet"'));
  // The menu and the footer links lead to the same page in the other languages.
  assert.match(html,/<select id="language" aria-label="Language"><option value="en" selected>EN<\/option><option value="sq">SQ<\/option><option value="it">IT<\/option><\/select>/);
  assert.match(html,/<span class="footer-languages"><span aria-current="page">EN<\/span> \/ <a href="\/sq\/esim\/albania" hreflang="sq" lang="sq" data-language-link="sq">SQ<\/a> \/ <a href="\/it\/esim\/albania" hreflang="it" lang="it" data-language-link="it">IT<\/a> · EUR €<\/span>/);
});

// catalog-shop.js against a small DOM built from the server-rendered page.
function clientPage(html,{choice=null,detected=null,ready='en'}={}){
  const listeners=new Map(),on=element=>(type,fn)=>{if(!listeners.has(element))listeners.set(element,{});(listeners.get(element)[type]||=[]).push(fn);};
  const fire=(element,type,event={})=>(listeners.get(element)?.[type]||[]).forEach(fn=>fn({preventDefault(){},target:element,...event}));
  const node=(extra={})=>{const element={hidden:false,dataset:{},style:{},textContent:'',attributes:{},...extra,setAttribute(key,value){this.attributes[key]=String(value);},focus(){focused=this;}};element.addEventListener=on(element);return element;};
  let focused=null;
  const list=node({children:[]});list.append=(...items)=>{for(const item of items){const at=list.children.indexOf(item);if(at>=0)list.children.splice(at,1);list.children.push(item);}};
  for(const [,attributes,href,title] of html.matchAll(/<li class="shop-card"([^>]*)>.*?<h3><a href="([^"]+)">([^<]+)<\/a>/g)){
    const data=Object.fromEntries([...attributes.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
    const link=node({href,textContent:title});
    list.children.push(node({dataset:data,hidden:/ hidden$/.test(attributes),querySelector:selector=>selector==='h3'?{textContent:title}:link,link}));
  }
  const more=node({dataset:{label:'Show more'},hidden:/id="show-more"[^>]* hidden>/.test(html)});
  const selects=['country','data','days','price','provider','sort'].map(key=>node({dataset:{shopFilter:key},value:'',parentElement:{firstChild:{textContent:key}},selectedOptions:[{textContent:'option'}]}));
  const active=node({children:[]});active.replaceChildren=(...items)=>{active.children=items;};active.querySelector=()=>active.children[0]||null;
  const note=node({hidden:true,children:[]});note.replaceChildren=(...items)=>{note.children=items;note.textContent=items.map(item=>item.textContent).join('');};
  const ids={'page-data':{textContent:html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1]},'plan-list':list,'show-more':more,'shop-count':node(),'shop-empty':node({hidden:true}),'shop-active':active,'shop-reset':node(),'lang-suggest':note,language:node({value:'en'})};
  const assigned=[],chosen=[];
  const context={document:{documentElement:{lang:html.match(/<html lang="(\w+)">/)[1]},getElementById:id=>ids[id]||null,querySelectorAll:selector=>selector==='[data-shop-filter]'?selects:[],querySelector:()=>null,addEventListener(){},createElement:()=>node()},
    window:{MobialoLocale:{ready:Promise.resolve(ready),choose:value=>chosen.push(value)}},location:{href:'https://www.mobialo.eu/esim/albania',search:'',hash:'',assign:url=>assigned.push(url)},history:{replaceState(){}},
    localStorage:{getItem:key=>key==='mobialo-language-choice'?choice:null},sessionStorage:{getItem:key=>key==='mobialo-detected-language'?detected:null},matchMedia:()=>({matches:false}),URL,URLSearchParams};
  return {context,list,more,selects,note,ids,assigned,chosen,fire,focused:()=>focused,visible:()=>list.children.filter(card=>!card.hidden).map(card=>card.link.textContent)};
}
async function runClient(html,options){
  const client=clientPage(html,options);
  vm.createContext(client.context);
  for(const file of ['dist/storefront-core.js','dist/catalog-filters.js','dist/catalog-shop.js'])vm.runInContext(await read(file),client.context,{filename:file});
  await tick();await tick();
  return client;
}

test('a long list grows by twenty plans per "Show more", with focus on the first new one',async()=>{
  const many=catalog(Array.from({length:45},(_,i)=>product('al-long-'+i,{title:'Albania '+i,price:4+i,countries:['AL']})));
  const client=await runClient(page('/esim/albania',many).body);
  assert.equal(client.visible().length,10);assert.equal(client.more.hidden,false);
  client.fire(client.more,'click');
  assert.equal(client.visible().length,30);assert.equal(client.more.textContent,'Show more (15)');assert.equal(client.focused()?.textContent,'Albania 10');
  client.fire(client.more,'click');
  assert.equal(client.visible().length,45);assert.equal(client.more.hidden,true);assert.equal(client.focused()?.textContent,'Albania 30');
});
test('"Show more" reveals the rest in place and moves focus to the first new plan; a filter or sort starts compact again',async()=>{
  const many=catalog([...Array.from({length:13},(_,i)=>product('al-'+i,{title:'Albania '+i,price:4+i,countries:['AL'],dataAmount:String(i+1)})),product('region',{title:'Balkans',price:1,countries:['AL','XK'],regions:['Europe']})]);
  const client=await runClient(page('/esim/albania',many).body);
  assert.equal(client.visible().length,10);assert.equal(client.visible()[0],'Albania 0');assert.equal(client.more.hidden,false);
  client.fire(client.more,'click');
  assert.equal(client.visible().length,14);assert.equal(client.more.hidden,true);assert.equal(client.focused()?.textContent,'Albania 10');
  // Sorting by data reorders the server-rendered cards and shows the first ten again.
  const sort=client.selects.find(select=>select.dataset.shopFilter==='sort');sort.value='data';client.fire(sort,'change');
  assert.deepEqual(client.visible().slice(0,3),['Albania 12','Albania 11','Albania 10']);assert.equal(client.visible().length,10);assert.equal(client.more.textContent,'Show more (4)');
  // Back to the default order: the country's own plans first, the regional plan last although it is the cheapest.
  sort.value='';client.fire(sort,'change');
  assert.equal(client.list.children[0].link.textContent,'Albania 0');assert.equal(client.list.children[13].link.textContent,'Balkans');
  const price=client.selects.find(select=>select.dataset.shopFilter==='price');price.value='5';client.fire(price,'change');
  assert.deepEqual(client.visible(),['Albania 0','Albania 1','Balkans']);assert.equal(client.more.hidden,true);assert.equal(client.ids['shop-count'].textContent,'3 plans');
  assert.equal(client.ids['shop-active'].children.length,1);
});

test('a detected language that differs from the page gets a link, never a redirect; a stored choice or a failed detection gets nothing',async()=>{
  const html=page('/esim/albania',fixture).body;
  const detected=await runClient(html,{ready:'sq',detected:'sq:sq'});
  assert.equal(detected.note.hidden,false);assert.equal(detected.note.href,'/sq/esim/albania');assert.equal(detected.note.lang,'sq');
  // The full sentence, and a short label for phones (catalog-shop.js); the sentence is the accessible name.
  assert.deepEqual(detected.note.children.map(child=>[child.className,child.textContent]),[['lang-long','Kjo faqe është edhe në shqip →'],['lang-short','Shqip →']]);assert.equal(detected.note.attributes['aria-label'],'Kjo faqe është edhe në shqip');
  assert.deepEqual(detected.assigned,[]);
  detected.fire(detected.note,'click');assert.deepEqual(detected.chosen,['sq']);
  for(const options of [{ready:'sq',detected:'sq:sq',choice:'en'},{ready:'en',detected:'en:en'},{ready:'it',detected:null}])assert.equal((await runClient(html,options)).note.hidden,true,JSON.stringify(options));
  // The menu opens the same page in the chosen language and remembers it.
  const menu=await runClient(html);menu.ids.language.value='it';menu.fire(menu.ids.language,'change');
  assert.deepEqual(menu.assigned,['/it/esim/albania']);assert.deepEqual(menu.chosen,['it']);
});
test('a plan whose only other code has no name counts as single-country everywhere',async()=>{
  const vmLoad=async files=>{const context=vm.createContext({console,Intl,URL,URLSearchParams});for(const file of files)vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);return context;};
  const context=await vmLoad(['dist/country-names.js','dist/plan-translations.js','dist/region-icons.js','dist/catalog-filters.js','dist/storefront-core.js']);
  const S=context.MobialoStorefront,plan=(id,countries,price,regions=['Europe'])=>({id,title:id,price,currency:'EUR',category:'esim_realtime',countries,regions,provider:'P'});
  const products=[plan('tr-kt','TR KT'.split(' '),5,[]),plan('tr-only',['TR'],6,[]),plan('europe',['TR','GR','CY'],4)];
  const destinations=S.buildDestinations(products);
  // Not on a region page: it covers one named country.
  for(const region of destinations.filter(d=>d.kind!=='country'))assert.equal(region.plans.some(p=>p.id==='tr-kt'),false,region.slug);
  const turkey=destinations.find(d=>d.code==='TR');
  assert.equal(turkey.price,5);assert.equal(turkey.regionalPrice,false);
  assert.equal(S.primaryDestination(products[0],destinations),turkey);
  // Own plans first on the Türkiye page, the regional one after them although it is cheaper.
  assert.deepEqual(Array.from(context.MobialoCatalogFilter(turkey.plans,{},'TR',S.coveredCodes),({plan})=>plan.id),['tr-kt','tr-only','europe']);
});
test('a destination card says what its from-price buys, and unlimited plans say so instead of a nominal 3000 GB',async()=>{
  const context=vm.createContext({console,Intl,URL,URLSearchParams});
  for(const file of ['dist/country-names.js','dist/plan-translations.js','dist/region-icons.js','dist/catalog-filters.js','dist/storefront-core.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
  const S=context.MobialoStorefront,plan=(id,countries,price,extra={})=>({id,title:id,price,currency:'EUR',category:'esim_realtime',countries,regions:['Europe'],provider:'P',dataAmount:'1',dataUnit:'GB',validityHours:168,...extra});
  const products=[plan('me-1',['ME'],4.51),plan('me-unl',['ME'],19,{title:'Montenegro Unlimited',dataAmount:'3000',validityHours:720}),plan('europe',['ME','GR'],3.2,{dataAmount:'3',validityHours:720}),
    plan('al-none',['AL','GR'],2.5,{dataAmount:null,dataUnit:null}),plan('it-calls',['IT'],9,{title:'Italy 120 GB Unlimited Calls',dataAmount:'120'})];
  const destinations=S.buildDestinations(products),find=code=>destinations.find(d=>d.code===code);
  // The country's own cheapest plan, not the cheaper regional one.
  assert.equal(find('ME').fromPlan.id,'me-1');
  assert.match(S.destinationCard(find('ME'),'en'),/<p>From <b>€4\.51<\/b><span class="card-facts">1 GB · 7 days<\/span><\/p>/);
  assert.match(S.destinationCard(find('ME'),'sq'),/<p>Nga <b>4,51 €<\/b><span class="card-facts">1 GB · 7 ditë<\/span><\/p>/);
  assert.match(S.destinationCard(find('ME'),'it'),/<span class="card-facts">1 GB · 7 giorni<\/span>/);
  // A region shows its cheapest plan; a plan without data facts adds no line.
  const europe=destinations.find(d=>d.kind==='region');assert.equal(europe.fromPlan.id,'al-none');assert.doesNotMatch(S.destinationCard(europe,'en'),/card-facts/);
  assert.equal(S.fromFacts(find('GR'),'en'),'');
  // Unlimited data; "Unlimited Calls" keeps its real data amount.
  assert.equal(S.dataFor(products[1],'en'),'Unlimited');assert.equal(S.dataFor(products[1],'sq'),'Pa limit');assert.equal(S.dataFor(products[1],'it'),'Illimitati');
  assert.equal(S.dataFor(products[4],'en'),'120 GB');
  // Many plans share the lowest price: the card names the one that gives the most data, then the longest validity.
  const tied=S.buildDestinations([plan('a',['AE'],4.51,{title:'A small'}),plan('b',['AE'],4.51,{title:'B big',dataAmount:'2',validityHours:24}),plan('c',['AE'],4.51,{title:'C long',dataAmount:'2',validityHours:360}),plan('d',['AE'],9,{dataAmount:'20'})]);
  assert.equal(tied.find(d=>d.code==='AE').fromPlan.id,'c');assert.equal(S.fromFacts(tied.find(d=>d.code==='AE'),'en'),'2 GB · 15 days');
});
test('the homepage links to popular destinations that exist, under the names and paths the catalog gives them',async()=>{
  const context=vm.createContext({console,Intl,URL,URLSearchParams});
  for(const file of ['dist/country-names.js','dist/plan-translations.js','dist/region-icons.js','dist/catalog-filters.js','dist/storefront-core.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
  const S=context.MobialoStorefront,index=await read('dist/index.html'),preview=JSON.parse(await read('dist/catalog-preview.json'));
  const destinations=S.buildDestinations(preview.products||preview);
  const row=/<p class="popular-row"><span data-i18n="popular">Popular:<\/span>(.*?)<\/p>/.exec(index);assert.ok(row,'popular row');
  const links=[...row[1].matchAll(/<a href="([^"]+)" data-(country|region)="([^"]+)">([^<]+)<\/a>/g)];assert.equal(links.length,6);
  for(const [,href,kind,value,text] of links){
   const destination=kind==='country'?destinations.find(d=>d.code===value):destinations.find(d=>d.kind==='region'&&d.label===value);
   assert.ok(destination,value);assert.equal(href,S.destinationPath('en',destination));assert.equal(text,destination.en);
   // The script builds the same path from the code alone (app.js), in every language.
   for(const lang of ['en','sq','it'])assert.equal(S.destinationPath(lang,kind==='country'?{kind:'country',slug:S.countrySlug(value)}:{kind:'region',slug:S.slugify(value)}),S.destinationPath(lang,destination));
  }
  // The from-price line has its reserved slot in the hero.
  assert.match(index,/No account needed\.<\/p><p class="hero-from"><\/p>/);
});

test('phones collapse the plan filters before any field is parsed, so no frame shows them open',()=>{
  const html=page('/sq/esim/japan',fixture).body;
  const collapse=html.indexOf("document.getElementById('plan-filters').open=false"),summary=html.indexOf('</summary>',html.indexOf('id="plan-filters"')),select=html.indexOf('<select',html.indexOf('id="plan-filters"'));
  assert.ok(summary>0&&collapse>summary&&collapse<select,'collapse script sits between the summary and the first field');
});

test('the deployment stays within the Vercel Hobby limit of 12 functions, and /api/catalog is served by api/store.mjs',async()=>{
  const {readdir}=await import('node:fs/promises');
  const walk=async dir=>(await Promise.all((await readdir(new URL('../'+dir,import.meta.url),{withFileTypes:true})).map(entry=>entry.isDirectory()?walk(dir+'/'+entry.name):[dir+'/'+entry.name]))).flat();
  const functions=(await walk('api')).filter(file=>/\.(m?js|ts)$/.test(file));
  assert.ok(functions.length<=12,functions.length+' functions: '+functions.join(' '));
  const vercel=JSON.parse(await read('vercel.json'));
  assert.deepEqual(vercel.rewrites[0],{source:'/api/catalog',destination:'/api/store?page=catalog'});
  const result=await call('/api/store?page=catalog',stock());
  assert.equal(result.status,200);assert.ok(JSON.parse(result.body).products.length>0);
  assert.equal(result.headers['Vercel-CDN-Cache-Control'],'s-maxage=60, stale-while-revalidate=600');
});
