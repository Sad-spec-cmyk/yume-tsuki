(() => {
  if (window.__YUME_PLAYER_SETTINGS_RUNTIME_V10) return;
  window.__YUME_PLAYER_SETTINGS_RUNTIME_V10 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const PREF_KEY = 'yume-player-settings-v2';
  const STATE_KEY = 'yume-player-state-v2';
  const DEFAULTS = {
    autoHideControls: true,
    hideDelay: 2600,
    rememberQuality: true,
    rememberSpeed: true,
    rememberVolume: true,
    pauseWhenHidden: false,
  };

  let prefs = readPrefs();
  let saved = readState();
  let hideTimer = 0;
  let kodikLoading = false;
  let kodikLoaded = false;
  let activeKodik = null;
  let activeKodikEpisode = '';
  const boundVideos = new WeakSet();

  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12 8 5.2Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.4 7H5.2V2.8M5.4 7.1A8 8 0 1 1 4 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="8.3" y="15.2" font-size="7" font-weight="800" fill="currentColor">10</text></svg>',
    forward: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 7h4.2V2.8m-.2 4.3A8 8 0 1 0 20 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="8.3" y="15.2" font-size="7" font-weight="800" fill="currentColor">10</text></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4Z" fill="currentColor"/><path d="m17 9 4 6m0-6-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4m12-4h4v4M8 20H4v-4m12 4h4v-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function readPrefs() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}) }; }
    catch { return { ...DEFAULTS }; }
  }
  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function writeState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(saved)); } catch {}
  }
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  const norm = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();

  function installStyle() {
    if ($('#yumeV10PlayerStyle')) return;
    const st = document.createElement('style');
    st.id = 'yumeV10PlayerStyle';
    st.textContent = `
      .yume-player{
        border-radius:20px!important;
        border:1px solid rgba(255,255,255,.11)!important;
        background:#020307!important;
        box-shadow:0 24px 70px rgba(0,0,0,.42),0 0 0 1px rgba(255,255,255,.018) inset!important;
        overflow:hidden!important;
      }
      .yume-player:before{box-shadow:inset 0 1px 0 rgba(255,255,255,.06)!important}
      .player-vignette{background:linear-gradient(180deg,rgba(0,0,0,.34),transparent 22%,transparent 58%,rgba(0,0,0,.82) 100%)!important}
      .player-topline{z-index:15!important;padding:16px 17px!important;transition:opacity .2s ease,transform .2s ease!important}
      .player-topline>div:first-child,.player-badges span{
        background:rgba(8,9,14,.58)!important;border:1px solid rgba(255,255,255,.10)!important;
        box-shadow:0 8px 24px rgba(0,0,0,.18)!important;backdrop-filter:blur(14px) saturate(1.2)!important;
      }
      .player-topline>div:first-child{padding:7px 10px!important;border-radius:999px!important;font-size:10px!important;letter-spacing:.12em!important}
      .player-badges span{padding:7px 10px!important;border-radius:999px!important;font-size:10px!important}
      .player-brand-dot{width:7px!important;height:7px!important;box-shadow:0 0 16px var(--accent)!important}
      .center-play{
        z-index:16!important;width:72px!important;height:72px!important;border-radius:50%!important;
        background:rgba(10,10,16,.64)!important;border:1px solid rgba(255,255,255,.24)!important;color:#fff!important;
        box-shadow:0 14px 42px rgba(0,0,0,.36),0 0 0 7px rgba(255,255,255,.045)!important;
        backdrop-filter:blur(16px)!important;transition:opacity .18s ease,transform .18s ease,background .18s ease!important;
      }
      .center-play:hover{background:color-mix(in srgb,var(--accent) 74%,rgba(12,12,18,.85))!important;transform:translate(-50%,-50%) scale(1.05)!important}
      .center-play svg{width:27px;height:27px;display:block;margin:auto}
      .player-controls{
        z-index:15!important;left:0!important;right:0!important;bottom:0!important;padding:54px 17px 15px!important;
        border:0!important;border-radius:0!important;background:linear-gradient(180deg,transparent 0%,rgba(2,3,7,.52) 34%,rgba(2,3,7,.94) 100%)!important;
        box-shadow:none!important;backdrop-filter:none!important;transition:opacity .2s ease,transform .2s ease!important;
      }
      .progress,.yume-x-progress{
        appearance:none;-webkit-appearance:none;width:100%;height:4px!important;margin:0 0 10px!important;border-radius:999px!important;
        background:linear-gradient(90deg,var(--accent) 0 var(--yume-progress,0%),rgba(255,255,255,.28) var(--yume-progress,0%) 100%)!important;
        cursor:pointer!important;outline:none!important;transition:height .13s ease!important;
      }
      .progress:hover,.yume-x-progress:hover{height:6px!important}
      .progress::-webkit-slider-thumb,.yume-x-progress::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:13px;height:13px;border:0;border-radius:50%;background:#fff;box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
      .progress::-moz-range-thumb,.yume-x-progress::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:#fff}
      .control-row,.yume-x-row{gap:5px!important;min-height:36px!important}
      .control-btn,.yume-x-btn{
        min-width:36px!important;width:36px!important;height:36px!important;padding:0!important;border:0!important;border-radius:10px!important;
        background:transparent!important;color:#f7f8fb!important;box-shadow:none!important;display:grid!important;place-items:center!important;
        transition:background .14s ease,transform .14s ease!important;
      }
      .control-btn:hover,.yume-x-btn:hover{background:rgba(255,255,255,.11)!important;transform:none!important}
      .control-btn svg,.yume-x-btn svg{width:19px;height:19px;pointer-events:none}
      .primary-control,.yume-x-btn.is-primary{background:var(--accent)!important;color:#fff!important;box-shadow:0 7px 20px color-mix(in srgb,var(--accent) 28%,transparent)!important}
      .primary-control:hover,.yume-x-btn.is-primary:hover{background:color-mix(in srgb,var(--accent) 86%,white)!important}
      .time-label,.yume-x-time{font-size:11px!important;color:rgba(255,255,255,.82)!important;font-variant-numeric:tabular-nums!important;margin-left:3px!important}
      .volume,.yume-x-volume{appearance:none;-webkit-appearance:none;width:70px!important;height:3px!important;border-radius:999px!important;background:rgba(255,255,255,.26)!important;accent-color:var(--accent)!important;margin:0 5px!important}
      .player-select,.yume-x-speed{
        height:34px!important;min-width:68px!important;padding:0 9px!important;border-radius:9px!important;border:1px solid rgba(255,255,255,.10)!important;
        background:rgba(255,255,255,.065)!important;color:#fff!important;box-shadow:none!important;font-size:11px!important;outline:none!important;
      }
      #qualitySelect{min-width:76px!important}

      .yume-x-video{background:#020307!important}
      .yume-x-layer{z-index:17!important;transition:none!important}
      .yume-x-top{left:16px!important;right:16px!important;top:15px!important;transition:opacity .2s ease,transform .2s ease!important}
      .yume-x-brand,.yume-x-provider{
        padding:7px 10px!important;border-radius:999px!important;background:rgba(8,9,14,.58)!important;border:1px solid rgba(255,255,255,.10)!important;
        backdrop-filter:blur(14px) saturate(1.2)!important;box-shadow:0 8px 24px rgba(0,0,0,.18)!important;font-size:10px!important;
      }
      .yume-x-center{
        width:72px!important;height:72px!important;background:rgba(10,10,16,.64)!important;border:1px solid rgba(255,255,255,.24)!important;
        box-shadow:0 14px 42px rgba(0,0,0,.36),0 0 0 7px rgba(255,255,255,.045)!important;backdrop-filter:blur(16px)!important;
      }
      .yume-x-center svg{width:27px;height:27px;display:block;margin:auto}
      .yume-x-dock{
        left:0!important;right:0!important;bottom:0!important;padding:54px 17px 15px!important;border:0!important;border-radius:0!important;
        background:linear-gradient(180deg,transparent 0%,rgba(2,3,7,.52) 34%,rgba(2,3,7,.94) 100%)!important;
        box-shadow:none!important;backdrop-filter:none!important;transition:opacity .2s ease,transform .2s ease!important;
      }
      .yume-x-live{display:none!important}

      .yume-player.v10-controls-hidden{cursor:none!important}
      .yume-player.v10-controls-hidden .player-topline,
      .yume-player.v10-controls-hidden .player-controls,
      .yume-player.v10-controls-hidden .yume-x-top,
      .yume-player.v10-controls-hidden .yume-x-dock{
        opacity:0!important;transform:translateY(8px)!important;pointer-events:none!important;
      }
      .yume-player.v10-controls-hidden .player-topline,
      .yume-player.v10-controls-hidden .yume-x-top{transform:translateY(-8px)!important}
      .yume-player.v10-controls-hidden .center-play,
      .yume-player.v10-controls-hidden .yume-x-center{opacity:0!important;pointer-events:none!important}

      .v10-kodik-group{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)}
      .v10-kodik-head{display:flex;align-items:center;justify-content:space-between;padding:0 2px 7px;font-size:11px;font-weight:850;color:#eef0f6}
      .v10-kodik-head b{color:var(--accent);font-size:10px;padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--accent) 12%,transparent)}
      .provider-choice.v10-kodik-choice small{display:block;margin-top:4px;color:#81899a;font-size:10px}
      .provider-choice.v10-kodik-choice .v10-source-tag{float:right;font-size:9px;color:#aeb4c1;font-weight:700}
      .v10-kodik-status{margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.025);color:#747d8d;font-size:10px;line-height:1.45}

      @media(max-width:720px){
        .yume-player{border-radius:14px!important}
        .player-controls,.yume-x-dock{padding:42px 9px 9px!important}
        .player-topline{padding:9px!important}.yume-x-top{left:9px!important;right:9px!important;top:9px!important}
        .center-play,.yume-x-center{width:60px!important;height:60px!important}.center-play svg,.yume-x-center svg{width:23px;height:23px}
        .control-btn,.yume-x-btn{width:34px!important;min-width:34px!important;height:34px!important}
        .control-row,.yume-x-row{gap:2px!important}.time-label,.yume-x-time{font-size:10px!important}
        .volume,.yume-x-volume{display:none!important}.player-select,.yume-x-speed{min-width:58px!important;max-width:72px!important;padding:0 6px!important}
        #qualitySelect{min-width:65px!important}.player-badges span:nth-child(2){display:none!important}
      }
    `;
    document.head.appendChild(st);
  }

  function activeVideo() { return $('#yumeExternalVideo') || $('#yumeVideo'); }
  function player() { return $('#yumePlayer'); }
  function playing() { const v = activeVideo(); return !!v && !v.paused && !v.ended; }

  function setProgressStyle(input, pct) {
    input?.style.setProperty('--yume-progress', `${Math.max(0, Math.min(100, Number(pct) || 0))}%`);
  }

  function showControls(schedule = true) {
    const p = player();
    if (!p) return;
    p.classList.remove('v10-controls-hidden');
    clearTimeout(hideTimer);
    if (schedule && playing() && prefs.autoHideControls !== false) scheduleHide();
  }

  function hideControls() {
    const p = player();
    if (!p || !playing() || prefs.autoHideControls === false) return;
    p.classList.add('v10-controls-hidden');
  }

  function scheduleHide(delay = null) {
    clearTimeout(hideTimer);
    if (!playing() || prefs.autoHideControls === false) return showControls(false);
    hideTimer = setTimeout(hideControls, Math.max(800, Number(delay ?? prefs.hideDelay) || 2600));
  }

  function decorateButtons(video = activeVideo()) {
    const playIcon = video && !video.paused && !video.ended ? icons.pause : icons.play;
    const native = [
      ['#playBtn', playIcon], ['#backBtn', icons.back], ['#forwardBtn', icons.forward],
      ['#muteBtn', video?.muted || video?.volume === 0 ? icons.mute : icons.volume], ['#fullscreenBtn', icons.full],
    ];
    native.forEach(([sel, html]) => { const b = $(sel); if (b && b.innerHTML !== html) b.innerHTML = html; });
    const c = $('#centerPlay'); if (c && c.innerHTML !== icons.play) c.innerHTML = icons.play;

    const xPlay = $('.yume-x-play'); if (xPlay) xPlay.innerHTML = playIcon;
    const xBack = $('.yume-x-back'); if (xBack) xBack.innerHTML = icons.back;
    const xForward = $('.yume-x-forward'); if (xForward) xForward.innerHTML = icons.forward;
    const xMute = $('.yume-x-mute'); if (xMute) xMute.innerHTML = video?.muted || video?.volume === 0 ? icons.mute : icons.volume;
    const xFull = $('.yume-x-full'); if (xFull) xFull.innerHTML = icons.full;
    const xCenter = $('.yume-x-center'); if (xCenter) xCenter.innerHTML = icons.play;
  }

  function bindVideo(video) {
    if (!video || boundVideos.has(video)) return;
    boundVideos.add(video);
    if (prefs.rememberVolume !== false && Number.isFinite(Number(saved.volume))) video.volume = Math.max(0, Math.min(1, Number(saved.volume)));
    if (prefs.rememberVolume !== false && saved.muted === true) video.muted = true;
    if (prefs.rememberSpeed !== false && Number(saved.speed) > 0) video.playbackRate = Number(saved.speed);

    video.addEventListener('play', () => { decorateButtons(video); scheduleHide(); });
    video.addEventListener('pause', () => { decorateButtons(video); showControls(false); });
    video.addEventListener('ended', () => { decorateButtons(video); showControls(false); });
    video.addEventListener('volumechange', () => {
      decorateButtons(video);
      if (prefs.rememberVolume !== false) { saved.volume = video.volume; saved.muted = video.muted; writeState(); }
    });
    video.addEventListener('ratechange', () => {
      if (prefs.rememberSpeed !== false) { saved.speed = video.playbackRate; writeState(); }
    });
    video.addEventListener('loadedmetadata', () => decorateButtons(video));
    decorateButtons(video);
  }

  function bindPlayer() {
    const p = player();
    if (!p) return;
    if (p.dataset.yumeV10Bound !== '1') {
      p.dataset.yumeV10Bound = '1';
      const activity = () => showControls(true);
      p.addEventListener('pointermove', activity, { passive:true });
      p.addEventListener('pointerdown', activity, { passive:true });
      p.addEventListener('touchstart', activity, { passive:true });
      p.addEventListener('mouseenter', activity, { passive:true });
      p.addEventListener('mouseleave', () => { if (playing()) scheduleHide(650); });
    }
    bindVideo(activeVideo());
    decorateButtons(activeVideo());
  }

  function bindQuality() {
    const select = $('#qualitySelect');
    if (!select || select.dataset.yumeV10Quality === '1') return;
    select.dataset.yumeV10Quality = '1';
    select.addEventListener('change', () => {
      if (prefs.rememberQuality !== false) {
        saved.quality = select.selectedOptions?.[0]?.textContent?.trim() || '';
        writeState();
      }
      showControls(true);
    });
    const apply = () => {
      if (prefs.rememberQuality === false || !saved.quality) return;
      const option = [...select.options].find(o => o.textContent.trim() === saved.quality);
      if (option && select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles:true }));
      }
    };
    new MutationObserver(() => setTimeout(apply, 80)).observe(select, { childList:true, subtree:true });
    setTimeout(apply, 260);
  }

  function rewriteKodikUrl(raw) {
    let value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) value = `https:${value}`;
    try {
      const u = new URL(value, location.origin);
      if (/^(?:www\.)?kodik\.(?:info|biz|cc)$/i.test(u.hostname) || /^(?:www\.)?kodikplayer\.com$/i.test(u.hostname)) {
        u.protocol = 'https:';
        u.hostname = 'kodikplayer.com';
        u.port = '';
        return u.toString();
      }
      return /^https?:$/i.test(u.protocol) ? u.toString() : '';
    } catch { return ''; }
  }

  function fixLegacyKodik() {
    const frame = $('#yumeExternalPlayer');
    if (!frame) return;
    const raw = frame.getAttribute('src') || frame.src || '';
    const fixed = rewriteKodikUrl(raw);
    if (fixed && fixed !== raw && /kodik/i.test(raw)) frame.src = fixed;
    const legacy = $$('.provider-choice').find(b => b.dataset.provider === 'external' && /kodik/i.test(b.textContent || ''));
    if (legacy && fixed) {
      legacy.querySelector('small') && (legacy.querySelector('small').textContent = 'Kodik · актуальный домен плеера');
    }
  }

  function currentEpisode() {
    const direct = window.YUME_NOW_PLAYING?.episodeNumber;
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    return ($('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1';
  }

  function kodikLink(provider, episode = currentEpisode()) {
    const eps = provider?.episodes && typeof provider.episodes === 'object' ? provider.episodes : {};
    const exact = eps[String(episode)] || Object.entries(eps).find(([k]) => Number(k) === Number(episode))?.[1] || provider?.link || '';
    return rewriteKodikUrl(exact);
  }

  function activateKodik(provider) {
    const p = player();
    if (!p) return;
    const link = kodikLink(provider);
    if (!link) return;
    $('#yumeVideo')?.pause();
    $('#yumeExternalVideo')?.pause();
    $('#yumeVideo')?.classList.add('provider-hidden');
    $('#playerControls')?.classList.add('provider-hidden');
    $('#centerPlay')?.classList.add('provider-hidden');
    p.querySelector('.player-topline')?.classList.add('provider-hidden');
    $('#yumeExternalVideo')?.classList.add('provider-hidden');

    let frame = $('#yumeExternalPlayer');
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'yumeExternalPlayer';
      frame.className = 'yume-external-player';
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'origin';
      p.appendChild(frame);
    }
    if (frame.src !== link) frame.src = link;
    frame.classList.remove('hidden');
    frame.style.display = 'block';
    $$('.provider-choice').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-v10-kodik-id="${CSS.escape(String(provider.id))}"]`)?.classList.add('active');
    activeKodik = provider;
    activeKodikEpisode = currentEpisode();
    window.YUME_ACTIVE_PROVIDER = { ...provider, kind:'kodik' };
    const badge = $('#currentQualityBadge'); if (badge) badge.textContent = provider.name || 'Kodik';
    showControls(false);
  }

  function providerTitleCandidates() {
    return [...new Set([
      $('#animeTitle')?.textContent,
      $('#animeAltTitle')?.textContent,
      window.YUME_NOW_PLAYING?.title,
      document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i, ''),
    ].map(x => String(x || '').trim()).filter(x => x && x !== 'Загрузка...'))].slice(0, 8);
  }

  function sanitizeProviderNote(kodikCount = null) {
    const note = $('#providerCard .provider-note');
    if (!note) return;
    let text = note.textContent || '';
    text = text.replace(/\s*·\s*Kodik:\s*нужен токен/gi, '').replace(/Kodik:\s*нужен токен\s*·?\s*/gi, '');
    if (kodikCount !== null && !new RegExp(`Kodik\\s+${kodikCount}(?:\\D|$)`, 'i').test(text)) text = `${text.trim()} · Kodik ${kodikCount}`.replace(/^·\s*/, '');
    note.textContent = text.trim();
  }

  function renderKodikProviders(providers, diagnostics = {}) {
    const card = $('#providerCard');
    if (!card || !providers.length) { sanitizeProviderNote(0); return; }
    let list = card.querySelector('.provider-kodik-list');
    if (!list) {
      list = document.createElement('div');
      list.className = 'provider-kodik-list';
      card.querySelector('.provider-note')?.insertAdjacentElement('beforebegin', list);
    }
    list.querySelector('.v10-kodik-group')?.remove();

    const existingNames = new Set($$('.provider-choice').map(b => norm(b.querySelector('b')?.textContent || b.textContent)).filter(Boolean));
    const unique = providers.filter(p => !existingNames.has(norm(p.name))).slice(0, 40);
    if (!unique.length) { sanitizeProviderNote(providers.length); return; }

    const group = document.createElement('div');
    group.className = 'v10-kodik-group';
    group.innerHTML = `<div class="v10-kodik-head"><span>Kodik · озвучки</span><b>${unique.length}</b></div>` + unique.map(p => {
      const count = Object.keys(p.episodes || {}).length || Number(p.lastEpisode || 0);
      const meta = [p.quality, count ? `${count} серий` : '', p.type === 'subtitles' ? 'субтитры' : 'озвучка'].filter(Boolean).join(' · ');
      return `<button type="button" class="provider-choice provider-extra v10-kodik-choice" data-v10-kodik-id="${esc(p.id)}"><b>${esc(p.name)}<span class="v10-source-tag">Kodik</span></b><small>${esc(meta || 'Kodik player')}</small></button>`;
    }).join('');
    list.prepend(group);
    unique.forEach(p => group.querySelector(`[data-v10-kodik-id="${CSS.escape(String(p.id))}"]`)?.addEventListener('click', () => activateKodik(p)));

    const legacy = $$('.provider-choice').find(b => b.dataset.provider === 'external' && /kodik/i.test(b.textContent || ''));
    if (legacy) legacy.style.display = 'none';
    sanitizeProviderNote(providers.length);
    const status = document.createElement('div');
    status.className = 'v10-kodik-status';
    status.textContent = `Kodik подключён: ${providers.length} вариантов · API ${diagnostics.apiBase || 'kodik-api.com'} · player ${diagnostics.playerDomain || 'kodikplayer.com'}`;
    group.appendChild(status);
  }

  async function loadKodikProviders() {
    if (kodikLoading || kodikLoaded) return;
    const card = $('#providerCard');
    const titles = providerTitleCandidates();
    if (!card || !titles.length) return;
    kodikLoading = true;
    try {
      const year = ($('#sideYear')?.textContent || '').match(/(?:19|20)\d{2}/)?.[0] || '';
      const qs = new URLSearchParams({ title:titles[0], alt:titles.slice(1).join('|'), year, _:String(Date.now()) });
      const r = await fetch(`/.netlify/functions/kodik-v10?${qs}`, { headers:{ accept:'application/json' }, cache:'no-store' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) renderKodikProviders(Array.isArray(data.providers) ? data.providers : [], data.diagnostics || {});
      else sanitizeProviderNote(0);
      kodikLoaded = true;
    } catch {
      sanitizeProviderNote(0);
    } finally { kodikLoading = false; }
  }

  function syncActiveKodikEpisode() {
    if (!activeKodik) return;
    const ep = currentEpisode();
    if (!ep || ep === activeKodikEpisode) return;
    activeKodikEpisode = ep;
    const link = kodikLink(activeKodik, ep);
    const frame = $('#yumeExternalPlayer');
    if (frame && link && frame.src !== link) frame.src = link;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && prefs.pauseWhenHidden === true) {
      const v = activeVideo();
      if (v && !v.paused) v.pause();
    }
  });
  document.addEventListener('yume:player-settings', e => {
    prefs = { ...DEFAULTS, ...readPrefs(), ...(e.detail || {}) };
    if (prefs.autoHideControls === false) showControls(false); else scheduleHide();
  });
  document.addEventListener('click', e => {
    const choice = e.target.closest?.('.provider-choice');
    if (choice && !choice.classList.contains('v10-kodik-choice')) activeKodik = null;
  }, true);

  installStyle();
  const observer = new MutationObserver(() => {
    bindPlayer();
    bindQuality();
    fixLegacyKodik();
    loadKodikProviders();
    decorateButtons(activeVideo());
  });
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['src'] });

  let tries = 0;
  const timer = setInterval(() => {
    bindPlayer();
    bindQuality();
    fixLegacyKodik();
    loadKodikProviders();
    syncActiveKodikEpisode();
    decorateButtons(activeVideo());
    if (++tries > 600) clearInterval(timer);
  }, 300);
})();