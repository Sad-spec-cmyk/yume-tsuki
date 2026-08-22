window.YUME_CONFIG = {
  // Основной и резервный адреса публичного AniLiberty API v1.
  // AniLiberty больше не является единственным каталогом: federated runtime ниже добавляет Jikan + Shikimori.
  ANILIBERTY_API_BASES: [
    "https://api.anilibria.app/api/v1",
    "https://aniliberty.top/api/v1"
  ],

  // AniLiberty часто возвращает poster.src как относительный путь.
  ANILIBERTY_IMAGE_BASES: [
    "https://static.wwnd.space",
    "https://cdn.anilibria.top",
    "https://aniliberty.top",
    "https://api.anilibria.app"
  ]
};

(() => {
  // One real site icon everywhere. Remove the old assistant-made moon favicon and bust browser cache.
  document.querySelectorAll('link[rel~="icon"]').forEach(x => x.remove());
  const svg = document.createElement('link');
  svg.rel = 'icon'; svg.type = 'image/svg+xml'; svg.href = '/favicon.svg?v=16';
  document.head.appendChild(svg);

  // This must execute before app.js / browse.js / anime.js so their old AniLiberty calls become federated calls.
  if (!window.__YUME_FEDERATED_CATALOG_V16) {
    if (document.readyState === 'loading') {
      document.write('<script src="/federated-catalog-v16.js?v=16"><\/script>');
    } else {
      const script = document.createElement('script');
      script.src = '/federated-catalog-v16.js?v=16';
      document.head.appendChild(script);
    }
  }
})();
