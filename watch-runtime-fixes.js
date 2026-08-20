(() => {
  if (window.__YUME_RUNTIME_FIXES) return;
  window.__YUME_RUNTIME_FIXES = true;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const feature = (...args) => window.YUME_ACCOUNT?.feature?.(...args);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let guestRoom = '';
  let guestTimer = 0;
  let syncing = false;

  function currentKey() {
    const u = new URL(location.href);
    return u.searchParams.get('alias') || window.YUME_NOW_PLAYING?.alias || window.YUME_NOW_PLAYING?.animeId || window.YUME_NOW_PLAYING?.title || '';
  }
  function resumeKey() { return `yume-resume:${String(currentKey()).trim().toLowerCase()}`; }
  function currentEpisodeIndex() {
    const active = $('.episode-row.active');
    return active ? Number(active.dataset.index || 0) : 0;
  }

  async function readResume() {
    let local = null, remote = null;
    try { local = JSON.parse(localStorage.getItem(resumeKey()) || 'null'); } catch {}
    if (window.YUME_ACCOUNT?.user && feature) {
      try { remote = (await feature('resume', { method: 'GET', headers: {} }, { key: currentKey() })).item || null; } catch {}
    }
    return [local, remote].filter(Boolean).sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
  }

  async function waitForVideoReady(video, timeout = 9000) {
    if (!video) return false;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (video.readyState >= 1 && (Number.isFinite(video.duration) || video.seekable?.length)) return true;
      await sleep(120);
    }
    return false;
  }

  function maxSeekable(video) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    if (video.seekable?.length) return video.seekable.end(video.seekable.length - 1);
    return 0;
  }

  async function seekRobust(position, autoplay) {
    const video = $('#yumeVideo');
    if (!video) return false;
    const target = Math.max(0, Number(position) || 0);
    await waitForVideoReady(video);
    for (let i = 0; i < 30; i++) {
      const max = maxSeekable(video);
      if (max > 0) {
        const desired = Math.min(target, Math.max(0, max - .6));
        try { video.currentTime = desired; } catch {}
        await sleep(100);
        if (Math.abs(Number(video.currentTime || 0) - desired) < 1.25) {
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
    for (let i = 0; i < 35; i++) {
      const option = [...select.options].find(o => o.textContent.trim() === String(label).trim());
      if (option) {
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(450);
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
      rows[target].click();
      $('#yumeVideo')?.pause();
      await sleep(520);
    }
    return true;
  }

  async function restoreState(item, autoplay = true) {
    if (!item || syncing) return;
    syncing = true;
    try {
      let index = Math.max(0, Number(item.episodeIndex || 0));
      const rows = $$('.episode-row');
      if (item.completed && index < rows.length - 1) index += 1;
      await moveToEpisode(index);
      const video = $('#yumeVideo');
      video?.pause();
      if (item.quality) await applyQuality(item.quality);
      await seekRobust(item.completed && index !== Number(item.episodeIndex || 0) ? 0 : Number(item.position || 0), autoplay);
    } finally {
      syncing = false;
    }
  }

  function initResume() {
    if (window.__YUME_RESUME_CAPTURE) return;
    window.__YUME_RESUME_CAPTURE = true;
    document.addEventListener('click', async event => {
      const hint = event.target.closest('#resumeHint');
      if (!hint) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const item = await readResume();
      if (!item) return;
      await restoreState(item, true);
      hint.classList.add('hidden');
      $('#watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, true);
  }

  async function syncGuest(remote) {
    if (!remote || syncing) return;
    syncing = true;
    try {
      await moveToEpisode(remote.episodeIndex || 0);
      if (remote.quality) await applyQuality(remote.quality);
      const video = $('#yumeVideo');
      if (!video) return;
      await waitForVideoReady(video, 5000);
      const drift = Math.abs(Number(video.currentTime || 0) - Number(remote.position || 0));
      if (drift > 1.4) await seekRobust(remote.position || 0, false);
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
    } finally {
      syncing = false;
    }
  }

  async function pollRoom() {
    if (!guestRoom || !feature) return;
    try {
      const room = await feature('party', { method: 'GET', headers: {} }, { room: guestRoom });
      const currentAlias = new URL(location.href).searchParams.get('alias') || '';
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
    } catch {
      clearInterval(guestTimer);
      const badge = $('#partySyncStatus');
      if (badge) badge.textContent = 'Комната недоступна';
    }
  }

  async function initPartyGuest() {
    const code = String(new URL(location.href).searchParams.get('party') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,12);
    if (!code) return;
    guestRoom = code;
    for (let i = 0; i < 60 && !$('.episode-row'); i++) await sleep(100);
    const join = $('#partyJoinBtn');
    if (join) {
      join.click();
      await sleep(180);
    }
    $('#yumePartyModal')?.classList.add('hidden');
    await pollRoom();
    clearInterval(guestTimer);
    guestTimer = setInterval(() => { if (document.visibilityState === 'visible') pollRoom(); }, 800);
    $('#watch')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  initResume();

  async function boot() {
    for (let i = 0; i < 80 && !$('#yumePlayer'); i++) await sleep(100);
    if (!$('#yumePlayer')) return;
    setTimeout(initPartyGuest, 500);
  }

  boot();
})();