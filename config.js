window.YUME_CONFIG = {
  ANILIBERTY_API_BASES: [
    "https://api.anilibria.app/api/v1",
    "https://aniliberty.top/api/v1"
  ],
  ANILIBERTY_IMAGE_BASES: [
    "https://static.wwnd.space",
    "https://cdn.anilibria.top",
    "https://aniliberty.top",
    "https://api.anilibria.app"
  ]
};

(() => {
  // Exact crescent icon supplied for Yume Tsuki.
  document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]').forEach(node => node.remove());
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.type = 'image/png';
  icon.sizes = '64x64';
  icon.href = '/favicon.png?v=18';
  document.head.appendChild(icon);

  const shortcut = document.createElement('link');
  shortcut.rel = 'shortcut icon';
  shortcut.type = 'image/x-icon';
  shortcut.href = '/favicon.ico?v=18';
  document.head.appendChild(shortcut);

  if (!window.__YUME_FEDERATED_CATALOG_V16) {
    if (document.readyState === 'loading') {
      document.write('<script src="/federated-catalog-v16.js?v=18"><\/script>');
    } else {
      const script = document.createElement('script');
      script.src = '/federated-catalog-v16.js?v=18';
      document.head.appendChild(script);
    }
  }

  // The native AniLiberty renderer can show “Видео недоступно” before an external
  // AnimeVost/Yummy/Kodik stream connects. Remove that stale overlay after real playback starts.
  if (document.body?.dataset?.page === 'anime' && !window.__YUME_EXTERNAL_PLAYBACK_FIX_V18) {
    const fix = document.createElement('script');
    fix.src = '/external-playback-hotfix-v18.js?v=18';
    document.head.appendChild(fix);
  }
})();
