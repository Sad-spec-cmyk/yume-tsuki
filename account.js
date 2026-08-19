(() => {
  const $ = s => document.querySelector(s);
  const api = (...args) => window.YUME_ACCOUNT.request(...args);
  const feature = (...args) => window.YUME_ACCOUNT.feature(...args);
  const authView = $('#authView');
  const profileView = $('#profileView');
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let currentUser = null;

  function status(name,text='',type=''){const el=document.querySelector(`[data-status="${name}"]`);if(!el)return;el.textContent=text;el.className=`form-status ${type}`;}
  function initial(user){return(user?.displayName||user?.username||'Y').trim().slice(0,1).toUpperCase()||'Y';}
  function setAvatar(el,user){if(!el)return;if(user?.avatarUrl)el.innerHTML=`<img src="${esc(user.avatarUrl)}" alt="">`;else el.innerHTML=`<span>${esc(initial(user))}</span>`;}
  function ensurePublicProfileButton(){
    const actions=document.querySelector('.profile-actions');if(!actions||$('#publicProfileBtn'))return;
    actions.insertAdjacentHTML('afterbegin','<a id="publicProfileBtn" class="btn ghost" href="/profile">Публичный профиль</a>');
  }
  function ensureFavoritesSection(){
    if($('#favoritesSection'))return;
    document.querySelector('.history-section')?.insertAdjacentHTML('beforebegin',`<section id="favoritesSection" class="history-section favorites-section"><div class="section-head"><div><span class="section-kicker">ИЗБРАННОЕ</span><h2>Сохранённые аниме</h2></div><span id="favoritesCount" class="status">0 тайтлов</span></div><div id="favoritesGrid" class="favorites-grid"></div><div id="favoritesEmpty" class="empty hidden">В избранном пока ничего нет.</div></section>`);
  }
  function renderUser(user){
    currentUser=user||null;const logged=!!user;authView.classList.toggle('hidden',logged);profileView.classList.toggle('hidden',!logged);if(!user)return;
    ensurePublicProfileButton();ensureFavoritesSection();
    $('#publicProfileBtn').href=`/profile?u=${encodeURIComponent(user.username)}`;
    setAvatar($('#profileAvatar'),user);setAvatar($('#previewAvatar'),user);$('#profileName').textContent=user.displayName||user.username;$('#profileHandle').textContent=`@${user.username}`;$('#profileBio').textContent=user.bio||'Настрой профиль под себя.';$('#displayNameInput').value=user.displayName||user.username;$('#bioInput').value=user.bio||'';$('#accentInput').value=user.accent||'#ff395f';$('#accentValue').textContent=user.accent||'#ff395f';
    const joined=user.createdAt?new Date(user.createdAt).toLocaleDateString('ru-RU',{day:'2-digit',month:'long',year:'numeric'}):'';$('#profileJoined').textContent=joined?`С нами с ${joined}`:'Профиль Yume Tsuki';
    const cover=$('#profileCover');cover.style.backgroundImage=user.bannerUrl?`linear-gradient(180deg,rgba(7,8,12,.04),rgba(7,8,12,.68)),url('${String(user.bannerUrl).replaceAll("'","%27")}')`:'';
    loadHistory();loadStats();loadFavorites();
  }
  async function submitAuth(form,action,key){status(key,'Подождите...');const data=Object.fromEntries(new FormData(form));try{const result=await api(action,{method:'POST',body:JSON.stringify(data)});window.YUME_ACCOUNT.setUser(result.user);renderUser(result.user);status(key,'Готово.','success');form.reset();const next=new URL(location.href).searchParams.get('next');if(next)location.href=next;}catch(e){status(key,e.message,'error');}}
  $('#loginForm').addEventListener('submit',e=>{e.preventDefault();submitAuth(e.currentTarget,'login','login')});
  $('#registerForm').addEventListener('submit',e=>{e.preventDefault();submitAuth(e.currentTarget,'register','register')});
  $('#profileForm').addEventListener('submit',async e=>{e.preventDefault();status('profile','Сохраняем...');const data=Object.fromEntries(new FormData(e.currentTarget));try{const result=await api('profile',{method:'POST',body:JSON.stringify(data)});window.YUME_ACCOUNT.setUser(result.user);renderUser(result.user);status('profile','Профиль сохранён.','success');}catch(err){status('profile',err.message,'error');}});
  $('#accentInput').addEventListener('input',e=>{document.documentElement.style.setProperty('--accent',e.target.value);$('#accentValue').textContent=e.target.value;});
  $('#logoutBtn').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:'{}'});}catch{}window.YUME_ACCOUNT.setUser(null);renderUser(null);});

  function cropToDataUrl(file,width,height,quality=.86){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать изображение.'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Не удалось открыть изображение.'));img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),scale=Math.max(width/img.width,height/img.height),sw=width/scale,sh=height/scale,sx=(img.width-sw)/2,sy=(img.height-sh)/2;ctx.drawImage(img,sx,sy,sw,sh,0,0,width,height);resolve(canvas.toDataURL('image/webp',quality));};img.src=reader.result;};reader.readAsDataURL(file);});}
  async function uploadPhoto(file,kind){if(!file)return;const target=kind==='avatar'?$('#profileAvatar'):$('#profileCover');target.classList.add('uploading');try{const dataUrl=await cropToDataUrl(file,kind==='avatar'?512:1600,kind==='avatar'?512:520,kind==='avatar' ? .9 : .84);if(kind==='avatar')$('#profileAvatar').innerHTML=`<img src="${dataUrl}" alt="">`;else $('#profileCover').style.backgroundImage=`linear-gradient(180deg,rgba(7,8,12,.04),rgba(7,8,12,.68)),url('${dataUrl}')`;const result=await api('media',{method:'POST',body:JSON.stringify({kind,dataUrl})});window.YUME_ACCOUNT.setUser(result.user);renderUser(result.user);}catch(e){alert(e.message||'Не удалось загрузить фото.');}finally{target.classList.remove('uploading');}}
  $('#changeAvatarBtn').addEventListener('click',()=>$('#avatarFile').click());$('#changeBannerBtn').addEventListener('click',()=>$('#bannerFile').click());$('#avatarFile').addEventListener('change',e=>uploadPhoto(e.target.files?.[0],'avatar'));$('#bannerFile').addEventListener('change',e=>uploadPhoto(e.target.files?.[0],'banner'));

  function cleanAnimeHref(item){if(item.alias)return`/anime?alias=${encodeURIComponent(item.alias)}`;if(item.animeId)return`/anime?id=${encodeURIComponent(item.animeId)}`;return`/anime?q=${encodeURIComponent(item.title||'')}`;}
  async function loadHistory(){
    $('#historyStatus').textContent='Загрузка...';
    try{const{items=[]}=await api('history',{method:'GET',headers:{}});$('#historyStatus').textContent=`${items.length} тайтлов`;$('#historyCountBadge').textContent=`${items.length} тайтлов`;const grid=$('#historyGrid'),empty=$('#historyEmpty');grid.innerHTML=items.map(item=>{const date=item.watchedAt?new Date(item.watchedAt).toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}):'';const href=cleanAnimeHref(item);const progress=item.duration>0?Math.min(100,Math.round((item.lastPosition/item.duration)*100)):0;return`<a class="history-item" href="${esc(href)}"><img class="history-poster" src="${esc(item.poster||'')}" alt="" onerror="this.style.visibility='hidden'"><div class="history-copy"><strong>${esc(item.title)}</strong><span>${esc(item.episode||'Просмотр начат')}${date?` · ${esc(date)}`:''}</span>${progress?`<div class="history-progress"><i style="width:${progress}%"></i></div>`:''}</div></a>`;}).join('');empty.classList.toggle('hidden',items.length>0);}catch{$('#historyStatus').textContent='Ошибка';}
  }
  async function loadFavorites(){
    ensureFavoritesSection();const grid=$('#favoritesGrid'),empty=$('#favoritesEmpty');
    try{const{items=[]}=await feature('favorites',{method:'GET',headers:{}});$('#favoritesCount').textContent=`${items.length} тайтлов`;grid.innerHTML=items.map(item=>`<a class="favorite-card" href="${esc(cleanAnimeHref(item))}"><div class="favorite-card-poster"><img src="${esc(item.poster||'')}" alt="" onerror="this.style.visibility='hidden'"></div><div><strong>${esc(item.title)}</strong><span>${esc([item.type,item.year].filter(Boolean).join(' · '))}</span></div></a>`).join('');empty.classList.toggle('hidden',items.length>0);}catch{if(grid)grid.innerHTML='';if(empty){empty.textContent='Не удалось загрузить избранное.';empty.classList.remove('hidden');}}
  }
  function formatHours(value){const n=Number(value||0);if(n<1)return`${Math.round(n*60)} мин`;return`${n.toFixed(n<10?1:0)} ч`;}
  async function loadStats(){try{const s=await api('stats',{method:'GET',headers:{}});$('#statTitles').textContent=s.titles||0;$('#statEpisodes').textContent=s.episodes||0;$('#statHours').textContent=formatHours(s.watchHours||0);$('#statStreak').textContent=s.streak||0;$('#completedEpisodes').textContent=s.completed||0;$('#activityDaysSmall').textContent=s.activityDays||0;$('#activityDays').textContent=`${s.activityDays||0} активных дней`;$('#activityTotal').textContent=formatHours(s.watchHours||0);$('#donutValue').textContent=s.episodes||0;const ratio=s.episodes?Math.min(100,Math.round(((s.completed||0)/s.episodes)*100)):0;$('#watchDonut').style.setProperty('--donut',`${ratio}%`);const max=Math.max(1,...(s.last14||[]).map(d=>Number(d.watchSeconds||0)));$('#activityChart').innerHTML=(s.last14||[]).map(d=>{const minutes=Math.round((d.watchSeconds||0)/60),h=Math.max(5,Math.round((Number(d.watchSeconds||0)/max)*100)),day=new Date(`${d.date}T12:00:00Z`).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});return`<div class="activity-bar" style="height:${h}%" data-label="${day} · ${minutes} мин"></div>`;}).join('');$('#genreStats').innerHTML=(s.genres||[]).length?(s.genres||[]).map(g=>`<span class="genre-chip">${esc(g.name)} <b>${g.count}</b></span>`).join(''):'<span class="muted">Пока недостаточно данных</span>';}catch{}}
  $('#clearHistoryBtn').addEventListener('click',async()=>{if(!confirm('Очистить всю историю и статистику просмотра?'))return;try{await api('history',{method:'DELETE',body:'{}'});loadHistory();loadStats();}catch(e){alert(e.message);}});
  document.addEventListener('yume:session',e=>renderUser(e.detail.user));if(window.YUME_ACCOUNT.ready)renderUser(window.YUME_ACCOUNT.user);
})();
