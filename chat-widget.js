(() => {
  if(document.querySelector('#yumeChatWidget')) return;
  const state={open:false,user:window.YUME_ACCOUNT?.user||null,messages:[],timer:null,loading:false};
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const api=(action,options={})=>window.YUME_ACCOUNT?.request?window.YUME_ACCOUNT.request(action,options):fetch(`/.netlify/functions/yume-api?action=${encodeURIComponent(action)}`,{credentials:'same-origin',headers:{'content-type':'application/json'},...options}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Ошибка ${r.status}`);return d;});
  document.body.insertAdjacentHTML('beforeend',`<aside id="yumeChatWidget" class="yume-chat-widget hidden"><div class="yume-chat-head"><div class="yume-chat-title"><span class="live"></span><span>ОБЩИЙ ЧАТ</span></div><div class="yume-chat-head-actions"><button class="yume-chat-icon-btn" id="yumeChatRefresh">↻</button><button class="yume-chat-icon-btn" id="yumeChatClose">×</button></div></div><div id="yumeChatMessages" class="yume-chat-messages"></div><div id="yumeChatFooter" class="yume-chat-footer"></div></aside><button id="yumeChatLauncher" class="yume-chat-launcher" aria-label="Открыть чат"><span>💬</span><span class="chat-dot"></span></button>`);
  const widget=document.querySelector('#yumeChatWidget'),box=document.querySelector('#yumeChatMessages'),footer=document.querySelector('#yumeChatFooter');
  const time=ms=>new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(ms)||Date.now())).replace(',','');
  function profileHref(u){return u?.username?`/profile?u=${encodeURIComponent(u.username)}`:'#';}
  function avatar(u){return u?.avatarUrl?`<img src="${esc(u.avatarUrl)}" alt="">`:esc((u?.displayName||u?.username||'Y').slice(0,1).toUpperCase());}
  function renderMessages(){
    const near=box.scrollHeight-box.scrollTop-box.clientHeight<90;
    box.innerHTML=state.messages.length?state.messages.map(m=>{const u=m.user||{};const accent=/^#[0-9a-f]{6}$/i.test(u.accent||'')?u.accent:'#ff7391';const href=profileHref(u);return `<article class="yume-chat-message" style="--msg-accent:${esc(accent)}"><a class="yume-chat-avatar profile-link" href="${href}">${avatar(u)}</a><div><div class="yume-chat-meta"><a class="yume-chat-name profile-link" href="${href}">${esc(u.displayName||u.username||'Yume')}</a><span class="yume-chat-time">${esc(time(m.createdAt))}</span></div><div class="yume-chat-text">${esc(m.text)}</div></div></article>`}).join(''):'<div class="yume-chat-empty">Сообщений пока нет.</div>';
    if(near||state.open)box.scrollTop=box.scrollHeight;
  }
  function renderFooter(){
    if(!state.user){footer.innerHTML='<div class="yume-chat-login"><span>Читать можно всем. Чтобы писать — войди.</span><a href="/account">Войти</a></div>';return;}
    footer.innerHTML='<form id="yumeChatForm" class="yume-chat-form"><textarea id="yumeChatInput" maxlength="500" rows="1" placeholder="Написать сообщение…"></textarea><button class="yume-chat-send">➤</button></form><div id="yumeChatError" class="yume-chat-error"></div><div id="yumeChatCount" class="yume-chat-count">0 / 500</div>';
    const form=footer.querySelector('form'),input=footer.querySelector('textarea'),count=footer.querySelector('#yumeChatCount');
    input.oninput=()=>count.textContent=`${input.value.length} / 500`;
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}};
    form.onsubmit=async e=>{e.preventDefault();const text=input.value.trim();if(!text)return;try{const d=await api('chat',{method:'POST',body:JSON.stringify({text})});if(d.message)state.messages.push(d.message);input.value='';count.textContent='0 / 500';renderMessages();}catch(err){footer.querySelector('#yumeChatError').textContent=err.message;}};
  }
  async function load(){if(state.loading)return;state.loading=true;try{const d=await api('chat',{method:'GET',headers:{}});state.messages=d.messages||[];renderMessages();}catch{box.innerHTML='<div class="yume-chat-empty">Не удалось загрузить чат.</div>';}finally{state.loading=false;}}
  function open(){state.open=true;widget.classList.remove('hidden');load();clearInterval(state.timer);state.timer=setInterval(()=>document.visibilityState==='visible'&&load(),5000);setTimeout(()=>footer.querySelector('textarea')?.focus(),100);}
  function close(){state.open=false;widget.classList.add('hidden');clearInterval(state.timer);}
  document.querySelector('#yumeChatLauncher').onclick=()=>state.open?close():open();document.querySelector('#yumeChatClose').onclick=close;document.querySelector('#yumeChatRefresh').onclick=load;document.addEventListener('click',e=>{const b=e.target.closest('[data-yume-open-chat]');if(b){e.preventDefault();open();}});document.addEventListener('yume:session',e=>{state.user=e.detail?.user||null;renderFooter();});window.YUME_CHAT={open,close,toggle:()=>state.open?close():open,refresh:load};renderFooter();load();if(location.hash==='#chat')setTimeout(open,80);
})();
