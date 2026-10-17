export function localeForCountry(country){
  const code=typeof country==='string'?country.toUpperCase():'';
  return code==='IT'?'it':['AL','XK'].includes(code)?'sq':'en';
}
