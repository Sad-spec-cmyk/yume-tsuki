(() => {
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const api=(...args)=>window.YUME_ACCOUNT.request(...args);
  let lastSignature='';
  let loading=false;

  function renderSession(user){
    $('#chatGuest').classList.toggle('hidden',!!user);
    $('#chatForm').classList.toggle('hidden',!user);
    if(user) $('#composerAvatar').textContent=user.avatar||'🌙';
  }

  function formatTime(ts){
    const d=new Date(Number(ts)||Date.now());
    const today=new Date();
    return d.toDateString()===today.toDateString()
      ? d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
      : d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  }

  async function loadMessages(force=false){
    if(loading)return; loading=true;
    try{
      const {messages=[]}=await api('chat',{method:'GET',headers:{}});
      const signature=messages.map(m=>m.id).join('|');
      if(force||signature!==lastSignature){
        const box=$('#messages');
        const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;
        box.innerHTML=messages.length?messages.map(m=>`<article class="message"><div class="message-avatar" style="--msg-accent:${esc(m.user?.accent||'#ff395f')}">${esc(m.user?.avatar||'🌙')}</div><div class="message-body"><div class="message-meta"><strong>${esc(m.user?.displayName||m.user?.username||'Пользователь')}</strong><span>@${esc(m.user?.username||'user')} · ${esc(formatTime(m.createdAt))}</span></div><div class="message-text">${esc(m.text)}</div></div></article>`).join(''):'<div class="chat-loading">Сообщений пока нет. Будь первым.</div>';
        if(nearBottom||force) box.scrollTop=box.scrollHeight;
        lastSignature=signature;
      }
      $('#chatStatus').textContent='';
    }catch(e){$('#chatStatus').textContent='Не удалось обновить чат.';}
    finally{loading=false;}
  }

  $('#chatInput').addEventListener('input',e=>{
    $('#charCount').textContent=`${e.target.value.length}/500`;
    e.target.style.height='auto';e.target.style.height=`${Math.min(e.target.scrollHeight,130)}px`;
  });

  $('#chatForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const input=$('#chatInput'); const text=input.value.trim(); if(!text)return;
    const btn=e.currentTarget.querySelector('button[type="submit"]'); btn.disabled=true;
    try{
      await api('chat',{method:'POST',body:JSON.stringify({text})});
      input.value=''; input.style.height='auto'; $('#charCount').textContent='0/500';
      await loadMessages(true);
    }catch(err){$('#chatStatus').textContent=err.message;}
    finally{btn.disabled=false;}
  });

  document.addEventListener('yume:session',e=>renderSession(e.detail.user));
  if(window.YUME_ACCOUNT.ready) renderSession(window.YUME_ACCOUNT.user);
  loadMessages(true);
  setInterval(()=>loadMessages(false),5000);
})();
