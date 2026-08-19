# Yume Tsuki

Русскоязычный аниме-каталог и плеер на AniLiberty API.

- Каталог, поиск и карточки релизов через AniLiberty API v1.
- Netlify Function `netlify/functions/aniliberty.mjs` проксирует API-запросы.
- Постеры с относительными URL автоматически получают image CDN base.
- HLS-плеер использует `hls_1080`, `hls_720`, `hls_480`.

## Netlify

`netlify.toml` настроен на публикацию корня проекта и функции из `netlify/functions`.
