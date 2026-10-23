import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TERMS_VERSION} from './terms-version.mjs';

// The Terms and the Delivery & refund policy as published by their page scripts (dist/terms.js,
// dist/delivery-refunds.js), so the copy attached to the order confirmation is the text the buyer accepted.
// Each script names its version in its first comment ("Version v1.0 of 22.10.2026"), the terms_version recorded
// with the checkout consent; api/worker/sweep.mjs ships both files through includeFiles in vercel.json.
const SOURCES=[
  {file:'terms.js',page:'terms.html',name:{sq:'kushtet',en:'terms',it:'termini'}},
  {file:'delivery-refunds.js',page:'delivery-refunds.html',name:{sq:'dergesa-dhe-rimbursimi',en:'delivery-and-refunds',it:'consegna-e-rimborso'}}
];
// Fingerprints (SHA-256 of the parsed text in all three languages) of every accepted version. A text change that
// keeps the version is refused: the tests fail and the worker attaches nothing, so no buyer is ever sent wording
// they did not accept under the version their order recorded.
export const DIGESTS={
  'v1.0-2026-10-22':{'terms.js':'9dbf68a22e472e16672ee6571f2606605182dd02d3b44756ade4833f59d3a821','delivery-refunds.js':'c0f3d81f2ffa9763f83b3b891c3f136cba3fe9dae9ef595e739b5bc58a9cbd0e'}
};
const LANGUAGES=['sq','en','it'];
const LABELS={sq:'Versioni',en:'Version',it:'Versione'};
const IDENTITY=['iSmart Shop & Service','NIPT: L71614008L','Rruga Tom Plezha, Yzberisht, Tiranë, Shqipëri','support@mobialo.eu'];
const read=file=>readFileSync(new URL('../dist/'+file,import.meta.url),'utf8');

export function parseLegalDocument(source){
  const version=/Version (v\d+\.\d+) of (\d{2})\.(\d{2})\.(\d{4})/.exec(source);
  const literal=/const copy=([\s\S]*?\});\r?\nlet language=/.exec(source);
  if(!version||!literal)throw Error('LEGAL_DOCUMENT_UNREADABLE');
  // The page's own object literal, evaluated without access to anything else; JSON gives plain arrays of this realm.
  const copy=JSON.parse(JSON.stringify(vm.runInNewContext('('+literal[1]+')',{},{timeout:1000})));
  for(const language of LANGUAGES){
    const t=copy[language];
    if(typeof t?.title!=='string'||typeof t.notice!=='string'||!Array.isArray(t.sections)||!t.sections.length||!t.sections.every(s=>Array.isArray(s)&&s.length===2&&s.every(v=>typeof v==='string'&&v)))throw Error('LEGAL_DOCUMENT_UNREADABLE');
  }
  return {version:`${version[1]}-${version[4]}-${version[3]}-${version[2]}`,copy,digest:createHash('sha256').update(JSON.stringify(copy)).digest('hex')};
}

// Parsed once per process; a failed read is tried again on the next call.
let parsed=null;
function load(reader){
  if(reader===read&&parsed)return parsed;
  const documents=SOURCES.map(source=>({...source,...parseLegalDocument(reader(source.file))}));
  if(reader===read)parsed=documents;
  return documents;
}

// The documents of the version the order recorded, as plain-text attachments in the order's language.
// An order without that version (none recorded, or the pages have moved on) gets none; a published text that no
// longer matches its version's fingerprint is refused (LEGAL_DOCUMENT_CHANGED), never attached.
export function legalDocuments(language,version,{reader=read,digests=DIGESTS}={}){
  const lang=LANGUAGES.includes(language)?language:'en';
  const matching=load(reader).filter(d=>version&&d.version===version);
  if(matching.some(d=>digests[version]?.[d.file]!==d.digest))throw Error('LEGAL_DOCUMENT_CHANGED');
  return matching.map(d=>{
    const t=d.copy[lang];
    const text=[t.title,`${LABELS[lang]}: ${d.version}`,t.notice,...t.sections.map(([heading,body])=>heading+'\r\n'+body),IDENTITY.join('\r\n'),'https://www.mobialo.eu/'+d.page].join('\r\n\r\n')+'\r\n';
    return {title:t.title,filename:`MOBIALO-${d.name[lang]}-${d.version}.txt`,text};
  });
}

// For the worker heartbeat: whether this deployment attaches both documents, in every language, to the
// confirmations of the version checkout records now.
export function legalDocumentsReady({reader=read,version=TERMS_VERSION,digests=DIGESTS}={}){
  try{return LANGUAGES.every(language=>legalDocuments(language,version,{reader,digests}).length===SOURCES.length);}catch{return false;}
}
