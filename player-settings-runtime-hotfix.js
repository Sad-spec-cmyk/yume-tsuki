(() => {
  if (window.__YUME_PLAYER_HOTFIX_V11) return;
  window.__YUME_PLAYER_HOTFIX_V11 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const PREF_KEY = 'yume-player-settings-v2';
  const STATE_KEY = 'yume-player-state-v2';
  const DEFAULTS = { autoHideControls:true, hideDelay:2600, rememberQuality:true, rememberSpeed:true, rememberVolume:true, pauseWhenHidden:false };
  const boundVideos = new WeakSet();
  let prefs = read(PREF_KEY, DEFAULTS);
  let saved = read(STATE_KEY, {});
  let hideTimer = 0;
  let kodikRequested = false;
  let activeKodik = null;
  let activeKodikEpisode = '';

  function read(key, fallback) { try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || '{}') || {}) }; } catch { return { ...fallback }; } }
  function writeState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(saved)); } catch {} }
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = v => String(v || '').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').trim();

  const ICON = {
    play:'<svg viewBox="0 0 24 24"><path d="M8 5.3v13.4L19 12 8 5.3Z" fill="currentColor"/></svg>',
    pause:'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>',
    back:'<svg viewBox="0 0 24 24"><path d="M9 7H5V3m.2 4A8 8 0 1 1 4 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><text x="8" y="15.2" font-size="7" font-weight="800" fill="currentColor">10</text></svg>',
    next:'<svg viewBox="0 0 24 24"><path d="M15 7h4V3m-.2 4A8 8 0 1 0 20 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><text x="8" y="15.2" font-size="7" font-weight="800" fill="currentColor">10</text></svg>',
    volume:'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    mute:'<svg viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Z" fill="currentColor"/><path d="m17 9 4 6m0-6-4 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    full:'<svg viewBox="0 0 24 24"><path d="M8 4H4v4m12-4h4v4M8 20H4v-4m12 4h4v-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };

  function installStyle() {
    if ($('#yumeHotfix11Style')) return;
    const st = document.createElement('style');
    st.id = 'yumeHotfix11Style';
    st.textContent = `
      .yume-player{border-radius:18px!important;border:1px solid rgba(255,255,255,.11)!important;background:#020307!important;overflow:hidden!important;box-shadow:0 24px 70px rgba(0,0,0,.42)!important}
      .player-vignette{background:linear-gradient(180deg,rgba(0,0,0,.28),transparent 25%,transparent 58%,rgba(0,0,0,.88))!important}
      .player-topline,.yume-x-top{z-index:20!important;transition:opacity .18s ease,transform .18s ease!important}
      .player-topline>div:first-child,.player-badges span,.yume-x-brand,.yume-x-provider{background:rgba(7,8,12,.58)!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:999px!important;backdrop-filter:blur(14px)!important;box-shadow:0 8px 22px rgba(0,0,0,.2)!important}
      .player-controls,.yume-x-dock{z-index:20!important;left:0!important;right:0!important;bottom:0!important;padding:52px 16px 14px!important;border:0!important;border-radius:0!important;background:linear-gradient(180deg,transparent 0%,rgba(2,3,7,.5) 35%,rgba(2,3,7,.95) 100%)!important;box-shadow:none!important;backdrop-filter:none!important;transition:opacity .18s ease,transform .18s ease!important}
      .progress,.yume-x-progress{appearance:none;-webkit-appearance:none;width:100%;height:4px!important;margin:0 0 9px!important;border-radius:999px!important;background:rgba(255,255,255,.28)!important;accent-color:var(--accent)!important;cursor:pointer!important}
      .progress::-webkit-slider-thumb,.yume-x-progress::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:12px;height:12px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
      .control-row,.yume-x-row{gap:5px!important}.control-btn,.yume-x-btn{width:36px!important;min-width:36px!important;height:36px!important;padding:0!important;border:0!important;border-radius:10px!important;background:transparent!important;color:#f8f9fb!important;display:grid!important;place-items:center!important;box-shadow:none!important}
      .control-btn:hover,.yume-x-btn:hover{background:rgba(255,255,255,.1)!important}.primary-control,.yume-x-btn.is-primary{background:var(--accent)!important;box-shadow:0 7px 20px color-mix(in srgb,var(--accent) 28%,transparent)!important}
      .control-btn svg,.yume-x-btn svg{width:19px;height:19px}.time-label,.yume-x-time{font-size:11px!important;color:rgba(255,255,255,.82)!important;font-variant-numeric:tabular-nums!important}.volume,.yume-x-volume{width:72px!important;height:3px!important;accent-color:var(--accent)!important}
      .player-select,.yume-x-speed{height:34px!important;min-width:67px!important;padding:0 9px!important;border-radius:9px!important;border:1px solid rgba(255,255,255,.1)!important;background:rgba(255,255,255,.065)!important;color:#fff!important;font-size:11px!important}
      .center-play,.yume-x-center{width:70px!important;height:70px!important;border-radius:50%!important;background:rgba(10,10,16,.64)!important;border:1px solid rgba(255,255,255,.22)!important;backdrop-filter:blur(14px)!important;box-shadow:0 14px 42px rgba(0,0,0,.36),0 0 0 7px rgba(255,255,255,.04)!important;color:#fff!important}.center-play svg,.yume-x-center svg{width:27px;height:27px}
      .yume-player.hotfix-controls-hidden{cursor:none!important}.yume-player.hotfix-controls-hidden .player-topline,.yume-player.hotfix-controls-hidden .player-controls,.yume-player.hotfix-controls-hidden .yume-x-top,.yume-player.hotfix-controls-hidden .yume-x-dock{opacity:0!important;pointer-events:none!important;transform:translateY(8px)!important}.yume-player.hotfix-controls-hidden .player-topline,.yume-player.hotfix-controls-hidden .yume-x-top{transform:translateY(-8px)!important}.yume-player.hotfix-controls-hidden .center-play,.yume-player.hotfix-controls-hidden .yume-x-center{opacity:0!important;pointer-events:none!important}
      .hotfix-kodik-group{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}.hotfix-kodik-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px 7px;font-size:11px;font-weight:850;color:#eef0f6}.hotfix-kodik-head b{color:var(--accent);font-size:10px}.hotfix-kodik-choice small{display:block;margin-top:4px;color:#81899a;font-size:10px}.hotfix-kodik-status{margin-top:7px;color:#747d8d;font-size:9px;line-height:1.4}
      @media(max-width:720px){.yume-player{border-radius:13px!important}.player-controls,.yume-x-dock{padding:42px 8px 8px!important}.control-row,.yume-x-row{gap:2px!important}.control-btn,.yume-x-btn{width:34px!important;min-width:34px!important;height:34px!important}.volume,.yume-x-volume{display:none!important}.center-play,.yume-x-center{width:58px!important;height:58px!important}.player-select,.yume-x-speed{min-width:58px!important;max-width:72px!important;padding:0 6px!important}.time-label,.yume-x-time{font-size:10px!important}}
    `;
    document.head.appendChild(st);
  }

  function player() { return $('#yumePlayer'); }
  function video() { return $('#yumeExternalVideo') || $('#yumeVideo'); }
  function isPlaying() { const v = video(); return !!v && !v.paused && !v.ended; }
  function showControls(reschedule = true) { const p = player(); if (!p) return; p.classList.remove('hotfix-controls-hidden'); clearTimeout(hideTimer); if (reschedule && isPlaying() && prefs.autoHideControls !== false) scheduleHide(); }
  function scheduleHide(delay = null) { clearTimeout(hideTimer); if (!isPlaying() || prefs.autoHideControls === false) return; hideTimer = setTimeout(() => { if (isPlaying() && prefs.autoHideControls !== false) player()?.classList.add('hotfix-controls-hidden'); }, Math.max(800, Number(delay ?? prefs.hideDelay) || 2600)); }

  function setButton(button, icon, state) { if (!button || button.dataset.hotfixIcon === state) return; button.dataset.hotfixIcon = state; button.innerHTML = icon; }
  function syncIcons(v = video()) {
    const playState = v && !v.paused && !v.ended ? 'pause' : 'play';
    setButton($('#playBtn'), ICON[playState], `play-${playState}`); setButton($('.yume-x-play'), ICON[playState], `xplay-${playState}`);
    setButton($('#backBtn'), ICON.back, 'back'); setButton($('.yume-x-back'), ICON.back, 'xback');
    setButton($('#forwardBtn'), ICON.next, 'next'); setButton($('.yume-x-forward'), ICON.next, 'xnext');
    const muted = !v || v.muted || v.volume === 0;
    setButton($('#muteBtn'), muted ? ICON.mute : ICON.volume, `mute-${muted}`); setButton($('.yume-x-mute'), muted ? ICON.mute : ICON.volume, `xmute-${muted}`);
    setButton($('#fullscreenBtn'), ICON.full, 'full'); setButton($('.yume-x-full'), ICON.full, 'xfull');
    setButton($('#centerPlay'), ICON.play, 'center'); setButton($('.yume-x-center'), ICON.play, 'xcenter');
  }

  function bindVideo(v) {
    if (!v || boundVideos.has(v)) return;
    boundVideos.add(v);
    if (prefs.rememberVolume !== false && Number.isFinite(Number(saved.volume))) v.volume = Math.max(0, Math.min(1, Number(saved.volume)));
    if (prefs.rememberVolume !== false && saved.muted === true) v.muted = true;
    if (prefs.rememberSpeed !== false && Number(saved.speed) > 0) v.playbackRate = Number(saved.speed);
    v.addEventListener('play', () => { syncIcons(v); scheduleHide(); });
    v.addEventListener('pause', () => { syncIcons(v); showControls(false); });
    v.addEventListener('ended', () => { syncIcons(v); showControls(false); });
    v.addEventListener('volumechange', () => { syncIcons(v); if (prefs.rememberVolume !== false) { saved.volume=v.volume; saved.muted=v.muted; writeState(); } });
    v.addEventListener('ratechange', () => { if (prefs.rememberSpeed !== false) { saved.speed=v.playbackRate; writeState(); } });
    syncIcons(v);
  }

  function bindPlayer() {
    const p = player(); if (!p) return;
    if (p.dataset.hotfixBound !== '1') {
      p.dataset.hotfixBound = '1';
      const activity = () => showControls(true);
      p.addEventListener('pointermove', activity, {passive:true});
      p.addEventListener('pointerdown', activity, {passive:true});
      p.addEventListener('touchstart', activity, {passive:true});
      p.addEventListener('mouseenter', activity, {passive:true});
      p.addEventListener('mouseleave', () => { if (isPlaying()) scheduleHide(500); });
    }
    bindVideo(video()); syncIcons(video());
  }

  function rewriteKodik(raw) {
    let value = String(raw || '').trim(); if (!value) return ''; if (value.startsWith('//')) value = `https:${value}`;
    try { const u = new URL(value, location.origin); if (/^(?:www\.)?kodik\.(?:info|biz|cc)$/i.test(u.hostname) || /^(?:www\.)?kodikplayer\.com$/i.test(u.hostname)) { u.protocol='https:'; u.hostname='kodikplayer.com'; u.port=''; } return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; }
  }

  function fixLegacyKodik() {
    const frame = $('#yumeExternalPlayer'); if (!frame) return;
    const raw = frame.getAttribute('src') || ''; if (!/kodik/i.test(raw)) return;
    const fixed = rewriteKodik(raw); if (fixed && fixed !== raw) frame.setAttribute('src', fixed);
  }

  function currentEpisode() { const n = window.YUME_NOW_PLAYING?.episodeNumber; if (n !== undefined && n !== null && String(n).trim()) return String(n).trim(); return ($('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1'; }
  function kodikLink(provider, ep=currentEpisode()) { const eps=provider?.episodes||{}; return rewriteKodik(eps[String(ep)] || Object.entries(eps).find(([k])=>Number(k)===Number(ep))?.[1] || provider?.link || ''); }

  function activateKodik(provider) {
    const p=player(), link=kodikLink(provider); if (!p || !link) return;
    $('#yumeVideo')?.pause(); $('#yumeExternalVideo')?.pause();
    $('#yumeVideo')?.classList.add('provider-hidden'); $('#yumeExternalVideo')?.classList.add('provider-hidden'); $('#playerControls')?.classList.add('provider-hidden'); $('#centerPlay')?.classList.add('provider-hidden'); p.querySelector('.player-topline')?.classList.add('provider-hidden');
    let frame=$('#yumeExternalPlayer'); if (!frame) { frame=document.createElement('iframe'); frame.id='yumeExternalPlayer'; frame.className='yume-external-player'; frame.allow='autoplay; fullscreen; picture-in-picture'; frame.allowFullscreen=true; frame.referrerPolicy='origin'; p.appendChild(frame); }
    frame.src=link; frame.classList.remove('hidden'); frame.style.display='block';
    $$('.provider-choice').forEach(b=>b.classList.remove('active')); document.querySelector(`[data-hotfix-kodik-id="${CSS.escape(String(provider.id))}"]`)?.classList.add('active');
    activeKodik=provider; activeKodikEpisode=currentEpisode(); window.YUME_ACTIVE_PROVIDER={...provider,kind:'kodik'}; const badge=$('#currentQualityBadge'); if (badge) badge.textContent=provider.name||'Kodik';
  }

  function titleCandidates() { return [...new Set([$('#animeTitle')?.textContent,$('#animeAltTitle')?.textContent,window.YUME_NOW_PLAYING?.title,document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i,'')].map(x=>String(x||'').trim()).filter(x=>x && x!=='Загрузка...'))].slice(0,8); }

  async function loadKodik() {
    if (kodikRequested) return;
    const card=$('#providerCard'), titles=titleCandidates(); if (!card || !titles.length) return;
    kodikRequested=true;
    try {
      const year=($('#sideYear')?.textContent||'').match(/(?:19|20)\d{2}/)?.[0]||'';
      const q=new URLSearchParams({title:titles[0],alt:titles.slice(1).join('|'),year,_:String(Date.now())});
      const r=await fetch(`/.netlify/functions/kodik-v10?${q}`,{headers:{accept:'application/json'},cache:'no-store'}); const data=await r.json().catch(()=>({})); if (!r.ok) return;
      const providers=Array.isArray(data.providers)?data.providers:[]; if (!providers.length) return;
      let host=card.querySelector('.provider-kodik-list'); if (!host) { host=document.createElement('div'); host.className='provider-kodik-list'; card.querySelector('.provider-note')?.insertAdjacentElement('beforebegin',host); }
      const existing=new Set($$('.provider-choice').map(b=>norm(b.querySelector('b')?.textContent||b.textContent)).filter(Boolean)); const items=providers.filter(p=>!existing.has(norm(p.name))).slice(0,40); if (!items.length) return;
      host.innerHTML=`<div class="hotfix-kodik-group"><div class="hotfix-kodik-head"><span>Kodik · озвучки</span><b>${items.length}</b></div>${items.map(p=>`<button type="button" class="provider-choice provider-extra hotfix-kodik-choice" data-hotfix-kodik-id="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc([p.quality,Object.keys(p.episodes||{}).length?`${Object.keys(p.episodes||{}).length} серий`:'',p.type==='subtitles'?'субтитры':'озвучка'].filter(Boolean).join(' · '))}</small></button>`).join('')}<div class="hotfix-kodik-status">Kodik API: ${esc(data.diagnostics?.tokenSource||'ok')} · ${esc(data.diagnostics?.matchedShikimoriId||'по названию')}</div></div>`;
      items.forEach(p=>host.querySelector(`[data-hotfix-kodik-id="${CSS.escape(String(p.id))}"]`)?.addEventListener('click',()=>activateKodik(p)));
      const legacy=$$('.provider-choice').find(b=>b.dataset.provider==='external'&&/kodik/i.test(b.textContent||'')); if (legacy) legacy.style.display='none';
      const note=card.querySelector('.provider-note'); if (note) note.textContent=(note.textContent||'').replace(/\s*·\s*Kodik:\s*нужен токен/gi,'').replace(/Kodik:\s*нужен токен\s*·?\s*/gi,'').trim();
    } catch {}
  }

  function syncKodikEpisode() { if (!activeKodik) return; const ep=currentEpisode(); if (ep===activeKodikEpisode) return; activeKodikEpisode=ep; const link=kodikLink(activeKodik,ep), frame=$('#yumeExternalPlayer'); if (frame&&link&&frame.src!==link) frame.src=link; }

  function bindQuality() {
    const s=$('#qualitySelect'); if (!s||s.dataset.hotfixQuality==='1') return; s.dataset.hotfixQuality='1';
    if (prefs.rememberQuality!==false&&saved.quality) { const o=[...s.options].find(o=>o.textContent.trim()===saved.quality); if(o) s.value=o.value; }
    s.addEventListener('change',()=>{ if(prefs.rememberQuality!==false){saved.quality=s.selectedOptions?.[0]?.textContent?.trim()||'';writeState();} showControls(true); });
  }

  document.addEventListener('visibilitychange',()=>{ if(document.hidden&&prefs.pauseWhenHidden===true){const v=video();if(v&&!v.paused)v.pause();} });
  document.addEventListener('yume:player-settings',e=>{prefs={...DEFAULTS,...read(PREF_KEY,DEFAULTS),...(e.detail||{})}; if(prefs.autoHideControls===false)showControls(false);else scheduleHide();});
  document.addEventListener('click',e=>{const c=e.target.closest?.('.provider-choice');if(c&&!c.classList.contains('hotfix-kodik-choice'))activeKodik=null;},true);

  installStyle(); bindPlayer(); bindQuality();
  let ticks=0;
  const timer=setInterval(()=>{
    bindPlayer(); bindQuality(); fixLegacyKodik(); syncKodikEpisode();
    if (!kodikRequested) loadKodik();
    if (++ticks>=180) clearInterval(timer);
  },500);
})();