(() => {
  const $ = s => document.querySelector(s);
  const api = (...args) => window.YUME_ACCOUNT.request(...args);
  const authView = $('#authView');
  const profileView = $('#profileView');
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function status(name, text='', type=''){
    const el = document.querySelector(`[data-status="${name}"]`);
    if(!el) return;
    el.textContent=text; el.className=`form-status ${type}`;
  }

  function renderUser(user){
    const logged = !!user;
    authView.classList.toggle('hidden', logged);
    profileView.classList.toggle('hidden', !logged);
    if(!user) return;
    $('#profileAvatar').textContent=user.avatar||'🌙';
    $('#previewAvatar').textContent=user.avatar||'🌙';
    $('#profileName').textContent=user.displayName||user.username;
    $('#profileHandle').textContent=`@${user.username}`;
    $('#profileBio').textContent=user.bio||'Настрой профиль под себя.';
    $('#displayNameInput').value=user.displayName||user.username;
    $('#bioInput').value=user.bio||'';
    $('#avatarInput').value=user.avatar||'🌙';
    $('#accentInput').value=user.accent||'#ff395f';
    loadHistory();
  }

  async function submitAuth(form, action, key){
    status(key,'Подождите...');
    const data=Object.fromEntries(new FormData(form));
    try{
      const result=await api(action,{method:'POST',body:JSON.stringify(data)});
      window.YUME_ACCOUNT.setUser(result.user);
      renderUser(result.user);
      status(key,'Готово.','success');
      form.reset();
    }catch(e){status(key,e.message,'error');}
  }

  $('#loginForm').addEventListener('submit',e=>{e.preventDefault();submitAuth(e.currentTarget,'login','login')});
  $('#registerForm').addEventListener('submit',e=>{e.preventDefault();submitAuth(e.currentTarget,'register','register')});

  $('#profileForm').addEventListener('submit',async e=>{
    e.preventDefault(); status('profile','Сохраняем...');
    const data=Object.fromEntries(new FormData(e.currentTarget));
    try{
      const result=await api('profile',{method:'POST',body:JSON.stringify(data)});
      window.YUME_ACCOUNT.setUser(result.user); renderUser(result.user);
      status('profile','Профиль сохранён.','success');
    }catch(err){status('profile',err.message,'error');}
  });

  $('#avatarPresets').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b)return;
    $('#avatarInput').value=b.textContent.trim(); $('#previewAvatar').textContent=b.textContent.trim();
  });
  $('#avatarInput').addEventListener('input',e=>$('#previewAvatar').textContent=e.target.value||'🌙');
  $('#accentInput').addEventListener('input',e=>document.documentElement.style.setProperty('--accent',e.target.value));

  $('#logoutBtn').addEventListener('click',async()=>{
    try{await api('logout',{method:'POST',body:'{}'});}catch{}
    window.YUME_ACCOUNT.setUser(null); renderUser(null);
  });

  async function loadHistory(){
    $('#historyStatus').textContent='Загрузка...';
    try{
      const {items=[]}=await api('history',{method:'GET',headers:{}});
      $('#historyCount').textContent=items.length;
      $('#historyStatus').textContent=`${items.length} тайтлов`;
      const grid=$('#historyGrid'), empty=$('#historyEmpty');
      grid.innerHTML=items.map(item=>{
        const date=item.watchedAt?new Date(item.watchedAt).toLocaleDateString('ru-RU',{day:'2-digit',month:'short'}):'';
        const href=item.href||`./search.html?q=${encodeURIComponent(item.title||'')}`;
        return `<a class="history-item" href="${esc(href)}"><img class="history-poster" src="${esc(item.poster||'')}" alt="" onerror="this.style.visibility='hidden'"><div class="history-copy"><strong>${esc(item.title)}</strong><span>${esc(item.episode||'Просмотр начат')}${date?` · ${esc(date)}`:''}</span></div></a>`;
      }).join('');
      empty.classList.toggle('hidden',items.length>0);
    }catch(e){$('#historyStatus').textContent='Ошибка';}
  }

  $('#clearHistoryBtn').addEventListener('click',async()=>{
    if(!confirm('Очистить всю историю просмотра?')) return;
    try{await api('history',{method:'DELETE',body:'{}'});loadHistory();}catch(e){alert(e.message);}
  });

  document.addEventListener('yume:session',e=>renderUser(e.detail.user));
  if(window.YUME_ACCOUNT.ready) renderUser(window.YUME_ACCOUNT.user);
})();
