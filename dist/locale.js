// Store an explicit choice separately from an automatically detected language.
window.MobialoLocale=(()=>{
  const supported=['en','sq','it'];
  let manual=null,current='en',emailLanguage='en',detected=false,settled=false;
  const emailLanguages=['en', 'sq', 'it', 'fr', 'de', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'tr', 'bg', 'hr', 'sr', 'mk', 'sl', 'cs', 'sk', 'hu', 'sv', 'no', 'da', 'fi', 'uk', 'ru', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'id', 'ms', 'th', 'vi'];
  try{const saved=localStorage.getItem('mobialo-language-choice');if(supported.includes(saved))manual=saved;}catch{}
  // A detection is reused for the browser session, and for 30 days in later sessions, so pages skip /api/locale.
  const DETECTION_DAYS=30;
  try{
    let [language,email]=(sessionStorage.getItem('mobialo-detected-language')||'').split(':');
    if(!language){const [lang,mail,at]=(localStorage.getItem('mobialo-detected-language')||'').split(':');if(Date.now()-Number(at)<DETECTION_DAYS*864e5){language=lang;email=mail;}}
    if(supported.includes(language)&&emailLanguages.includes(email)){current=language;emailLanguage=email;detected=true;try{sessionStorage.setItem('mobialo-detected-language',language+':'+email);}catch{}}
  }catch{}
  function remember(){try{sessionStorage.setItem('mobialo-active-language',current);}catch{}}
  const ready=(async()=>{
    if(manual){emailLanguage=manual;current=manual;remember();settled=true;return current;}
    if(!detected)try{const response=await fetch('/api/locale',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(response.ok){const data=await response.json();if(!manual){if(supported.includes(data.language))current=data.language;emailLanguage=emailLanguages.includes(data.emailLanguage)?data.emailLanguage:current;try{sessionStorage.setItem('mobialo-detected-language',current+':'+emailLanguage);localStorage.setItem('mobialo-detected-language',current+':'+emailLanguage+':'+Date.now());}catch{}}}}catch{}
    if(manual)current=manual;remember();settled=true;return current;
  })();
  // A <head> snippet hides a page whose static text may be in another language (html.lang-pending, 1.2 s at most).
  // It is shown once the language is known and the page scripts, which render after `ready`, have run.
  if(typeof document!=='undefined'&&document.documentElement)Promise.all([ready,document.readyState==='loading'&&new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}))]).then(()=>setTimeout(()=>document.documentElement.classList.remove('lang-pending')));
  return {ready,get current(){return current;},get settled(){return settled;},get emailLanguage(){return manual||emailLanguage;},choose(value){if(!supported.includes(value))return;manual=value;current=value;try{localStorage.setItem('mobialo-language-choice',value);localStorage.setItem('mobialo-language',value);}catch{}remember();},syncSelect(select,value){if(!select.querySelector('option[value="it"]')){const option=document.createElement('option');option.value='it';option.textContent='IT';select.append(option);}select.querySelector('[data-auto-language]')?.remove();const automatic=!manual&&emailLanguage!==value;if(automatic){const option=document.createElement('option');option.value='auto';option.textContent=value.toUpperCase()+' · Auto';option.hidden=true;option.disabled=true;option.dataset.autoLanguage='true';select.prepend(option);}select.value=automatic?'auto':value;}};
})();
