(() => {
  if (window.__YUME_ADVANCED_PLAYER_SETTINGS_V10) return;
  window.__YUME_ADVANCED_PLAYER_SETTINGS_V10 = true;

  const $ = s => document.querySelector(s);
  const feature = (...args) => window.YUME_ACCOUNT?.feature?.(...args);
  const EXTRA_KEY = 'yume-player-settings-v2';
  const EXTRA_DEFAULTS = {
    autoHideControls: true,
    hideDelay: 2600,
    rememberQuality: true,
    rememberSpeed: true,
    rememberVolume: true,
    pauseWhenHidden: false,
  };

  let accountPrefs = { autoSkipOpening:true, autoNextEpisode:true };
  let extra = { ...EXTRA_DEFAULTS };

  function readExtra() {
    try { extra = { ...EXTRA_DEFAULTS, ...(JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}') || {}) }; }
    catch { extra = { ...EXTRA_DEFAULTS }; }
  }

  function installStyle() {
    if ($('#yumeV10SettingsStyle')) return;
    const style = document.createElement('style');
    style.id = 'yumeV10SettingsStyle';
    style.textContent = `
      #playbackPreferences.v10-playback-settings{
        grid-column:1/-1!important;padding:0!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.09)!important;
        background:linear-gradient(145deg,rgba(14,16,23,.92),rgba(8,10,15,.94))!important;box-shadow:0 24px 70px rgba(0,0,0,.22)!important;
      }
      .v10-playback-settings .v10-settings-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:24px 26px 20px;border-bottom:1px solid rgba(255,255,255,.07);background:radial-gradient(circle at 0 0,color-mix(in srgb,var(--accent) 12%,transparent),transparent 42%)}
      .v10-playback-settings .v10-settings-kicker{display:flex;align-items:center;gap:8px;color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
      .v10-playback-settings .v10-settings-kicker i{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 16px var(--accent)}
      .v10-playback-settings .v10-settings-hero h2{margin:7px 0 6px;font-size:25px;letter-spacing:-.03em;color:#f7f8fb}
      .v10-playback-settings .v10-settings-hero p{margin:0;max-width:650px;color:#81899a;font-size:12px;line-height:1.55}
      .v10-playback-settings #prefsSaved{flex:none;padding:7px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);font-size:10px;color:#9aa2b1}
      .v10-settings-body{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:14px}
      .v10-settings-group{min-width:0;border:1px solid rgba(255,255,255,.075);border-radius:16px;background:rgba(255,255,255,.018);overflow:hidden}
      .v10-settings-group-head{display:flex;align-items:center;gap:10px;padding:14px 15px 12px;border-bottom:1px solid rgba(255,255,255,.055)}
      .v10-settings-group-head i{width:30px;height:30px;border-radius:10px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 11%,rgba(255,255,255,.025));color:var(--accent);font-style:normal;font-size:13px}
      .v10-settings-group-head strong{display:block;color:#edf0f5;font-size:12px}.v10-settings-group-head span{display:block;margin-top:2px;color:#6f7787;font-size:10px}
      .v10-setting-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:66px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .15s ease}
      .v10-setting-row:last-child{border-bottom:0}.v10-setting-row:hover{background:rgba(255,255,255,.026)}
      .v10-setting-copy{min-width:0}.v10-setting-copy strong{display:block;color:#e8ebf1;font-size:12px;line-height:1.3}.v10-setting-copy small{display:block;margin-top:4px;color:#747d8d;font-size:10px;line-height:1.38}
      .v10-switch{position:relative;flex:none;width:40px;height:23px}.v10-switch input{position:absolute;opacity:0;pointer-events:none}.v10-switch i{position:absolute;inset:0;border-radius:999px;background:#252a34;border:1px solid rgba(255,255,255,.08);transition:.18s ease}
      .v10-switch i:after{content:"";position:absolute;width:17px;height:17px;left:2px;top:2px;border-radius:50%;background:#d9dde5;box-shadow:0 2px 7px rgba(0,0,0,.35);transition:.18s ease}
      .v10-switch input:checked+i{background:var(--accent);border-color:transparent;box-shadow:0 0 18px color-mix(in srgb,var(--accent) 24%,transparent)}
      .v10-switch input:checked+i:after{transform:translateX(17px);background:white}
      .v10-delay-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-top:1px solid rgba(255,255,255,.05)}
      .v10-delay-row span strong{display:block;color:#e8ebf1;font-size:11px}.v10-delay-row span small{display:block;color:#747d8d;font-size:9px;margin-top:3px}
      #prefHideDelay{width:92px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.09);background:#10131a;color:#eef1f6;padding:0 8px;font-size:10px;outline:none}
      .v10-settings-foot{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px 14px;color:#687181;font-size:10px;border-top:1px solid rgba(255,255,255,.055)}
      .v10-settings-foot b{color:#9ba3b1;font-weight:700}
      @media(max-width:1050px){.v10-settings-body{grid-template-columns:1fr 1fr}.v10-settings-group:last-child{grid-column:1/-1}}
      @media(max-width:720px){
        .v10-playback-settings .v10-settings-hero{padding:19px 17px 16px;flex-direction:column;gap:12px}.v10-playback-settings .v10-settings-hero h2{font-size:22px}
        .v10-settings-body{grid-template-columns:1fr;padding:9px;gap:9px}.v10-settings-group:last-child{grid-column:auto}.v10-setting-row{min-height:62px;padding:11px 12px}.v10-settings-foot{align-items:flex-start;flex-direction:column}
      }
    `;
    document.head.appendChild(style);
  }

  function toggle(id, title, description) {
    return `<label class="v10-setting-row"><span class="v10-setting-copy"><strong>${title}</strong><small>${description}</small></span><span class="v10-switch"><input id="${id}" type="checkbox"><i></i></span></label>`;
  }

  function group(icon, title, subtitle, rows, extraHtml = '') {
    return `<section class="v10-settings-group"><div class="v10-settings-group-head"><i>${icon}</i><div><strong>${title}</strong><span>${subtitle}</span></div></div>${rows}${extraHtml}</section>`;
  }

  function markup() {
    const autoplay = toggle('prefSkipOpening','Пропускать опенинг','Переходить к концу опенинга по таймингам серии.') +
      toggle('prefAutoNext','Следующая серия автоматически','Запускать следующую серию после окончания текущей.');
    const interfaceRows = toggle('prefAutoHide','Скрывать интерфейс','Убирать верхнюю и нижнюю панели во время просмотра.');
    const delay = `<div class="v10-delay-row"><span><strong>Задержка скрытия</strong><small>После последнего движения мыши</small></span><select id="prefHideDelay"><option value="1800">1.8 сек</option><option value="2600">2.6 сек</option><option value="4000">4 сек</option><option value="6000">6 сек</option></select></div>`;
    const remember = toggle('prefRememberQuality','Запоминать качество','Восстанавливать последнее выбранное качество.') +
      toggle('prefRememberSpeed','Запоминать скорость','Сохранять скорость воспроизведения между сериями.') +
      toggle('prefRememberVolume','Запоминать громкость','Одинаковая громкость для AniLiberty и прямых источников.') +
      toggle('prefPauseHidden','Пауза при сворачивании','Ставить видео на паузу при переходе на другую вкладку.');

    return `<div class="v10-settings-hero"><div><span class="v10-settings-kicker"><i></i> YUME PLAYER</span><h2>Настройки просмотра</h2><p>Только полезные настройки плеера — без огромных пустых блоков. Изменения применяются сразу.</p></div><span id="prefsSaved">Сохранено</span></div>
      <div class="v10-settings-body">
        ${group('▶','Автовоспроизведение','Серии и опенинги',autoplay)}
        ${group('◫','Интерфейс','Поведение панелей',interfaceRows,delay)}
        ${group('●','Память плеера','Качество, звук и скорость',remember)}
      </div>
      <div class="v10-settings-foot"><span><b>В аккаунте:</b> опенинг и автопереход между сериями.</span><span><b>В браузере:</b> интерфейс, громкость, скорость и качество.</span></div>`;
  }

  function ensureCard() {
    installStyle();
    let card = $('#playbackPreferences');
    if (!card) {
      const target = $('.settings-grid');
      if (!target) return null;
      card = document.createElement('section');
      card.id = 'playbackPreferences';
      card.className = 'account-card';
      target.appendChild(card);
    }
    if (card.dataset.v10 === '1') return card;
    card.dataset.v10 = '1';
    card.className = 'account-card v10-playback-settings';
    card.innerHTML = markup();
    ['prefSkipOpening','prefAutoNext','prefAutoHide','prefRememberQuality','prefRememberSpeed','prefRememberVolume','prefPauseHidden','prefHideDelay'].forEach(id => $('#'+id)?.addEventListener('change', save));
    return card;
  }

  function render() {
    if (!ensureCard()) return;
    $('#prefSkipOpening').checked = accountPrefs.autoSkipOpening !== false;
    $('#prefAutoNext').checked = accountPrefs.autoNextEpisode !== false;
    $('#prefAutoHide').checked = extra.autoHideControls !== false;
    $('#prefRememberQuality').checked = extra.rememberQuality !== false;
    $('#prefRememberSpeed').checked = extra.rememberSpeed !== false;
    $('#prefRememberVolume').checked = extra.rememberVolume !== false;
    $('#prefPauseHidden').checked = extra.pauseWhenHidden === true;
    $('#prefHideDelay').value = String([1800,2600,4000,6000].includes(Number(extra.hideDelay)) ? Number(extra.hideDelay) : 2600);
  }

  function collectExtra() {
    return {
      autoHideControls: $('#prefAutoHide')?.checked !== false,
      hideDelay: Number($('#prefHideDelay')?.value || 2600),
      rememberQuality: $('#prefRememberQuality')?.checked !== false,
      rememberSpeed: $('#prefRememberSpeed')?.checked !== false,
      rememberVolume: $('#prefRememberVolume')?.checked !== false,
      pauseWhenHidden: $('#prefPauseHidden')?.checked === true,
    };
  }

  async function save() {
    accountPrefs = {
      autoSkipOpening: $('#prefSkipOpening')?.checked !== false,
      autoNextEpisode: $('#prefAutoNext')?.checked !== false,
    };
    extra = collectExtra();
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extra)); } catch {}
    const status = $('#prefsSaved');
    if (status) status.textContent = 'Сохраняем…';
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method:'POST', body:JSON.stringify(accountPrefs) });
        accountPrefs = { ...accountPrefs, ...(data.preferences || {}) };
        if (status) status.textContent = 'Сохранено';
      } catch (e) { if (status) status.textContent = e.message || 'Ошибка'; }
    } else if (status) status.textContent = 'Сохранено в браузере';
    document.dispatchEvent(new CustomEvent('yume:player-settings', { detail:{ ...accountPrefs, ...extra } }));
  }

  async function load() {
    readExtra();
    ensureCard();
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method:'GET', headers:{} });
        accountPrefs = { ...accountPrefs, ...(data.preferences || {}) };
      } catch {}
    }
    render();
    document.dispatchEvent(new CustomEvent('yume:player-settings', { detail:{ ...accountPrefs, ...extra } }));
  }

  document.addEventListener('yume:session', () => setTimeout(load, 30));
  if (window.YUME_ACCOUNT?.ready) setTimeout(load, 30);
  else setTimeout(load, 320);
})();