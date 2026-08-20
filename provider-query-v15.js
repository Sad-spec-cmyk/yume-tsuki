(() => {
  if (window.__YUME_PROVIDER_QUERY_V15) return;
  window.__YUME_PROVIDER_QUERY_V15 = true;

  let lastProviderName = '';
  const nativeFetch = window.fetch.bind(window);

  const episode = () => {
    const direct = window.YUME_NOW_PLAYING?.episodeNumber;
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();
    return (document.querySelector('#currentEpisodeBadge')?.textContent || '').match(/\d+(?:\.\d+)?/)?.[0] || '1';
  };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('.provider-choice');
    if (!button || button.dataset.provider === 'aniliberty') return;
    const raw = button.querySelector('b')?.textContent || button.textContent || '';
    lastProviderName = String(raw).replace(/[▶↗]/g, '').trim();

    // If a source really fails after all direct resolvers, do not leave a wall of red dead rows.
    setTimeout(() => {
      if (button.isConnected && button.classList.contains('provider-failed')) button.remove();
      const groups = [...document.querySelectorAll('.provider-result-group')];
      for (const group of groups) {
        const rows = group.querySelectorAll('.provider-choice');
        const count = group.querySelector(':scope > div span:last-child');
        if (count) count.textContent = String(rows.length);
        if (!rows.length) group.remove();
      }
    }, 16000);
  }, true);

  window.fetch = (input, init) => {
    try {
      const raw = typeof input === 'string' ? input : input?.url || '';
      if (String(raw).includes('/.netlify/functions/resolve-yummy?')) {
        const url = new URL(raw, location.origin);
        if (lastProviderName && !url.searchParams.has('name')) url.searchParams.set('name', lastProviderName);
        if (!url.searchParams.has('episode')) url.searchParams.set('episode', episode());
        url.searchParams.set('_v', '15');
        if (typeof input === 'string') return nativeFetch(url.toString(), init);
        return nativeFetch(new Request(url.toString(), input), init);
      }
    } catch {}
    return nativeFetch(input, init);
  };
})();
