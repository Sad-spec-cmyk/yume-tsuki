(() => {
  if (window.__YUME_RUNTIME_FIXES) return;
  window.__YUME_RUNTIME_FIXES = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const pageStartedAt = Date.now();
  const firstUrl = new URL(location.href);
  const initialPartyCode = String(firstUrl.searchParams.get('party') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const initialAlias = firstUrl.searchParams.get('alias') || firstUrl.searchParams.get('id') || '';
  let guestRoom = initialPartyCode;
  let guestTimer = 0;
  let syncing = false;
  let destructiveSaveGuardUntil = Date.now() + 15000;
  let resumeBackup = null;

  if (initialPartyCode) {
    try { sessionStorage.setItem('yume-pending-party', initialPartyCode); } catch {}
  }

  function currentKey() {
    const u = new URL(location.href);
    return u.searchParams.get('alias') || initialAlias || window.YUME_NOW_PLAYING?.alias || window.YUME_NOW_PLAYING?.animeId || window.YUME_NOW_PLAYING?.title || '';
  }
  function resumeKey() { return `yume-resume:${String(currentKey()).trim().toLowerCase()}`; }
  function currentEpisodeIndex() {
    const active = $('.episode-row.active');
    return active ? Number(active.dataset.index || 0) : 0;
  }
  function readLocalResume() {
    try { return JSON.parse(localStorage.getItem(resumeKey()) || 'null'); } catch { return null; }
  }
  resumeBackup = readLocalResume();

  // anime.js used to save 0:00 immediately while a new HLS source was still loading.
  // Intercept only those destructive bootstrap/source-switch saves and preserve the last real position.
  if (!window.__YUME_RESUME_FETCH_GUARD) {
    window.__YUME_RESUME_FETCH_GUARD = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
      const rawUrl = typeof input === 'string' ? input : input?.url || '';
      const isResume = rawUrl.includes('resume-favorites') && rawUrl.includes('action=resume');
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();

      if (isResume && method === 'POST') {
        let payload = null;
        try { payload = JSON.parse(typeof init.body === 'string' ? init.body : '{}'); } catch {}
        const previous = resumeBackup || readLocalResume();
        const destructive = payload && Number(payload.position || 0) < 2 && Number(payload.duration || 0) <= 1 && previous && Number(previous.position || 0) > 10;
        const sameEpisode = destructive && Number(payload.episodeIndex || 0) === Number(previous.episodeIndex || 0);
        if (sameEpisode && Date.now() < destructiveSaveGuardUntil) {
          return new Response(JSON.stringify({ ok: true, item: previous, guarded: true }), {
            status: 201,
            headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
      }

      const response = await nativeFetch(input, init);
      if (isResume && method === 'GET' && response.ok) {
        response.clone().json().then(data => {
          if (data?.item && Number(data.item.position || 0) > Number(resumeBackup?.position || 0)) resumeBackup = data.item;
        }).catch(() => {});
      }
      if (isResume && method === 'POST' && response.ok) {
        try {
          const payload = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
          if (Number(payload.position || 0) > 2 || Number(payload.duration || 0) > 1) resumeBackup = payload;
        } catch {}
      }
      return response;
    };
  }

  function feature(...args) { return window.YUME_ACCOUNT?.feature?.(...args); }

  async function readResume() {
    let local = readLocalResume(), remote = null;
    if (window.YUME_ACCOUNT?.user && feature) {
      try { remote = (await feature('resume', { method: 'GET', headers: {} }, { key: currentKey() })).item || null; } catch {}
    }
    const best = [resumeBackup, local, remote].filter(Boolean).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
    if (best && Number(best.position || 0) > Number(resumeBackup?.position || 0)) resumeBackup = best;
    return best;
  }

  async function waitForVideoReady(video, timeout = 12000) {
    if (!video) return false;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (video.readyState >= 1 && ((Number.isFinite(video.duration) && video.duration > 0) || video.seekable?.length)) return true;
      await sleep(120);
    }
    return false;
  }

  function maxSeekable(video) {
    if (video.seekable?.length) {
      try { return video.seekable.end(video.seekable.length - 1); } catch {}
    }
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return 0;
  }

  async function seekRobust(position, autoplay) {
    const video = $('#yumeVideo');
    if (!video) return false;
    const target = Math.max(0, Number(position) || 0);
    await waitForVideoReady(video);
    for (let i = 0; i < 40; i++) {
      const max = maxSeekable(video);
      if (max > 0) {
        const desired = Math.min(target, Math.max(0, max - .6));
        try { video.currentTime = desired; } catch {}
        await sleep(110);
        if (Math.abs(Number(video.currentTime || 0) - desired) < 1.35) {
          if (autoplay) await video.play().catch(() => {});
          else video.pause();
          return true;
        }
      }
      await sleep(140);
    }
    if (autoplay) video.play().catch(() => {});
    return false;
  }

  async function applyQuality(label) {
    if (!label) return;
    const select = $('#qualitySelect');
    if (!select) return;
    for (let i = 0; i < 40; i++) {
      const option = [...select.options].find(o => o.textContent.trim() === String(label).trim());
      if (option) {
        if (select.value !== option.value) {
          destructiveSaveGuardUntil = Date.now() + 5000;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(520);
        }
        return;
      }
      await sleep(90);
    }
  }

  async function moveToEpisode(index) {
    const rows = $$('.episode-row');
    if (!rows.length) return false;
    const target = Math.max(0, Math.min(rows.length - 1, Number(index) || 0));
    if (currentEpisodeIndex() !== target) {
      destructiveSaveGuardUntil = Date.now() + 6500;
      rows[target].click();
      $('#yumeVideo')?.pause();
      await sleep(650);
    }
    return true;
  }

  async function restoreState(item, autoplay = true) {
    if (!item || syncing) return false;
    syncing = true;
    destructiveSaveGuardUntil = Date.now() + 9000;
    try {
      let index = Math.max(0, Number(item.episodeIndex || 0));
      const rows = $$('.episode-row');
      if (item.completed && index < rows.length - 1) index += 1;
      await moveToEpisode(index);
      const video = $('#yumeVideo');
      video?.pause();
      if (item.quality) await applyQuality(item.quality);
      const target = item.completed && index !== Number(item.episodeIndex || 0) ? 0 : Number(item.position || 0);
      const ok = await seekRobust(target, autoplay);
      if (ok && target > 2) resumeBackup = { ...item, episodeIndex: index, position: target, updatedAt: Date.now() };
      return ok;
    } finally {
      syncing = false;
    }
  }

  function parseHintFallback(hint) {
    const text = String(hint?.textContent || '');
    const episode = Number(text.match(/серия\s+(\d+)/i)?.[1] || 1);
    const time = text.match(/(?:с|с:)\s*(?:(\d+):)?(\d+):(\d+)/i);
    if (!time) return null;
    const h = Number(time[1] || 0), m = Number(time[2] || 0), s = Number(time[3] || 0);
    return { episodeIndex: Math.max(0, episode - 1), position: h * 3600 + m * 60 + s, quality: $('#qualitySelect')?.selectedOptions?.[0]?.textContent?.trim() || '', completed: false, updatedAt: Date.now() };
  }

  function initResume() {
    if (window.__YUME_RESUME_CAPTURE) return;
    window.__YUME_RESUME_CAPTURE = true;
    document.addEventListener('click', async event => {
      const hint = event.target.closest('#resumeHint');
      if (!hint) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      let item = await readResume();
      const parsed = parseHintFallback(hint);
      if (parsed && (!item || Number(parsed.position) > Number(item.position || 0))) item = { ...(item || {}), ...parsed };
      if (!item) return;
      await restoreState(item, true);
      hint.classList.add('hidden');
      $('#watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, true);
  }

  async function syncGuest(remote) {
    if (!remote || syncing) return;
    syncing = true;
    destructiveSaveGuardUntil = Date.now() + 4000;
    try {
      await moveToEpisode(remote.episodeIndex || 0);
      if (remote.quality) await applyQuality(remote.quality);
      const video = $('#yumeVideo');
      if (!video) return;
      await waitForVideoReady(video, 6000);
      const drift = Math.abs(Number(video.currentTime || 0) - Number(remote.position || 0));
      if (drift > 1.1) await seekRobust(remote.position || 0, false);
      if (remote.playing && video.paused) await video.play().catch(() => {});
      if (!remote.playing && !video.paused) video.pause();
      let badge = $('#partySyncStatus');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'partySyncStatus';
        badge.className = 'party-sync-status';
        $('.now-playing-bar')?.insertAdjacentElement('afterend', badge);
      }
      badge.textContent = `● Синхронизация комнаты ${guestRoom}`;
      badge.classList.remove('error');
    } finally {
      syncing = false;
    }
  }

  async function pollRoom() {
    if (!guestRoom || !feature) return;
    try {
      const room = await feature('party', { method: 'GET', headers: {} }, { room: guestRoom });
      const currentAlias = new URL(location.href).searchParams.get('alias') || initialAlias || '';
      const wantedAlias = room?.anime?.alias || '';
      if (wantedAlias && currentAlias && wantedAlias !== currentAlias) {
        const url = new URL('/anime', location.origin);
        url.searchParams.set('alias', wantedAlias);
        url.searchParams.set('party', guestRoom);
        url.hash = 'watch';
        location.replace(url.toString());
        return;
      }
      await syncGuest(room.state);
    } catch (error) {
      clearInterval(guestTimer);
      let badge = $('#partySyncStatus');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'partySyncStatus';
        badge.className = 'party-sync-status error';
        $('.now-playing-bar')?.insertAdjacentElement('afterend', badge);
      }
      badge.textContent = `Комната ${guestRoom} недоступна`;
      badge.classList.add('error');
    }
  }

  async function initPartyGuest() {
    let code = initialPartyCode;
    if (!code) {
      try { code = String(sessionStorage.getItem('yume-pending-party') || ''); } catch {}
    }
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,12);
    if (!code) return;
    guestRoom = code;
    try { sessionStorage.setItem('yume-pending-party', code); } catch {}
    for (let i = 0; i < 80 && !$('.episode-row'); i++) await sleep(100);

    // watch-enhancements may show a confirmation modal. Joining from a share link is intentional,
    // so close it and start synchronization immediately.
    $('#yumePartyModal')?.classList.add('hidden');
    await pollRoom();
    clearInterval(guestTimer);
    guestTimer = setInterval(() => { if (document.visibilityState === 'visible') pollRoom(); }, 650);
    $('#watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  initResume();

  async function boot() {
    for (let i = 0; i < 100 && !$('#yumePlayer'); i++) await sleep(100);
    if (!$('#yumePlayer')) return;
    setTimeout(initPartyGuest, 450);
  }

  boot();
})();