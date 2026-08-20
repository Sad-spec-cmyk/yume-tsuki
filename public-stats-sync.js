(() => {
  if (window.__YUME_PUBLIC_STATS_SYNC_V1) return;
  window.__YUME_PUBLIC_STATS_SYNC_V1 = true;
  const $=s=>document.querySelector(s);
  const username=(new URL(location.href).searchParams.get('u')||'').trim();
  const hours=v=>{const n=Number(v||0);return n<1?`${Math.round(n*60)} мин`:`${n.toFixed(n<10?1:0)} ч`;};
  async function apply(){
    if(!username)return;
    try{
      const r=await fetch(`/.netlify/functions/public-stats?username=${encodeURIComponent(username)}`,{headers:{accept:'application/json'},cache:'no-store'});const s=await r.json();if(!r.ok)return;
      for(let i=0;i<40;i++){
        if($('#pubTitles')){
          $('#pubTitles').textContent=s.titles||0;
          $('#pubEpisodes').textContent=s.episodes||0;
          $('#pubHours').textContent=hours(s.watchHours||0);
          return;
        }
        await new Promise(res=>setTimeout(res,100));
      }
    }catch{}
  }
  if(window.YUME_ACCOUNT?.ready)apply();else document.addEventListener('yume:session',apply,{once:true});
})();