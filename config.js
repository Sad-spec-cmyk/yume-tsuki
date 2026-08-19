window.YUME_CONFIG = {
  // Основной и резервный адреса публичного AniLiberty API v1.
  // На Netlify запросы JSON автоматически проходят через serverless proxy.
  ANILIBERTY_API_BASES: [
    "https://api.anilibria.app/api/v1",
    "https://aniliberty.top/api/v1"
  ],

  // AniLiberty часто возвращает poster.src как относительный путь.
  // Официальные клиенты дописывают к нему отдельный baseImages URL.
  ANILIBERTY_IMAGE_BASES: [
    "https://static.wwnd.space",
    "https://cdn.anilibria.top",
    "https://anilibria.top",
    "https://api.anilibria.app"
  ]
};
