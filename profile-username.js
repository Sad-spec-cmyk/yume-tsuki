(() => {
  if (window.__YUME_PROFILE_USERNAME_V1) return;
  window.__YUME_PROFILE_USERNAME_V1 = true;
  const $=s=>document.querySelector(s);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function installStyle(){
    if($('#yumeUsernameStyle'))return;
    const s=document.createElement('style');s.id='yumeUsernameStyle';s.textContent=`
      .username-editor{display:grid;gap:7px}.username-editor .username-wrap{display:flex;align-items:center;border:1px solid var(--line);border-radius:12px;background:#0d1016;overflow:hidden;transition:.18s ease}
      .username-editor .username-wrap:focus-within{border-color:color-mix(in srgb,var(--accent) 58%,#fff 10%);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}
      .username-editor .at{height:100%;padding:0 0 0 13px;color:var(--accent);font-weight:900;display:grid;place-items:center}.username-editor input{border:0!important;background:transparent!important;box-shadow:none!important;padding-left:4px!important}
      .username-editor small{color:#798190;font-size:11px;line-height:1.45}
    `;document.head.appendChild(s);
  }

  async function ensureField(){
    for(let i=0;i<80;i++){
      const form=$('#profileForm');const display=$('#displayNameInput');
      if(form&&display){
        if(!$('#usernameInput')){
          const label=document.createElement('label');label.className='username-editor';label.innerHTML=`Имя пользователя (@)<div class="username-wrap"><span class="at">@</span><input id="usernameInput" name="username" minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" autocomplete="username" required></div><small>3–20 символов: латиница, цифры и _. После изменения старый @ больше не используется.</small>`;
          display.closest('label')?.insertAdjacentElement('afterend',label);
        }
        return form;
      }
      await sleep(100);
    }
    return null;
  }

  function fill(user){const input=$('#usernameInput');if(input&&user)input.value=user.username||'';}
  function setStatus(text,type=''){const el=document.querySelector('[data-status="profile"]');if(!el)return;el.textContent=text;el.className=`form-status ${type}`;}

  async function saveAll(event){
    const form=event.currentTarget;
    if(form.dataset.yumeUsernameHandling==='1')return;
    event.preventDefault();event.stopImmediatePropagation();
    form.dataset.yumeUsernameHandling='1';
    try{
      const current=window.YUME_ACCOUNT?.user;if(!current)throw new Error('Нужно войти в аккаунт.');
      const data=Object.fromEntries(new FormData(form));
      const desired=String(data.username||'').trim().toLowerCase();
      setStatus('Сохраняем...');
      if(desired&&desired!==String(current.username||'').toLowerCase()){
        const r=await fetch('/.netlify/functions/change-username',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({username:desired})});
        const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||`Ошибка ${r.status}`);
        window.YUME_ACCOUNT?.setUser(j.user);
      }
      const result=await window.YUME_ACCOUNT.request('profile',{method:'POST',body:JSON.stringify({displayName:data.displayName,bio:data.bio,accent:data.accent})});
      window.YUME_ACCOUNT.setUser(result.user);fill(result.user);
      const pub=$('#publicProfileBtn');if(pub)pub.href=`/profile?u=${encodeURIComponent(result.user.username||'')}`;
      setStatus('Профиль сохранён.','success');
    }catch(e){setStatus(e.message||'Не удалось сохранить профиль.','error');}
    finally{delete form.dataset.yumeUsernameHandling;}
  }

  async function boot(){
    installStyle();const form=await ensureField();if(!form)return;
    fill(window.YUME_ACCOUNT?.user);
    form.addEventListener('submit',saveAll,true);
    document.addEventListener('yume:session',e=>fill(e.detail?.user));
  }
  boot();
})();