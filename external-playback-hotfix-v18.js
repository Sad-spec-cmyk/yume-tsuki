(() => {
  if (window.__YUME_EXTERNAL_PLAYBACK_FIX_V18) return;
  window.__YUME_EXTERNAL_PLAYBACK_FIX_V18 = true;

  const $ = selector => document.querySelector(selector);

  function episodeNumber() {
    const direct = Number(window.YUME_NOW_PLAYING?.episodeNumber || 0);
    if (direct > 0) return direct;
    const badge = $('#currentEpisodeBadge')?.textContent || '';
    const parsed = Number(badge.match(/\d+(?:\.\d+)?/)?.[0] || 0);
    return parsed > 0 ? parsed : 1;
  }

  function providerName() {
    const value = String(window.YUME_ACTIVE_PROVIDER?.name || $('#currentQualityBadge')?.textContent || '').trim();
    return value === '—' ? '' : value;
  }

  function clearFalseUnavailable(video) {
    if (!video || video.id !== 'yumeExternalVideo' || video.error) return;
    const hasSource = Boolean(video.currentSrc || video.src || video.querySelector?.('source')?.src);
    if (!hasSource && video.readyState === 0) return;

    const message = $('#playerMessage');
    if (message) {
      message.classList.add('hidden');
      message.innerHTML = '';
    }

    const ep = episodeNumber();
    if ($('#currentEpisodeBadge')) $('#currentEpisodeBadge').textContent = `Серия ${ep}`;
    if (window.YUME_NOW_PLAYING) {
      window.YUME_NOW_PLAYING.episodeNumber = ep;
      window.YUME_NOW_PLAYING.episode = window.YUME_NOW_PLAYING.episode || `Серия ${ep}`;
    }

    const provider = providerName();
    if ($('#playerStatus')) $('#playerStatus').textContent = `Серия ${ep}${provider ? ` · ${provider}` : ''}`;
    if ($('#nowPlayingTitle') && /выберите серию/i.test($('#nowPlayingTitle').textContent || '')) $('#nowPlayingTitle').textContent = `Серия ${ep}`;
  }

  ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'play', 'timeupdate'].forEach(type => {
    document.addEventListener(type, event => {
      if (event.target?.id === 'yumeExternalVideo') clearFalseUnavailable(event.target);
    }, true);
  });

  const player = $('#yumePlayer');
  if (player) {
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.id === 'yumeExternalVideo') {
            clearFalseUnavailable(node);
            return;
          }
        }
      }
    }).observe(player, { childList:true });
  }

  const existing = $('#yumeExternalVideo');
  if (existing) clearFalseUnavailable(existing);
})();
