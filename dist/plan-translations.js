// Supplier terms are translated as complete statements, preserving their conditions.
globalThis.MobialoPlanText = (() => {
 const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').replace(/[–—]/g, '-');
 const sq = new Map([
  ['INSTANT DELIVERY - READY TO CONNECT - PREPAID - NO CONTRACT', 'DËRGIM I MENJËHERSHËM - GATI PËR LIDHJE - ME PARAPAGESË - PA KONTRATË'],
  ['This is a data-only eSIM. It does not come with a phone number.', 'Ky eSIM ofron vetëm internet. Nuk përfshin numër telefoni.'],
  ['Simply scan the QR code to download and use the eSIM. No other activation or registration steps needed.', 'Mjafton të skanosh kodin QR për të shkarkuar dhe përdorur eSIM-in. Nuk nevojiten hapa të tjerë aktivizimi apo regjistrimi.'],
  ['One-time prepaid package. No auto-renewals, no contracts. The eSIM is rechargeable and can be topped up with additional data packages.', 'Paketë me parapagesë, me pagesë të vetme. Pa rinovim automatik dhe pa kontratë. eSIM-i mund të rimbushet me paketa shtesë interneti.'],
  ['Full data speeds - no daily limits, no throttling. Mobile hotspot is supported.', 'Internet me shpejtësi të plotë, pa kufij ditorë dhe pa ulje të shpejtësisë. Mbështetet ndarja e internetit (hotspot).'],
  ['The eSIM will automatically connect to a major local mobile network in eligible countries with 5G or 4G LTE speeds.', 'eSIM-i lidhet automatikisht me një nga rrjetet kryesore celulare lokale në shtetet e mbuluara, me teknologji 5G ose 4G LTE.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide high quality 4G LTE network connection subject to network availability.', 'Disponueshmëria e 5G varet nga mbulimi i rrjetit, specifikimet rajonale të pajisjes dhe cilësimet e telefonit. Aty ku 5G nuk është i disponueshëm, eSIM-i ofron lidhje cilësore 4G LTE, në varësi të disponueshmërisë së rrjetit.'],
  ['Usable only with eSIM compatible phones and tablets which are not carrier locked. If in doubt, please check the FAQ section.', 'Përdoret vetëm në telefona dhe tableta që mbështesin eSIM dhe nuk janë të bllokuara për një operator. Nëse ke paqartësi, kontrollo seksionin e pyetjeve të shpeshta.'],
  ['Unrestricted', 'Pa kufizim të shpejtësisë'],
  ['Full data speeds - no daily limits, no throttling', 'Shpejtësi e plotë, pa kufij ditorë dhe pa ulje të shpejtësisë'],
  ['Package activates upon eSIM installation.', 'Paketa aktivizohet gjatë instalimit të eSIM-it.'],
  ['Package activates upon purchase.', 'Paketa aktivizohet në momentin e blerjes.'],
  ['Package activates upon connecting to a supported network.', 'Paketa aktivizohet kur lidhet me një rrjet të mbështetur.']
 ].map(([key,value])=>[normalize(key),value]));
 return (value,language) => {
  if(language!=='sq')return String(value??'');
  const text=normalize(value);
  if(sq.has(text))return sq.get(text);
  const expiry=text.match(/^The eSIM will expire if not activated within (\d+) months? of purchase\.$/);
  if(expiry)return `eSIM-i skadon nëse nuk aktivizohet brenda ${expiry[1]} muajve nga blerja.`;
  // Unrecognized terms must remain faithful to the supplier, never be guessed.
  return String(value??'');
 };
})();
