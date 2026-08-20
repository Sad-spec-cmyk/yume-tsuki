(() => {
  if (window.__YUME_DIRECT_YUMMY_V2) return;
  window.__YUME_DIRECT_YUMMY_V2 = true;
  window.__YUME_DIRECT_YUMMY_V1 = true;

  const providers = new Map();
  const originalFetch = window.fetch.bind(window);
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isYummy(provider) {
    if (!provider) return false;
    const all = [provider.source, ...(provider.via || []), ...(provider.sources || [])]
      .map(x => String(x || '').toLowerCase());
    return all.some(x => x.includes('yummyanime'));
  }

  function episodeNumber() {
    const n = window.YUME_NOW_PLAYING?.episodeNumber;
    if (n !== undefined && n !== null && String(n).trim()) return String(n).trim();
    return ($('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1';
  }

  function sourceFor(provider) {
    const episode = episodeNumber();
    const episodes = provider?.episodes && typeof provider.episodes === 'object' ? provider.episodes : {};
    return episodes[String(episode)]
      || Object.entries(episodes).find(([key]) => Number(key) === Number(episode))?.[1]
      || provider?.link
      || '';
  }

  function notice(text, timeout = 6500) {
    let box = $('#providerNotice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'providerNotice';
      box.style.cssText = 'margin-top:8px;padding:10px 11px;border:1px solid rgba(255,57,95,.28);border-radius:10px;background:rgba(255,57,95,.08);font-size:11px;line-height:1.45;color:#cbd0dc';
      $('#providerCard')?.appendChild(box);
    }
    box.textContent = text;
    box.style.display = 'block';
    clearTimeout(box._timer);
    box._timer = setTimeout(() => { box.style.display = 'none'; }, timeout);
  }

  function destroyHls() {
    if (window.__YUME_DIRECT_YUMMY_HLS) {
      try { window.__YUME_DIRECT_YUMMY_HLS.destroy(); } catch {}
      window.__YUME_DIRECT_YUMMY_HLS = null;
    }
  }

  function removeExternal() {
    destroyHls();
    const video = $('#yumeExternalVideo');
    if (video) {
      try { video.pause(); } catch {}
      video.remove();
    }
    const frame = $('#yumeExternalPlayer');
    if (frame) {
      frame.removeAttribute('src');
      frame.remove();
    }
  }

  function setNativeVisible(visible) {
    const method = visible ? 'remove' : 'add';
    $('#yumeVideo')?.classList[method]('provider-hidden');
    $('#playerControls')?.classList[method]('provider-hidden');
    $('#centerPlay')?.classList[method]('provider-hidden');
    $('#yumePlayer')?.querySelector('.player-topline')?.classList[method]('provider-hidden');
    if (!visible) {
      try { $('#yumeVideo')?.pause(); } catch {}
    }
  }

  function markActive(button, provider, mode = 'direct') {
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    button?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = {
      ...provider,
      kind: 'external',
      source: mode === 'direct' ? 'YummyAnime Direct' : 'YummyAnime Safe Frame',
    };
    const badge = $('#currentQualityBadge');
    if (badge) badge.textContent = provider?.name || 'YummyAnime';
  }

  function restoreNative() {
    removeExternal();
    setNativeVisible(true);
    $$('.provider-choice').forEach(x => x.classList.remove('active'));
    $('#providerCard [data-provider="aniliberty"]')?.classList.add('active');
    window.YUME_ACTIVE_PROVIDER = { id: 'aniliberty', name: 'AniLiberty', kind: 'native' };
  }

  function openSafeFrame(button, provider, source, reason = '') {
    const player = $('#yumePlayer');
    if (!player || !source) return false;
    removeExternal();
    setNativeVisible(false);
    markActive(button, provider, 'frame');

    const frame = document.createElement('iframe');
    frame.id = 'yumeExternalPlayer';
    frame.className = 'yume-external-player yume-safe-yummy-frame';
    frame.src = source;
    frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#020307;z-index:6;border-radius:inherit';
    player.appendChild(frame);

    notice(
      reason
        ? `${provider?.name || 'YummyAnime'}: прямой поток не отдался (${reason}). Открыт защищённый источник без разрешения на всплывающие окна.`
        : `${provider?.name || 'YummyAnime'}: открыт защищённый источник без всплывающих окон.`,
      8000,
    );
    return true;
  }

  function createExternalVideo(provider) {
    const player = $('#yumePlayer');
    if (!player) return null;
    removeExternal();
    setNativeVisible(false);

    const video = document.createElement('video');
    video.id = 'yumeExternalVideo';
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#020307;z-index:5;border-radius:inherit';
    video.dataset.yummyDirect = '1';
    video.dataset.providerName = provider?.name || 'YummyAnime';
    player.appendChild(video);
    return video;
  }

  function waitUntilPlayable(video, timeoutMs = 9000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (ok, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ['playing','canplay','loadeddata','error','stalled','abort'].forEach(type => video.removeEventListener(type, handlers[type]));
        ok ? resolve(value) : reject(value instanceof Error ? value : new Error(String(value || 'Поток не запустился')));
      };
      const handlers = {
        playing: () => finish(true, true),
        canplay: () => finish(true, true),
        loadeddata: () => finish(true, true),
        error: () => finish(false, new Error('браузер не смог открыть видеопоток')),
        stalled: () => {},
        abort: () => finish(false, new Error('загрузка потока прервана')),
      };
      for (const [type, handler] of Object.entries(handlers)) video.addEventListener(type, handler, { once: type !== 'stalled' });
      const timer = setTimeout(() => finish(false, new Error('видеопоток не запустился вовремя')), timeoutMs);
    });
  }

  async function playDirect(button, provider, resolved, fallbackSource) {
    const video = createExternalVideo(provider);
    if (!video || !resolved?.stream) throw new Error('не удалось создать Yume Player');
    markActive(button, provider, 'direct');

    window.YUME_EXTERNAL_QUALITIES = resolved.qualities || {};
    window.dispatchEvent(new CustomEvent('yume:external-qualities', {
      detail: { qualities: resolved.qualities || {}, provider },
    }));

    const stream = String(resolved.stream || '');
    let fatalHlsError = null;
    if (/\.m3u8(?:$|\?)/i.test(stream) && window.Hls?.isSupported?.()) {
      const hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        manifestLoadingTimeOut: 8000,
        levelLoadingTimeOut: 8000,
        fragLoadingTimeOut: 10000,
      });
      window.__YUME_DIRECT_YUMMY_HLS = hls;
      hls.loadSource(stream);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (data?.fatal) {
          fatalHlsError = new Error(data?.details || 'ошибка HLS');
          try { video.dispatchEvent(new Event('error')); } catch {}
        }
      });
    } else {
      video.src = stream;
      video.play().catch(() => {});
    }

    try {
      await waitUntilPlayable(video, 9000);
      if (fatalHlsError) throw fatalHlsError;
      notice(`${provider?.name || 'YummyAnime'} запущен через Yume Player.`, 2800);
      return true;
    } catch (error) {
      removeExternal();
      if (fallbackSource) {
        openSafeFrame(button, provider, fallbackSource, error?.message || 'поток недоступен');
        return false;
      }
      restoreNative();
      throw error;
    }
  }

  async function resolveAndPlay(button, provider) {
    const source = sourceFor(provider);
    if (!source) {
      notice(`Для «${provider?.name || 'этой озвучки'}» нет ссылки на серию ${episodeNumber()}.`);
      return;
    }

    if (button?.dataset.yumeBusy === '1') return;
    button.dataset.yumeBusy = '1';
    button.classList.add('is-resolving');
    const small = button.querySelector('small');
    const oldSmall = small?.textContent || '';
    if (small) small.textContent = 'Ищем прямой поток для Yume Player…';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14500);
    try {
      const params = new URLSearchParams({
        url: source,
        player: provider?.player || '',
        _: String(Date.now()),
      });
      const response = await originalFetch(`/.netlify/functions/resolve-yummy?${params}`, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.stream) {
        const reason = data?.error || `ошибка ${response.status}`;
        openSafeFrame(button, provider, source, reason);
        return;
      }
      await playDirect(button, provider, data, source);
    } catch (error) {
      if (error?.name === 'AbortError') {
        openSafeFrame(button, provider, source, 'источник слишком долго отвечал');
      } else {
        openSafeFrame(button, provider, source, error?.message || 'не удалось получить прямой поток');
      }
    } finally {
      clearTimeout(timer);
      button.classList.remove('is-resolving');
      button.dataset.yumeBusy = '0';
      if (small) small.textContent = oldSmall;
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      if (String(url).includes('/.netlify/functions/providers')) {
        response.clone().json().then(data => {
          for (const provider of Array.isArray(data?.providers) ? data.providers : []) {
            if (provider?.id) providers.set(String(provider.id), provider);
          }
        }).catch(() => {});
      }
    } catch {}
    return response;
  };

  document.addEventListener('click', event => {
    const native = event.target.closest?.('#providerCard [data-provider="aniliberty"]');
    if (native) {
      removeExternal();
      setNativeVisible(true);
      return;
    }

    const button = event.target.closest?.('.provider-choice[data-provider-id]');
    if (!button) return;
    const provider = providers.get(String(button.dataset.providerId || ''));
    if (!isYummy(provider)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    resolveAndPlay(button, provider);
  }, true);

  document.addEventListener('yume:episode-change', async () => {
    const active = window.YUME_ACTIVE_PROVIDER;
    if (!active || !isYummy(active)) return;
    await sleep(80);
    const button = document.querySelector(`.provider-choice[data-provider-id="${CSS.escape(String(active.id || ''))}"]`);
    if (button) resolveAndPlay(button, active);
  });
})();