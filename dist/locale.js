// Store an explicit choice separately from an automatically detected language.
window.MobialoLocale=(()=>{
  const supported=['en','sq','it'];
  let manual=null,current='en';
  try{const saved=localStorage.getItem('mobialo-language-choice');if(['en','sq'].includes(saved))manual=saved;}catch{}
  function remember(){try{sessionStorage.setItem('mobialo-active-language',current);}catch{}}
  const ready=(async()=>{
    if(manual){current=manual;remember();return current;}
    try{const response=await fetch('/api/locale',{cache:'no-store',signal:AbortSignal.timeout(3000)});if(response.ok){const data=await response.json();if(!manual&&supported.includes(data.language))current=data.language;}}catch{}
    if(manual)current=manual;remember();return current;
  })();
  return {ready,get current(){return current;},choose(value){if(!['en','sq'].includes(value))return;manual=value;current=value;try{localStorage.setItem('mobialo-language-choice',value);localStorage.setItem('mobialo-language',value);}catch{}remember();},syncSelect(select,value){select.querySelector('[data-auto-language]')?.remove();if(value==='it'){const option=document.createElement('option');option.value='it';option.textContent='IT · Auto';option.hidden=true;option.disabled=true;option.dataset.autoLanguage='true';select.prepend(option);}select.value=value;}};
})();
