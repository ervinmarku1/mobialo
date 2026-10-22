// Supplier terms are translated as complete statements, preserving their conditions.
globalThis.MobialoPlanText = (() => {
 const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').replace(/[–—]/g, '-');
 const map = entries => new Map(entries.map(([key,value])=>[normalize(key),value]));
 const maps = {
  sq: map([
  ['INSTANT DELIVERY - READY TO CONNECT - PREPAID - NO CONTRACT', 'DËRGIM I MENJËHERSHËM - GATI PËR LIDHJE - ME PARAPAGESË - PA KONTRATË'],
  ['This is a data-only eSIM. It does not come with a phone number.', 'Ky eSIM ofron vetëm internet. Nuk përfshin numër telefoni.'],
  ['Simply scan the QR code to download and use the eSIM. No other activation or registration steps needed.', 'Mjafton të skanosh kodin QR për të shkarkuar dhe përdorur eSIM-in. Nuk nevojiten hapa të tjerë aktivizimi apo regjistrimi.'],
  ['One-time prepaid package. No auto-renewals, no contracts. The eSIM is rechargeable and can be topped up with additional data packages.', 'Paketë me parapagesë, me pagesë të vetme. Pa rinovim automatik dhe pa kontratë. eSIM-i mund të rimbushet me paketa shtesë interneti.'],
  ['One-time prepaid package. No auto-renewals, no contracts.', 'Paketë me parapagesë, me pagesë të vetme. Pa rinovim automatik dhe pa kontratë.'],
  ['Full data speeds - no daily limits, no throttling. Mobile hotspot is supported.', 'Internet me shpejtësi të plotë, pa kufij ditorë dhe pa ulje të shpejtësisë. Mbështetet ndarja e internetit (hotspot).'],
  ['The eSIM will automatically connect to a major local mobile network in eligible countries with 5G or 4G LTE speeds.', 'eSIM-i lidhet automatikisht me një nga rrjetet kryesore celulare lokale në shtetet e mbuluara, me teknologji 5G ose 4G LTE.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide high quality 4G LTE network connection subject to network availability.', 'Disponueshmëria e 5G varet nga mbulimi i rrjetit, specifikimet rajonale të pajisjes dhe cilësimet e telefonit. Aty ku 5G nuk është i disponueshëm, eSIM-i ofron lidhje cilësore 4G LTE, në varësi të disponueshmërisë së rrjetit.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide high quality 4G network connection subject to network availability.', 'Disponueshmëria e 5G varet nga mbulimi i rrjetit, specifikimet rajonale të pajisjes dhe cilësimet e telefonit. Aty ku 5G nuk është i disponueshëm, eSIM-i ofron lidhje cilësore 4G, në varësi të disponueshmërisë së rrjetit.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide 4G network connection subject to network availability.', 'Disponueshmëria e 5G varet nga mbulimi i rrjetit, specifikimet rajonale të pajisjes dhe cilësimet e telefonit. Aty ku 5G nuk është i disponueshëm, eSIM-i ofron lidhje 4G, në varësi të disponueshmërisë së rrjetit.'],
  ['Usable only with eSIM compatible phones and tablets which are not carrier locked. If in doubt, please check the FAQ section.', 'Përdoret vetëm në telefona dhe tableta që mbështesin eSIM dhe nuk janë të bllokuara për një operator. Nëse ke paqartësi, kontrollo seksionin e pyetjeve të shpeshta.'],
  ['Android phone users must manually adjust APN settings to use this eSIM', 'Përdoruesit e telefonave Android duhet të rregullojnë manualisht cilësimet APN për të përdorur këtë eSIM.'],
  ['Switzerland coverage is not included in this package.', 'Kjo paketë nuk përfshin mbulim në Zvicër.'],
  ['Unrestricted', 'Pa kufizim të shpejtësisë'],
  ['Full data speeds - no daily limits, no throttling', 'Shpejtësi e plotë, pa kufij ditorë dhe pa ulje të shpejtësisë'],
  ['Package activates upon eSIM installation.', 'Paketa aktivizohet gjatë instalimit të eSIM-it.'],
  ['Package activates upon purchase.', 'Paketa aktivizohet në momentin e blerjes.'],
  ['Package activates upon first data usage.', 'Paketa aktivizohet me përdorimin e parë të internetit.'],
  ['Package activates upon connecting to a supported network.', 'Paketa aktivizohet kur lidhet me një rrjet të mbështetur.'],
  ['Package activates upon connecting to network.', 'Paketa aktivizohet kur lidhet me rrjetin.']
  ]),
  it: map([
  ['INSTANT DELIVERY - READY TO CONNECT - PREPAID - NO CONTRACT', 'CONSEGNA IMMEDIATA - PRONTA PER LA CONNESSIONE - PREPAGATA - SENZA CONTRATTO'],
  ['This is a data-only eSIM. It does not come with a phone number.', 'Questa eSIM include solo dati. Non include un numero di telefono.'],
  ['Simply scan the QR code to download and use the eSIM. No other activation or registration steps needed.', 'Basta scansionare il codice QR per scaricare e usare la eSIM. Non servono altri passaggi di attivazione o registrazione.'],
  ['One-time prepaid package. No auto-renewals, no contracts. The eSIM is rechargeable and can be topped up with additional data packages.', 'Pacchetto prepagato con pagamento unico. Nessun rinnovo automatico, nessun contratto. La eSIM è ricaricabile con pacchetti dati aggiuntivi.'],
  ['One-time prepaid package. No auto-renewals, no contracts.', 'Pacchetto prepagato con pagamento unico. Nessun rinnovo automatico, nessun contratto.'],
  ['Full data speeds - no daily limits, no throttling. Mobile hotspot is supported.', 'Velocità dati piena, senza limiti giornalieri e senza riduzioni di velocità. L’hotspot mobile è supportato.'],
  ['The eSIM will automatically connect to a major local mobile network in eligible countries with 5G or 4G LTE speeds.', 'La eSIM si collega automaticamente a una delle principali reti mobili locali nei paesi coperti, con tecnologia 5G o 4G LTE.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide high quality 4G LTE network connection subject to network availability.', 'La disponibilità del 5G dipende dalla copertura di rete, dalle specifiche regionali del dispositivo e dalle impostazioni del telefono. Dove il 5G non è disponibile, la eSIM offre una connessione 4G LTE di alta qualità, in base alla disponibilità della rete.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide high quality 4G network connection subject to network availability.', 'La disponibilità del 5G dipende dalla copertura di rete, dalle specifiche regionali del dispositivo e dalle impostazioni del telefono. Dove il 5G non è disponibile, la eSIM offre una connessione 4G di alta qualità, in base alla disponibilità della rete.'],
  ['5G availability depends on network coverage, regional device specifications, and phone settings. Where 5G is not available the eSIM will provide 4G network connection subject to network availability.', 'La disponibilità del 5G dipende dalla copertura di rete, dalle specifiche regionali del dispositivo e dalle impostazioni del telefono. Dove il 5G non è disponibile, la eSIM offre una connessione 4G, in base alla disponibilità della rete.'],
  ['Usable only with eSIM compatible phones and tablets which are not carrier locked. If in doubt, please check the FAQ section.', 'Utilizzabile solo con telefoni e tablet compatibili con eSIM e non bloccati da un operatore. In caso di dubbi, consulta la sezione delle domande frequenti.'],
  ['Android phone users must manually adjust APN settings to use this eSIM', 'Sui telefoni Android occorre configurare manualmente le impostazioni APN per usare questa eSIM.'],
  ['Switzerland coverage is not included in this package.', 'Questo pacchetto non include la copertura in Svizzera.'],
  ['Unrestricted', 'Senza limiti di velocità'],
  ['Full data speeds - no daily limits, no throttling', 'Velocità piena, senza limiti giornalieri e senza riduzioni di velocità'],
  ['Package activates upon eSIM installation.', 'Il pacchetto si attiva con l’installazione della eSIM.'],
  ['Package activates upon purchase.', 'Il pacchetto si attiva al momento dell’acquisto.'],
  ['Package activates upon first data usage.', 'Il pacchetto si attiva al primo utilizzo dei dati.'],
  ['Package activates upon connecting to a supported network.', 'Il pacchetto si attiva alla connessione a una rete supportata.'],
  ['Package activates upon connecting to network.', 'Il pacchetto si attiva alla connessione alla rete.']
  ])
 };
 return (value,language) => {
  const translated=maps[language];
  if(!translated)return String(value??'');
  const text=normalize(value);
  if(translated.has(text))return translated.get(text);
  const expiry=text.match(/^The eSIM will expire if not activated within (\d+) months? of purchase\.$/);
  if(expiry)return language==='sq'?`eSIM-i skadon nëse nuk aktivizohet brenda ${expiry[1]} ${expiry[1]==='1'?'muaji':'muajve'} nga blerja.`:`La eSIM scade se non viene attivata entro ${expiry[1]} ${expiry[1]==='1'?'mese':'mesi'} dall’acquisto.`;
  // Unrecognized terms must remain faithful to the supplier, never be guessed.
  return String(value??'');
 };
})();
