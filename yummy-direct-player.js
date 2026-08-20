(() => {
  if (window.__YUME_DIRECT_YUMMY_V1) return;
  window.__YUME_DIRECT_YUMMY_V1 = true;

  const providers = new Map();
  const originalFetch = window.fetch.bind(window);
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  function isYummy(p) {
    if (!p) return false;
    const all = [p.source, ...(p.via || []), ...(p.sources || [])].map(x => String(x || '').toLowerCase());
    return all.some(x => x.includes('yummyanime'));
  }

  function episodeNumber() {
    const n = window.YUME_NOW_PLAYING?.episodeNumber;
    if (n !== undefined && n !== null && String(n).trim()) return String(n).trim();
    return ($('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1';
  }

  function sourceFor(p) {
    const ep = episodeNumber();
    const eps = p?.episodes && typeof p.episodes === 'object' ? p.episodes : {};
    return eps[String(ep)] || Object.entries(eps).find(([k]) => Number(k) === Number(ep))?.[1] || p?.link || '';
  }

  function notice(text) {
    let box = $('#providerNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'providerNotice';
      box.style.cssText = 'margin-top:8px;padding:9px 10px;border:1px solid rgba(255,57,95,.28);border-radius:10px;background:rgba(255,57,95,.08);font-size:11px;line-height:1.45;color:#cbd0dc';
      $('#providerCard')?.appendChild(box);
    }
    box.textContent = text;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.style.display = 'none'; }, 5000);
  }

  function resetProviderRuntime() {
    try { $('#providerCard [data-provider="aniliberty"]')?.click(); } catch {}
    const old = $('#yumeExternalVideo');
    if (old) { try { old.pause(); } catch {} old.remove(); }
    const frame = $('#yumeExternalPlayer');
    if (frame) { frame.classList.add('hidden'); frame.removeAttribute('src'); frame.style.display = 'none'; }
    if (window.__YUME_DIRECT_YUMMY_HLS) {
      try { window.__YUME_DIRECT_YUMMY_HLS.destroy(); } catch {}
      window.__YUME_DIRECT_YUMMY_HLS = null;
    }
  }

  function markActive(button, provider) {
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    button?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = { ...provider, kind: 'external', source: 'YummyAnime Direct' };
    const badge = $('#currentQualityBadge');
    if (badge) badge.textContent = provider?.name || 'YummyAnime';
  }

  function playDirect(button, provider, resolved) {
    const player = $('#yumePlayer');
    if (!player || !resolved?.stream) return;
    resetProviderRuntime();

    $('#yumeVideo')?.pause();
    $('#yumeVideo')?.classList.add('provider-hidden');
    $('#playerControls')?.classList.add('provider-hidden');
    $('#centerPlay')?.classList.add('provider-hidden');
    player.querySelector('.player-topline')?.classList.add('provider-hidden');

    markActive(button, provider);

    const video = document.createElement('video');
    video.id = 'yumeExternalVideo';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'metadata';
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#020307;z-index:5;border-radius:inherit';
    video.dataset.yummyDirect = '1';
    video.dataset.providerName = provider?.name || 'YummyAnime';
    player.appendChild(video);

    window.YUME_EXTERNAL_QUALITIES = resolved.qualities || {};
    window.dispatchEvent(new CustomEvent('yume:external-qualities', { detail: { qualities: resolved.qualities || {}, provider } }));

    const stream = String(resolved.stream || '');
    if (/\.m3u8(?:$|\?)/i.test(stream) && window.Hls?.isSupported?.()) {
      const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60 });
      window.__YUME_DIRECT_YUMMY_HLS = hls;
      hls.loadSource(stream);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) notice('Поток этой озвучки сейчас недоступен. Внешний рекламный плеер не открываем.');
      });
    } else {
      video.src = stream;
      video.play().catch(() => {});
    }
  }

  async function resolveAndPlay(button, provider) {
    const source = sourceFor(provider);
    if (!source) return notice(`Для «${provider?.name || 'этой озвучки'}» нет ссылки на серию ${episodeNumber()}.`);
    button?.classList.add('is-resolving');
    const oldSmall = button?.querySelector('small')?.textContent || '';
    if (button?.querySelector('small')) button.querySelector('small').textContent = 'Получаем прямой поток · без рекламы…';
    try {
      const r = await originalFetch(`/.netlify/functions/resolve-yummy?url=${encodeURIComponent(source)}&_=${Date.now()}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.stream) throw new Error(data?.error || `Ошибка ${r.status}`);
      playDirect(button, provider, data);
    } catch (e) {
      notice(`${provider?.name || 'YummyAnime'}: ${e?.message || 'не удалось получить прямой поток'}. Рекламный iframe не открываем.`);
    } finally {
      button?.classList.remove('is-resolving');
      if (button?.querySelector('small')) button.querySelector('small').textContent = oldSmall;
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/.netlify/functions/providers')) {
        response.clone().json().then(data => {
          for (const p of Array.isArray(data?.providers) ? data.providers : []) if (p?.id) providers.set(String(p.id), p);
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  document.addEventListener('click', e => {
    const button = e.target.closest?.('.provider-choice[data-provider-id]');
    if (!button) return;
    const provider = providers.get(String(button.dataset.providerId || ''));
    if (!isYummy(provider)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    resolveAndPlay(button, provider);
  }, true);
})();