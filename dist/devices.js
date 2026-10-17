// Selected models checked against manufacturer support pages on 2026-10-16.
// A model name alone never guarantees support for every regional/carrier variant.
const deviceBrands = [
  {
    name: 'iPhone',
    models: ['iPhone XS', 'iPhone XS Max', 'iPhone XR', 'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max', 'iPhone SE (2020)', 'iPhone SE (2022)', 'iPhone 12 mini', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 12 Pro Max', 'iPhone 13 mini', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max', 'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max', 'iPhone 16', 'iPhone 16 Plus', 'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 16e', 'iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone 17e', 'iPhone Air'],
    en: 'iPhone XS/XR and later support eSIM in eligible markets. Mainland China, Hong Kong and Macao variants have model-specific exceptions. Check Apple’s regional guidance for your exact phone.',
    sq: 'iPhone XS/XR dhe modelet më të reja mbështesin eSIM në tregjet përkatëse. Variantet nga Kina kontinentale, Hong Kongu dhe Makao kanë përjashtime sipas modelit. Kontrollo udhëzimin rajonal të Apple për telefonin tënd.',
    sources: [['Apple', 'https://support.apple.com/en-euro/118669']]
  },
  {
    name: 'Samsung',
    models: ['Galaxy S20', 'Galaxy S20+', 'Galaxy S20 Ultra', 'Galaxy S21', 'Galaxy S21+', 'Galaxy S21 Ultra', 'Galaxy S22', 'Galaxy S22+', 'Galaxy S22 Ultra', 'Galaxy S23', 'Galaxy S23+', 'Galaxy S23 Ultra', 'Galaxy S23 FE', 'Galaxy S24', 'Galaxy S24+', 'Galaxy S24 Ultra', 'Galaxy S24 FE', 'Galaxy S25', 'Galaxy S25+', 'Galaxy S25 Ultra', 'Galaxy S25 Edge', 'Galaxy S25 FE', 'Galaxy S26', 'Galaxy S26+', 'Galaxy S26 Ultra', 'Galaxy Note20', 'Galaxy Note20 Ultra', 'Galaxy Z Fold2', 'Galaxy Z Fold3', 'Galaxy Z Fold4', 'Galaxy Z Fold5', 'Galaxy Z Fold6', 'Galaxy Z Fold7', 'Galaxy Z Flip', 'Galaxy Z Flip 5G', 'Galaxy Z Flip3', 'Galaxy Z Flip4', 'Galaxy Z Flip5', 'Galaxy Z Flip6', 'Galaxy Z Flip7', 'Galaxy Z Flip7 FE', 'Galaxy A36 5G', 'Galaxy A55 5G', 'Galaxy A56 5G', 'Galaxy XCover7', 'Galaxy XCover7 Pro'],
    en: 'Availability varies by country, carrier and model number. Samsung’s linked list covers Australian variants; confirm your regional specifications under SIM size / Embedded-SIM. S20 FE and S21 FE are not included in this list.',
    sq: 'Mbështetja ndryshon sipas shtetit, operatorit dhe numrit të modelit. Lista e Samsung në link është për variantet australiane; kontrollo specifikimet e variantit tënd te SIM size / Embedded-SIM. S20 FE dhe S21 FE nuk përfshihen në këtë listë.',
    sources: [['Samsung', 'https://www.samsung.com/au/support/mobile-devices/esim-compatibility/']]
  },
  {
    name: 'Google Pixel',
    models: ['Pixel 3a', 'Pixel 3a XL', 'Pixel 4', 'Pixel 4 XL', 'Pixel 4a', 'Pixel 4a (5G)', 'Pixel 5', 'Pixel 5a', 'Pixel 6', 'Pixel 6 Pro', 'Pixel 6a', 'Pixel 7', 'Pixel 7 Pro', 'Pixel 7a', 'Pixel Fold', 'Pixel 8', 'Pixel 8 Pro', 'Pixel 8a', 'Pixel 9', 'Pixel 9 Pro', 'Pixel 9 Pro XL', 'Pixel 9 Pro Fold', 'Pixel 9a', 'Pixel 10', 'Pixel 10 Pro', 'Pixel 10 Pro XL', 'Pixel 10 Pro Fold'],
    en: 'Google confirms eSIM on Pixel 4 and later. Pixel 3a devices bought with Verizon service or in Japan are excluded. Older Pixel 2/3 devices have additional restrictions; consult Google’s guide. Carrier support is still required.',
    sq: 'Google konfirmon eSIM në Pixel 4 dhe më të rinjtë. Përjashtohen Pixel 3a të blerë me shërbimin Verizon ose në Japoni. Pixel 2/3 kanë kufizime shtesë; shiko udhëzuesin e Google. Kërkohet edhe mbështetja nga operatori.',
    sources: [['Google', 'https://support.google.com/pixelphone/answer/7086887?hl=en']]
  },
  {
    name: 'Xiaomi',
    models: ['Xiaomi 14T', 'Xiaomi 14T Pro', 'Xiaomi 15', 'Xiaomi 15 Ultra', 'Xiaomi 15T'],
    en: 'Selected models confirmed in Xiaomi support documentation. eSIM availability depends on the regional version and carrier. This is not a complete Xiaomi/Redmi list; check the exact product specifications if your model is missing.',
    sq: 'Modele të përzgjedhura të konfirmuara në dokumentacionin e Xiaomi. eSIM varet nga varianti rajonal dhe operatori. Kjo nuk është lista e plotë Xiaomi/Redmi; kontrollo specifikimet e produktit nëse modeli yt mungon.',
    sources: [['Xiaomi', 'https://www.mi.com/my/support/faq/details/KA-535492/'], ['Xiaomi 15T', 'https://www.mi.com/bd/support/faq/details/KA-607966/']]
  }
];

function deviceListMarkup(term = '') {
  const query = normalize(term);
  const brands = deviceBrands.map(brand => ({...brand, matches: brand.models.filter(model => normalize(`${brand.name} ${model}`).includes(query))})).filter(brand => brand.matches.length);
  if (!brands.length) return `<p class="device-empty">${lang === 'sq' ? 'Modeli nuk u gjet në listën tonë. Kjo nuk do të thotë që nuk e mbështet eSIM; kontrollo specifikimet e prodhuesit.' : 'This model is not in our list. That does not necessarily mean it lacks eSIM; check the manufacturer’s specifications.'}</p>`;
  return brands.map((brand, index) => `<details class="device-brand" ${query || index === 0 ? 'open' : ''}><summary>${brand.name}<span>${brand.matches.length} ${lang === 'sq' ? 'modele' : 'models'}</span></summary><p>${brand[lang]}</p><ul class="device-models">${brand.matches.map(model => `<li>${model}</li>`).join('')}</ul><div class="device-sources">${lang === 'sq' ? 'Burimi zyrtar:' : 'Official source:'} ${brand.sources.map(([name, url]) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`).join(' · ')}</div></details>`).join('');
}
