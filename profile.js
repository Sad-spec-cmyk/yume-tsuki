(() => {
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const username=(new URL(location.href).searchParams.get('u')||'').trim();
  const feature=(...args)=>window.YUME_ACCOUNT.feature(...args);
  const animeHref=item=>item.alias?`/anime?alias=${encodeURIComponent(item.alias)}`:item.animeId?`/anime?id=${encodeURIComponent(item.animeId)}`:`/anime?q=${encodeURIComponent(item.title||'')}`;
  function initial(u){return(u?.displayName||u?.username||'Y').slice(0,1).toUpperCase();}
  function hours(v){const n=Number(v||0);return n<1?`${Math.round(n*60)} мин`:`${n.toFixed(n<10?1:0)} ч`;}
  async function render(){
    if(!username){$('#profileLoading').innerHTML='<h1>Профиль не указан</h1><p>Откройте профиль через имя пользователя.</p>';return;}
    try{
      const {user,stats={}}=await feature('public-profile',{method:'GET',headers:{}},{username});
      document.title=`${user.displayName||user.username} — Yume Tsuki`;
      document.documentElement.style.setProperty('--accent',user.accent||'#ff395f');
      $('#publicName').textContent=user.displayName||user.username;$('#publicHandle').textContent=`@${user.username}`;$('#publicBio').textContent=user.bio||'Пользователь пока ничего о себе не написал.';
      $('#publicAvatar').innerHTML=user.avatarUrl?`<img src="${esc(user.avatarUrl)}" alt="">`:esc(initial(user));
      if(user.bannerUrl)$('#publicCover').style.backgroundImage=`linear-gradient(180deg,rgba(7,8,12,.05),rgba(7,8,12,.58)),url('${String(user.bannerUrl).replaceAll("'","%27")}')`;
      const joined=user.createdAt?new Date(user.createdAt).toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'}):'';$('#publicJoined').textContent=joined?`На Yume Tsuki с ${joined}`:'';
      $('#pubTitles').textContent=stats.titles||0;$('#pubEpisodes').textContent=stats.episodes||0;$('#pubHours').textContent=hours(stats.watchHours||0);$('#pubFavCount').textContent=stats.favoriteCount||0;
      const favs=stats.favorites||[],grid=$('#publicFavorites');grid.innerHTML=favs.map(item=>`<a class="public-favorite-card" href="${esc(animeHref(item))}"><div class="poster"><img src="${esc(item.poster||'')}" alt="" onerror="this.style.visibility='hidden'"></div><strong>${esc(item.title)}</strong></a>`).join('');$('#publicFavoritesEmpty').classList.toggle('hidden',favs.length>0);
      const showEdit=window.YUME_ACCOUNT?.user?.username===user.username;$('#editOwnProfile').classList.toggle('hidden',!showEdit);
      $('#profileLoading').classList.add('hidden');$('#publicProfile').classList.remove('hidden');
    }catch(e){$('#profileLoading').innerHTML=`<h1>Профиль не найден</h1><p>${esc(e.message||'Не удалось загрузить профиль.')}</p>`;}
  }
  if(window.YUME_ACCOUNT?.ready)render();else document.addEventListener('yume:session',render,{once:true});
})();
