(() => {
  const $ = s => document.querySelector(s);
  const feature = (...args) => window.YUME_ACCOUNT?.feature?.(...args);
  const DEFAULTS = { autoSkipOpening: true, autoNextEpisode: true };
  let prefs = { ...DEFAULTS };

  function ensureCard() {
    if ($('#playbackPreferences')) return $('#playbackPreferences');
    const target = document.querySelector('.settings-grid');
    if (!target) return null;
    const card = document.createElement('section');
    card.id = 'playbackPreferences';
    card.className = 'account-card playback-preferences';
    card.innerHTML = `
      <div class="card-head">
        <div><span class="section-kicker">ПЛЕЕР</span><h2>Настройки просмотра</h2></div>
        <span id="prefsSaved" class="status">Сохраняются автоматически</span>
      </div>
      <label class="setting-toggle">
        <span><strong>Автопропуск опенинга</strong><small>Если включено, плеер использует тайминги серии и сразу переходит к концу опенинга.</small></span>
        <input id="prefSkipOpening" type="checkbox"><i></i>
      </label>
      <label class="setting-toggle">
        <span><strong>Автопереход к следующей серии</strong><small>После окончания серии следующая запускается автоматически.</small></span>
        <input id="prefAutoNext" type="checkbox"><i></i>
      </label>
      <p class="preferences-note">Чтобы опенинг <b>не пропускался</b>, просто выключи первую галочку.</p>`;
    target.appendChild(card);

    $('#prefSkipOpening').addEventListener('change', save);
    $('#prefAutoNext').addEventListener('change', save);
    return card;
  }

  function render() {
    ensureCard();
    const a = $('#prefSkipOpening'), b = $('#prefAutoNext');
    if (!a || !b) return;
    a.checked = prefs.autoSkipOpening !== false;
    b.checked = prefs.autoNextEpisode !== false;
  }

  function collect() {
    return {
      autoSkipOpening: $('#prefSkipOpening')?.checked !== false,
      autoNextEpisode: $('#prefAutoNext')?.checked !== false,
    };
  }

  async function save() {
    prefs = collect();
    try { localStorage.setItem('yume-preferences', JSON.stringify(prefs)); } catch {}
    const status = $('#prefsSaved');
    if (status) status.textContent = 'Сохраняем...';
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method: 'POST', body: JSON.stringify(prefs) });
        prefs = { ...DEFAULTS, ...(data.preferences || prefs) };
        if (status) status.textContent = 'Сохранено';
      } catch (e) {
        if (status) status.textContent = e.message || 'Ошибка';
      }
    } else if (status) {
      status.textContent = 'Сохранено в браузере';
    }
    document.dispatchEvent(new CustomEvent('yume:preferences', { detail: prefs }));
  }

  async function load() {
    try { prefs = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem('yume-preferences') || '{}') || {}) }; } catch {}
    ensureCard();
    render();
    if (window.YUME_ACCOUNT?.user && feature) {
      try {
        const data = await feature('preferences', { method: 'GET', headers: {} });
        prefs = { ...DEFAULTS, ...(data.preferences || {}) };
        localStorage.setItem('yume-preferences', JSON.stringify(prefs));
      } catch {}
      render();
    }
  }

  document.addEventListener('yume:session', () => setTimeout(load, 0));
  if (window.YUME_ACCOUNT?.ready) setTimeout(load, 0);
  else setTimeout(() => { ensureCard(); render(); }, 300);
})();