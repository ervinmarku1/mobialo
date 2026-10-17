// Website translations and email translations have separate coverage.
export function localeForCountry(country){
  const code=typeof country==='string'?country.toUpperCase():'';
  return code==='IT'?'it':['AL','XK'].includes(code)?'sq':'en';
}
export const emailLanguages=['en','sq','it','fr','de','es','pt','nl','pl','ro','el','tr','bg','hr','sr','mk','sl','cs','sk','hu','sv','no','da','fi','uk','ru','ar','he','hi','zh','ja','ko','id','ms','th','vi'];
const groups={en:'US GB IE AU NZ NG GH KE UG ZM ZW JM TT BS BB GY LR SL',sq:'AL',it:'IT SM VA',fr:'FR MC SN CI BF ML NE TG BJ GA CG CD GN TD',de:'DE AT LI',es:'ES MX AR BO CL CO CR CU DO EC GQ GT HN NI PA PE PR PY SV UY VE',pt:'PT BR AO MZ CV GW ST TL',nl:'NL SR',pl:'PL',ro:'RO MD',el:'GR',tr:'TR',bg:'BG',hr:'HR',sr:'RS ME',mk:'MK',sl:'SI',cs:'CZ',sk:'SK',hu:'HU',sv:'SE',no:'NO SJ',da:'DK',fi:'FI',uk:'UA',ru:'RU BY',ar:'SA AE EG DZ BH IQ JO KW LB LY MA OM PS QA SD SY TN YE',he:'IL',hi:'IN',zh:'CN TW',ja:'JP',ko:'KR KP',id:'ID',ms:'MY BN',th:'TH',vi:'VN'};
const countries=Object.fromEntries(Object.entries(groups).flatMap(([language,codes])=>codes.split(' ').map(code=>[code,[language]])));
Object.assign(countries,{CA:['en','fr'],CH:['de','fr','it'],BE:['nl','fr','de'],LU:['fr','de'],XK:['sq','sr'],MK:['mk','sq'],FI:['fi','sv'],CY:['el','tr'],IN:['hi','en'],HK:['zh','en'],MO:['zh','pt'],SG:['en','zh','ms'],MY:['ms','en','zh'],IL:['he','ar'],ZA:['en'],MT:['en'],NZ:['en'],IE:['en'],CM:['fr','en'],RW:['en','fr'],DZ:['ar','fr'],MA:['ar','fr'],TN:['ar','fr'],LB:['ar','fr'],AE:['ar','en']});
function browserLanguages(header){
  if(typeof header!=='string')return [];
  return header.slice(0,2048).split(',').map((part,index)=>{
    const [tag,...parameters]=part.trim().toLowerCase().split(';');
    const weight=parameters.find(p=>p.trim().startsWith('q='));
    const q=weight===undefined?1:Number(weight.trim().slice(2));
    let code=tag.split('-')[0];if(code==='nb'||code==='nn')code='no';
    return {code,q,index};
  }).filter(x=>Number.isFinite(x.q)&&x.q>0&&x.q<=1&&emailLanguages.includes(x.code)).sort((a,b)=>b.q-a.q||a.index-b.index).map(x=>x.code);
}
export function emailLocaleForCountry(country,acceptLanguage='',choice){
  if(choice==='en'||choice==='sq')return choice;
  const code=typeof country==='string'?country.toUpperCase():'';
  const options=countries[code];
  const browser=browserLanguages(acceptLanguage);
  if(options)return browser.find(language=>options.includes(language))||options[0];
  return browser[0]||'en';
}
