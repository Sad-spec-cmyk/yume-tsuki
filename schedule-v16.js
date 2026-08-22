(() => {
  if (window.__YUME_MULTI_SCHEDULE_V16) return;
  window.__YUME_MULTI_SCHEDULE_V16 = true;

  const $ = s => document.querySelector(s);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
  const DAY_NAMES = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  const DOW_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
  const state = { days:[], selected:0, raw:[], grouped:[], sources:[] };

  function buildDays() {
    const now = new Date(); now.setHours(12,0,0,0);
    state.days = Array.from({length:7}, (_,i) => { const date=new Date(now); date.setDate(now.getDate()+i); return {date,label:i===0?'Сегодня':i===1?'Завтра':DOW_SHORT[date.getDay()],dayName:DAY_NAMES[date.getDay()]}; });
  }
  function sameLocalDate(a,b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function weekdayMatches(raw,date) {
    if (raw===null||raw===undefined||String(raw).trim()==='') return false;
    const day=date.getDay(), iso=day===0?7:day, n=Number(raw);
    if(Number.isFinite(n)&&/^\d+$/.test(String(raw).trim())) return n===day||n===iso;
    const value=String(raw).trim().toLowerCase().replace(/s$/,'');
    const en=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day];
    const ru=DAY_NAMES[day].toLowerCase(), ruShort=['вс','пн','вт','ср','чт','пт','сб'][day];
    return value===en||value===ru||value===ruShort;
  }
  function dayIndexFor(item) {
    if(Number.isInteger(item?.relativeDay)&&item.relativeDay>=0&&item.relativeDay<7)return item.relativeDay;
    if(item?.nextAt){const d=new Date(item.nextAt);if(!Number.isNaN(d.getTime())){const idx=state.days.findIndex(x=>sameLocalDate(x.date,d));if(idx>=0)return idx;}}
    if(item?.weekday!==undefined&&item?.weekday!==null)return state.days.findIndex(x=>weekdayMatches(item.weekday,x.date));
    return -1;
  }
  function mergeEpisode(a,b){const A=Number(a),B=Number(b);if(Number.isFinite(A)&&Number.isFinite(B))return String(Math.max(A,B));return String(b||a||'').trim();}
  function groupItems(){
    state.grouped=state.days.map(()=>[]);const maps=state.days.map(()=>new Map());
    for(const raw of state.raw){
      const idx=dayIndexFor(raw);if(idx<0||idx>6)continue;const key=norm(raw.title);if(!key)continue;const map=maps[idx];
      if(!map.has(key))map.set(key,{title:String(raw.title||'').trim(),poster:raw.poster||'',href:raw.href||`/anime?q=${encodeURIComponent(raw.title||'')}`,nextEpisode:String(raw.nextEpisode||'').trim(),exact:!!raw.exact,nextAt:raw.nextAt||'',sources:[raw.source].filter(Boolean)});
      else{const x=map.get(key);x.nextEpisode=mergeEpisode(x.nextEpisode,raw.nextEpisode);x.exact=x.exact||!!raw.exact;if(!x.poster&&raw.poster)x.poster=raw.poster;if(!x.href&&raw.href)x.href=raw.href;if(!x.nextAt&&raw.nextAt)x.nextAt=raw.nextAt;x.sources=[...new Set([...x.sources,raw.source].filter(Boolean))];}
    }
    maps.forEach((map,i)=>state.grouped[i]=[...map.values()].sort((a,b)=>a.title.localeCompare(b.title,'ru')));
  }
  function renderTabs(){
    const box=$('#dayTabs');if(!box)return;
    box.innerHTML=state.days.map((day,i)=>{const count=state.grouped[i]?.length||0;return `<button class="schedule-day ${i===state.selected?'active':''}" data-index="${i}" type="button"><span class="dow">${esc(day.label)}</span><span class="date">${day.date.getDate()}</span>${count?`<span class="count">${count}</span>`:''}</button>`;}).join('');
    box.querySelectorAll('.schedule-day').forEach(btn=>btn.addEventListener('click',()=>{state.selected=Number(btn.dataset.index||0);renderTabs();renderList();}));
  }
  function lineFor(item){const source=item.sources.length?` · ${item.sources.join(' + ')}`:'';return item.nextEpisode?`Следующая: серия ${item.nextEpisode}${source}`:`Новая серия ожидается в этот день${source}`;}
  function exactLabel(item,day){
    if(item.nextAt){const d=new Date(item.nextAt);if(!Number.isNaN(d.getTime()))return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(d);}
    return item.exact?(state.selected===0?'сегодня':state.selected===1?'завтра':day.dayName.toLowerCase()):day.dayName.toLowerCase();
  }
  function renderList(){
    const day=state.days[state.selected],items=state.grouped[state.selected]||[],box=$('#scheduleList');if(!box)return;
    if(!items.length){box.innerHTML=`<div class="schedule-empty">На ${esc(day.dayName.toLowerCase())} релизов в объединённом расписании пока нет.</div>`;return;}
    box.innerHTML=items.map(item=>`<a class="schedule-row" href="${esc(item.href)}"><span class="schedule-poster">${item.poster?`<img src="${esc(item.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="schedule-copy"><strong>${esc(item.title)}</strong><span>${esc(lineFor(item))}</span></span><span class="schedule-episode"><strong>${item.nextEpisode?`#${esc(item.nextEpisode)}`:'—'}</strong><span>${esc(exactLabel(item,day))}</span></span></a>`).join('');
  }
  function updateClock(){const d=new Date();if($('#scheduleClock'))$('#scheduleClock').textContent=new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'2-digit',month:'long',hour:'2-digit',minute:'2-digit'}).format(d);}
  async function load(){
    const box=$('#scheduleList');if(box)box.innerHTML='<div class="schedule-loading">Собираем расписание со всех источников…</div>';
    try{
      const r=await fetch(`/.netlify/functions/schedule-all?_=${Date.now()}`,{headers:{accept:'application/json'},cache:'no-store'});const data=await r.json().catch(()=>({}));
      if(!r.ok||!Array.isArray(data?.items))throw new Error(data?.error||`HTTP ${r.status}`);
      state.raw=data.items;state.sources=Array.isArray(data.sources)?data.sources:[];groupItems();renderTabs();renderList();
      const head=document.querySelector('.schedule-card-head strong');if(head)head.textContent=state.sources.length?`РАСПИСАНИЕ · ${state.sources.join(' + ')}`:'РАСПИСАНИЕ ОНГОИНГОВ';
    }catch(e){if(box)box.innerHTML=`<div class="schedule-empty">Не удалось собрать объединённое расписание.<br><small>${esc(e.message||'')}</small></div>`;}
  }
  buildDays();updateClock();setInterval(updateClock,30000);$('#scheduleRefresh')?.addEventListener('click',load);load();
})();
