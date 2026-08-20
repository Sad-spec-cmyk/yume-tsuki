(() => {
  if (window.__YUME_ADVANCED_PLAYER_SETTINGS_V1) return;
  window.__YUME_ADVANCED_PLAYER_SETTINGS_V1 = true;

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
  let oldPrefs = { autoSkipOpening: true, autoNextEpisode: true };
  let extra = { ...EXTRA_DEFAULTS };

  function loadExtra() {
    try { extra = { ...EXTRA_DEFAULTS, ...(JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}') || {}) }; }
    catch { extra = { ...EXTRA_DEFAULTS }; }
  }

  function installStyle() {
    if ($('#yumeAdvancedSettingsStyle')) return;
    const style = document.createElement('style');
    style.id = 'yumeAdvancedSettingsStyle';
    style.textContent = `
      #playbackPreferences.advanced-playback-preferences{padding:22px!important}
      .advanced-playback-preferences .advanced-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
      .advanced-playback-preferences .setting-toggle{min-height:104px;margin:0!important;padding:17px 18px!important;border:1px solid rgba(255,255,255,.10)!important;border-radius:18px!important;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018))!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:18px;transition:.18s ease}
      .advanced-playback-preferences .setting-toggle:hover{border-color:color-mix(in srgb,var(--accent) 36%,rgba(255,255,255,.1))!important;background:linear-gradient(145deg,color-mix(in srgb,var(--accent) 7%,rgba(255,255,255,.04)),rgba(255,255,255,.02))!important}
      .advanced-playback-preferences .setting-toggle strong{display:block;font-size:14px;margin-bottom:6px;color:#f2f3f7}
      .advanced-playback-preferences .setting-toggle small{display:block;max-width:520px;line-height:1.45;color:#858c9b}
      .advanced-playback-preferences .settings-subrow{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 16px;border-radius:15px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07)}
      .advanced-playback-preferences .settings-subrow span{display:grid;gap:3px}.advanced-playback-preferences .settings-subrow strong{font-size:13px}.advanced-playback-preferences .settings-subrow small{font-size:11px;color:#7f8796}
      .advanced-playback-preferences .settings-subrow select{min-width:140px;height:40px;border-radius:11px;border:1px solid rgba(255,255,255,.11);background:#11151d;color:#fff;padding:0 12px;outline:none}
      .advanced-playback-preferences .preferences-note{margin:14px 0 0!important;padding:12px 14px!important;border-radius:13px;background:rgba(255,255,255,.025)!important;color:#7f8796!important}
      @media(max-width:760px){.advanced-playback-preferences .advanced-settings-grid{grid-template-columns:1fr}.advanced-playback-preferences .setting-toggle{min-height:92px;padding:14px!important}.advanced-playback-preferences .settings-subrow{align-items:flex-start;flex-direction:column}.advanced-playback-preferences .settings-subrow select{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function cardHtml() {
    return `
      <div class="card-head">
        <div><span class="section-kicker">ПЛЕЕР</span><h2>Настройки просмотра</h2></div>
        <span id="prefsSaved" class="status">Сохраняются автоматически</span>
      </div>
      <div class="advanced-settings-grid">
        ${toggle('prefSkipOpening','Автопропуск опенинга','Использовать тайминги серии и автоматически переходить к концу опенинга.')}
        ${toggle('prefAutoNext','Автопереход к следующей серии','После окончания текущей серии следующая запускается автоматически.')}
        ${toggle('prefAutoHide','Автоскрытие панелей','Во время воспроизведения верхняя и нижняя панели исчезают без движения мыши.')}
        ${toggle('prefRememberQuality','Запоминать качество','Сохранять последнее выбранное качество и восстанавливать его при следующем просмотре.')}
        ${toggle('prefRememberSpeed','Запоминать скорость','Сохранять 0.75×, 1×, 1.25×, 1.5× или 2× между сериями.')}
        ${toggle('prefRememberVolume','Запоминать громкость','Восстанавливать уровень громкости для основного и внешних плееров.')}
        ${toggle('prefPauseHidden','Пауза при сворачивании','Автоматически ставить видео на паузу, когда вкладка становится неактивной.')}
        <label class="settings-subrow"><span><strong>Скрывать панели через</strong><small>Задержка после последнего движения мыши или касания.</small></span><select id="prefHideDelay"><option value="1800">1.8 сек</option><option value="2600">2.6 сек</option><option value="4000">4 сек</option><option value="6000">6 сек</option></select></label>
      </div>
      <p class="preferences-note">Настройки опенинга и следующей серии сохраняются в аккаунте. Настройки интерфейса плеера сохраняются в этом браузере.</p>`;
  }

  function toggle(id, title, text) {
    return `<label class="setting-toggle"><span><strong>${title}</strong><small>${text}</small></span><input id="${id}" type="checkbox"><i></i></label>`;
  }

  function ensureCard() {
    installStyle();
    let card = $('#playbackPreferences');
    if (!card) {
      const target = $('.settings-grid');
      if (!target) return null;
      card = document.createElement('section');
      card.id = 'playbackPreferences';
      card.className = 'account-card playback-preferences';
      target.appendChild(card);
    }
    if (card.dataset.advanced === '1') return card;
    card.dataset.advanced = '1';
    card.classList.add('advanced-playback-preferences');
    card.innerHTML = cardHtml();
    ['prefSkipOpening','prefAutoNext','prefAutoHide','prefRememberQuality','prefRememberSpeed','prefRememberVolume','prefPauseHidden','prefHideDelay'].forEach(id => $('#'+id)?.addEventListener('change', save));
    return card;
  }

  function render() {
    if (!ensureCard()) return;
    $('#prefSkipOpening').checked = oldPrefs.autoSkipOpening !== false;
    $('#prefAutoNext').checked = oldPrefs.autoNextEpisode !== false;
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
    oldPrefs = {
      autoSkipOpening: $('#prefSkipOpening')?.checked !== false,
      autoNextEpisode: $('#prefAutoNext')?.checked !== false,
    };
    extra = collectExtra();
    try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extra)); } catch {}
    const status = $('#prefsSaved');
    if (status) status.textContent = 'Сохраняем...';
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method:'POST', body:JSON.stringify(oldPrefs) });
        oldPrefs = { ...oldPrefs, ...(data.preferences || {}) };
        if (status) status.textContent = 'Сохранено';
      } catch (e) { if (status) status.textContent = e.message || 'Ошибка'; }
    } else if (status) status.textContent = 'Сохранено в браузере';
    document.dispatchEvent(new CustomEvent('yume:player-settings', { detail:{ ...oldPrefs, ...extra } }));
  }

  async function load() {
    loadExtra();
    ensureCard();
    render();
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method:'GET', headers:{} });
        oldPrefs = { ...oldPrefs, ...(data.preferences || {}) };
      } catch {}
    }
    render();
    document.dispatchEvent(new CustomEvent('yume:player-settings', { detail:{ ...oldPrefs, ...extra } }));
  }

  document.addEventListener('yume:session', () => setTimeout(load, 50));
  if (window.YUME_ACCOUNT?.ready) setTimeout(load, 50);
  else setTimeout(load, 350);
})();