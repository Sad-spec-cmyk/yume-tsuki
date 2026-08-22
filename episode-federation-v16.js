(() => {
  if (window.__YUME_EPISODE_FEDERATION_V16) return;
  window.__YUME_EPISODE_FEDERATION_V16 = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const norm = v => String(v || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const nativeByNumber = new Map();
  let providers = [];
  let episodes = [];
  let rebuilding = false;

  function episodeNumberFromRow(row, fallback = 1) {
    const text = row?.querySelector('.episode-number')?.textContent || '';
    const m = text.match(/\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : Number(fallback);
  }

  function titles() {
    return [...new Set([
      $('#animeTitle')?.textContent,
      $('#animeAltTitle')?.textContent,
      window.YUME_NOW_PLAYING?.title,
      document.title?.replace(/\s*[—-]\s*Yume Tsuki\s*$/i, ''),
    ].map(x => String(x || '').trim()).filter(x => x && x !== 'Загрузка...'))];
  }

  function queryString() {
    const all = titles();
    const title = all[0] || '';
    const year = ($('#sideYear')?.textContent || '').trim();
    if (!title) return '';
    return new URLSearchParams({
      title,
      year: /^\d{4}$/.test(year) ? year : '',
      titles: all.slice(1).join('|'),
      _: String(Date.now()),
    }).toString();
  }

  async function request(path, qs) {
    const r = await fetch(`${path}?${qs}`, { headers: { accept:'application/json' }, cache:'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  }

  function dedupeProviders(payloads) {
    const map = new Map();
    for (const payload of payloads) {
      for (const p of Array.isArray(payload?.providers) ? payload.providers : []) {
        if (!p?.id || !p?.name) continue;
        const id = String(p.id);
        if (!map.has(id)) map.set(id, p);
        else {
          const old = map.get(id);
          const mergedEpisodes = { ...(old.episodes || {}), ...(p.episodes || {}) };
          map.set(id, { ...old, ...p, episodes: mergedEpisodes });
        }
      }
    }
    return [...map.values()];
  }

  function providerEpisodeNumbers(p) {
    const out = new Set();
    for (const key of Object.keys(p?.episodes && typeof p.episodes === 'object' ? p.episodes : {})) {
      const n = Number(key); if (Number.isFinite(n) && n > 0) out.add(n);
    }
    for (const value of Array.isArray(p?.availableEpisodes) ? p.availableEpisodes : []) {
      const n = Number(value); if (Number.isFinite(n) && n > 0) out.add(n);
    }
    return [...out].sort((a,b) => a-b);
  }

  function providerSupports(p, n) {
    const eps = p?.episodes && typeof p.episodes === 'object' ? p.episodes : {};
    const key = Object.keys(eps).find(k => Number(k) === Number(n));
    if (key && String(eps[key] || '').trim()) return true;
    return (Array.isArray(p?.availableEpisodes) ? p.availableEpisodes : []).some(x => Number(x) === Number(n));
  }

  function snapshotNativeRows() {
    nativeByNumber.clear();
    const rows = $$('#episodesList .episode-row');
    rows.forEach((row, i) => {
      const n = episodeNumberFromRow(row, i + 1);
      const title = row.querySelector('.episode-copy strong')?.textContent?.trim() || `Эпизод ${n}`;
      const meta = row.querySelector('.episode-copy span')?.textContent?.trim() || 'Готово к просмотру';
      nativeByNumber.set(n, { row, n, title, meta, nativeIndex:Number(row.dataset.index ?? i) });
    });
  }

  function buildEpisodeUnion() {
    const map = new Map();
    for (const [n, native] of nativeByNumber) {
      map.set(n, { n, title:native.title, meta:native.meta, native, providers:[] });
    }
    for (const p of providers) {
      for (const n of providerEpisodeNumbers(p)) {
        if (!map.has(n)) map.set(n, { n, title:`Эпизод ${n}`, meta:'Доступно через дополнительный источник', native:null, providers:[] });
        map.get(n).providers.push(p);
      }
    }
    for (const item of map.values()) {
      if (item.native) item.providers = providers.filter(p => providerSupports(p, item.n));
    }
    episodes = [...map.values()].sort((a,b) => a.n - b.n);
  }

  function sourceCount(item) { return item.providers.length + (item.native ? 1 : 0); }

  function updateTotals() {
    const count = episodes.length;
    if ($('#episodeCount')) $('#episodeCount').textContent = `${count} серий`;
    if ($('#sideEpisodes')) $('#sideEpisodes').textContent = String(count);
    $$('#animeMeta span').forEach(span => {
      if (/^\s*\d+\s+сер/i.test(span.textContent || '')) span.textContent = `${count} серий`;
    });
    $$('#infoList > div').forEach(row => {
      const dt = row.querySelector('dt');
      if (norm(dt?.textContent) === 'серий') { const dd = row.querySelector('dd'); if (dd) dd.textContent = String(count); }
    });
    $$('#technicalInfo .technical-item').forEach(row => {
      const label = row.querySelector('span');
      if (norm(label?.textContent) === 'эпизодов') { const strong = row.querySelector('strong'); if (strong) strong.textContent = String(count); }
    });
    if (window.YUME_NOW_PLAYING) window.YUME_NOW_PLAYING.totalEpisodes = count;
  }

  function renderUnion() {
    const list = $('#episodesList');
    if (!list || !episodes.length) return;
    rebuilding = true;
    const current = Number(window.YUME_NOW_PLAYING?.episodeNumber || 0);
    list.innerHTML = episodes.map(item => {
      const sources = sourceCount(item);
      const meta = item.native?.meta && item.native.meta !== 'Готово к просмотру'
        ? item.native.meta
        : `${sources} ${sources === 1 ? 'источник' : sources < 5 ? 'источника' : 'источников'}`;
      return `<button class="episode-row ${Number(item.n)===current?'active':''}" data-federated-episode="${esc(item.n)}" type="button">
        <span class="episode-number">Серия ${esc(item.n)}</span>
        <span class="episode-copy"><strong>${esc(item.title || `Эпизод ${item.n}`)}</strong><span>${esc(meta)}</span></span>
        <span class="episode-play">▶</span>
      </button>`;
    }).join('');
    list.querySelectorAll('[data-federated-episode]').forEach(btn => {
      btn.addEventListener('click', () => playFederatedEpisode(Number(btn.dataset.federatedEpisode)));
    });
    updateTotals();
    rebuilding = false;
  }

  function markActive(n) {
    $$('#episodesList [data-federated-episode]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.federatedEpisode) === Number(n));
    });
  }

  function showPlayerMessage(title, text) {
    const box = $('#playerMessage');
    if (!box) return;
    box.innerHTML = `<div><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
    box.classList.remove('hidden');
  }
  function hidePlayerMessage() { $('#playerMessage')?.classList.add('hidden'); }

  function setExternalEpisodeUi(item) {
    const n = item.n;
    const title = item.title && item.title !== `Эпизод ${n}` ? item.title : '';
    const animeTitle = $('#animeTitle')?.textContent?.trim() || window.YUME_NOW_PLAYING?.title || 'Аниме';
    const base = window.YUME_NOW_PLAYING || {};
    const alias = base.alias || new URL(location.href).searchParams.get('alias') || '';
    window.YUME_NOW_PLAYING = {
      ...base,
      title: animeTitle,
      alias,
      animeId: base.animeId || alias || animeTitle,
      episode: `Серия ${n}${title ? ` · ${title}` : ''}`,
      episodeNumber: n,
      episodeTitle: title,
      totalEpisodes: episodes.length,
      href: alias ? `/anime?alias=${encodeURIComponent(alias)}` : location.pathname + location.search,
    };
    if ($('#currentEpisodeBadge')) $('#currentEpisodeBadge').textContent = `Серия ${n}`;
    if ($('#nowPlayingTitle')) $('#nowPlayingTitle').textContent = `Серия ${n}${title ? ` — ${title}` : ''}`;
    if ($('#nowPlayingSubtitle')) $('#nowPlayingSubtitle').textContent = animeTitle;
    if ($('#playerHeading')) $('#playerHeading').textContent = `${animeTitle} — серия ${n}`;
    if ($('#playerStatus')) $('#playerStatus').textContent = `Серия ${n} из ${episodes.length}`;
    markActive(n);
    hidePlayerMessage();
  }

  function candidateProviders(item) {
    const activeId = String(window.YUME_ACTIVE_PROVIDER?.id || '');
    const activeName = norm(window.YUME_ACTIVE_PROVIDER?.name || '');
    return [...item.providers].sort((a,b) => {
      const aActive = (activeId && String(a.id) === activeId) || (activeName && norm(a.name) === activeName);
      const bActive = (activeId && String(b.id) === activeId) || (activeName && norm(b.name) === activeName);
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aVoice = a.translationType === 'subtitles' ? 0 : 1;
      const bVoice = b.translationType === 'subtitles' ? 0 : 1;
      if (aVoice !== bVoice) return bVoice - aVoice;
      return 0;
    });
  }

  async function triggerProvider(p) {
    if (!p?.id) return false;
    for (let i = 0; i < 25; i++) {
      const visible = document.querySelector(`.provider-choice[data-provider-id="${CSS.escape(String(p.id))}"]`);
      if (visible) { visible.click(); return true; }
      await sleep(80);
    }
    const temp = document.createElement('button');
    temp.type = 'button'; temp.className = 'provider-choice'; temp.dataset.providerId = String(p.id); temp.style.display = 'none';
    document.body.appendChild(temp); temp.click(); setTimeout(() => temp.remove(), 1500); return true;
  }

  async function playFederatedEpisode(n) {
    const item = episodes.find(x => Number(x.n) === Number(n));
    if (!item) return;
    if (item.native?.row) {
      item.native.row.click();
      setTimeout(() => {
        markActive(n); updateTotals();
        if ($('#playerStatus')) $('#playerStatus').textContent = `Серия ${n} из ${episodes.length}`;
        if (window.YUME_NOW_PLAYING) window.YUME_NOW_PLAYING.totalEpisodes = episodes.length;
      }, 0);
      return;
    }
    setExternalEpisodeUi(item);
    $('#yumeVideo')?.pause();
    const candidates = candidateProviders(item);
    if (!candidates.length) { showPlayerMessage('Серия недоступна', `Для серии ${n} ни один источник не вернул ссылку.`); return; }
    const ok = await triggerProvider(candidates[0]);
    if (!ok) showPlayerMessage('Источник не найден', `Не удалось запустить серию ${n}.`);
    $('#watch')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  async function waitForBasePage() {
    for (let i = 0; i < 160; i++) {
      const title = $('#animeTitle')?.textContent?.trim();
      const list = $('#episodesList');
      if (title && title !== 'Загрузка...' && list) return true;
      await sleep(100);
    }
    return false;
  }

  async function boot() {
    if (!await waitForBasePage()) return;
    await sleep(120);
    snapshotNativeRows();
    const qs = queryString(); if (!qs) return;
    const [direct, catalogs] = await Promise.all([
      request('/.netlify/functions/providers', qs).catch(() => ({ providers:[] })),
      request('/.netlify/functions/provider-catalogs', qs).catch(() => ({ providers:[] })),
    ]);
    providers = dedupeProviders([direct, catalogs]);
    await sleep(80);
    buildEpisodeUnion();
    if (!episodes.length) return;
    renderUnion();
    setInterval(() => {
      if (rebuilding) return;
      const n = Number(window.YUME_NOW_PLAYING?.episodeNumber || 0);
      if (n) markActive(n);
      updateTotals();
    }, 700);
  }

  boot().catch(error => console.error('[Yume federation]', error));
})();
