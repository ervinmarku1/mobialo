// Store an explicit choice separately from an automatically detected language.
window.MobialoLocale=(()=>{
  const supported=['en','sq','it'];
  let manual=null,current='en',emailLanguage='en';
  const emailLanguages=['en', 'sq', 'it', 'fr', 'de', 'es', 'pt', 'nl', 'pl', 'ro', 'el', 'tr', 'bg', 'hr', 'sr', 'mk', 'sl', 'cs', 'sk', 'hu', 'sv', 'no', 'da', 'fi', 'uk', 'ru', 'ar', 'he', 'hi', 'zh', 'ja', 'ko', 'id', 'ms', 'th', 'vi'];
  try{const saved=localStorage.getItem('mobialo-language-choice');if(['en','sq'].includes(saved))manual=saved;}catch{}
  function remember(){try{sessionStorage.setItem('mobialo-active-language',current);}catch{}}
  const ready=(async()=>{
    if(manual){emailLanguage=manual;current=manual;remember();return current;}
    try{const response=await fetch('/api/locale',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(response.ok){const data=await response.json();if(!manual){if(supported.includes(data.language))current=data.language;emailLanguage=emailLanguages.includes(data.emailLanguage)?data.emailLanguage:current;}}}catch{}
    if(manual)current=manual;remember();return current;
  })();
  return {ready,get current(){return current;},get emailLanguage(){return manual||emailLanguage;},choose(value){if(!['en','sq'].includes(value))return;manual=value;current=value;try{localStorage.setItem('mobialo-language-choice',value);localStorage.setItem('mobialo-language',value);}catch{}remember();},syncSelect(select,value){select.querySelector('[data-auto-language]')?.remove();const automatic=value==='it'||(!manual&&emailLanguage!==value);if(automatic){const option=document.createElement('option');option.value='auto';option.textContent=value.toUpperCase()+' ? Auto';option.hidden=true;option.disabled=true;option.dataset.autoLanguage='true';select.prepend(option);}select.value=automatic?'auto':value;}};
})();
