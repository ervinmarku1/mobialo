// Dates and money for the account (src/account.js) and the admin panel (src/admin.js, src/admin-settings.js).
// Albanian never goes through Intl: desktop Chrome has no Albanian ICU data and would print English months and "€4.51".
export const albanianMonths=['janar','shkurt','mars','prill','maj','qershor','korrik','gusht','shtator','tetor','nëntor','dhjetor'];
const two=n=>String(n).padStart(2,'0');
// The same text as the server-rendered store pages (CLDR): sq and it "4,51 €", en "€4.51"; other currencies keep Intl.
export function formatMoney(value,currency,lang){
  const n=Number(value);
  if(lang==='sq'&&currency==='EUR'){const [whole,cents]=Math.abs(n).toFixed(2).split('.');return (n<0?'-':'')+(whole.length>4?whole.replace(/\B(?=(\d{3})+$)/g,' '):whole)+','+cents+' €';}
  return new Intl.NumberFormat(lang==='it'?'it-IT':lang==='sq'?'sq-AL':'en-IE',{style:'currency',currency}).format(n);
}
// "22 tetor 2026" and "13:30", in the visitor's time zone.
export const albanianDate=date=>date.getDate()+' '+albanianMonths[date.getMonth()]+' '+date.getFullYear();
export const clock=date=>two(date.getHours())+':'+two(date.getMinutes());
// The admin panel's numeric form, "22.10.2026, 13:30"; '' for a missing or invalid value.
export const numericDateTime=value=>{const date=value?new Date(value):null;return date&&Number.isFinite(date.getTime())?two(date.getDate())+'.'+two(date.getMonth()+1)+'.'+date.getFullYear()+', '+clock(date):'';};
