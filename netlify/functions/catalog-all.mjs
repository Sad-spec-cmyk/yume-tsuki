const UA = 'YumeTsuki/1.0 (playable federated catalog)';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=90, stale-while-revalidate=300',
  },
});

const env = name => {
  try { return String(Netlify.env.get(name) || '').trim(); }
  catch { return String(process.env?.[name] || '').trim(); }
};

const first = (...values) => values.map(v => String(v ?? '').trim()).find(Boolean) || '';
const list = value => Array.isArray(value) ? value : [];

function absoluteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

async function yummy(path, params, token) {
  const url = new URL(`https://api.yani.tv${path}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: {
      'X-Application': token,
      'Accept': 'application/json,image/avif,image/webp',
      'Accept-Language': 'ru',
      'Lang': 'ru',
      'Vary': 'json',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`YummyAnime ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload?.error_title || payload?.error || 'YummyAnime API error');
  return payload?.response ?? payload?.data ?? payload?.results ?? payload;
}

function statusText(item) {
  return first(item?.anime_status?.alias, item?.anime_status?.title, item?.status?.alias, item?.status?.title, item?.status);
}

function airedEpisodes(item) {
  const aired = Number(item?.episodes?.aired ?? item?.episodes_aired ?? item?.episodesAired ?? 0);
  return Number.isFinite(aired) && aired > 0 ? aired : 0;
}

function totalEpisodes(item) {
  const total = Number(item?.episodes?.count ?? item?.episodes_count ?? item?.episodesCount ?? 0);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function isPlayableCandidate(item) {
  const year = Number(item?.year || 0);
  const currentYear = new Date().getFullYear();
  if (year && year > currentYear) return false;

  const status = statusText(item).toLowerCase();
  if (/anons|announce|анонс|запланирован|not.yet|upcoming/.test(status)) return false;

  // YummyAnime is used here specifically because it is one of our playback providers.
  // Avoid filling the streaming catalogue with metadata-only future/empty records.
  const aired = airedEpisodes(item);
  const videos = Array.isArray(item?.videos) ? item.videos.length : 0;
  if (!aired && !videos && status && /ongoing|released|completed|finished|выходит|заверш/.test(status) === false) return false;
  return true;
}

function posterOf(item) {
  const poster = item?.poster || {};
  return absoluteUrl(first(
    poster?.huge,
    poster?.big,
    poster?.fullsize,
    poster?.medium,
    poster?.small,
    typeof poster === 'string' ? poster : ''
  ));
}

function typeOf(item) {
  const type = item?.type;
  if (typeof type === 'string') return type;
  return first(type?.title, type?.alias, type?.description, type?.value, 'Аниме');
}

function ageOf(item) {
  const age = item?.min_age || item?.minAge || {};
  const value = first(age?.titleLong, age?.title, age?.value);
  return value ? { label: value } : null;
}

function mapItem(item) {
  const title = first(item?.title, item?.name);
  const otherTitles = list(item?.other_titles).map(String).filter(Boolean);
  const aired = airedEpisodes(item);
  const total = totalEpisodes(item);
  return {
    id: `federated-yummy-${item?.anime_id ?? item?.id ?? encodeURIComponent(title)}`,
    _federated: true,
    source: 'YummyAnime',
    external_id: item?.anime_id ?? item?.id ?? null,
    name: {
      main: title,
      english: first(item?.original, otherTitles[0]),
      alternative: first(otherTitles[0], item?.original),
    },
    title,
    year: Number(item?.year || 0) || '',
    type: { description: typeOf(item) },
    poster: { src: posterOf(item) },
    description: first(item?.description, 'Описание отсутствует.'),
    genres: list(item?.genres).map(g => ({ name: first(g?.title, g?.name, g) })).filter(g => g.name),
    episodes_total: aired || total || null,
    added_in_users_favorites: Number(item?.views || item?.rating?.counters || 0) || null,
    is_ongoing: /ongoing|выходит|airing/i.test(statusText(item)),
    age_rating: ageOf(item),
    episodes: [],
    yummy: {
      animeId: item?.anime_id ?? item?.id ?? null,
      aired,
      total,
    },
  };
}

export default async request => {
  const url = new URL(request.url);
  const q = first(url.searchParams.get('q'), url.searchParams.get('search'));
  const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
  const requestedLimit = Math.max(1, Math.min(72, Number(url.searchParams.get('limit') || 36) || 36));
  const token = env('YUMMY_TOKEN') || env('YUMMY_APPLICATION_TOKEN');

  // Important: no metadata-only fallback here. If YummyAnime is not configured,
  // AniLiberty stays as the catalogue instead of injecting unplayable Jikan/Shikimori cards.
  if (!token) return json({ ok: true, items: [], sources: [], reason: 'YUMMY_TOKEN not configured' });

  try {
    const offset = (page - 1) * requestedLimit;
    const raw = q
      ? await yummy('/search', { q, limit: requestedLimit, offset }, token)
      : await yummy('/anime', { limit: requestedLimit, offset }, token);

    const rows = (Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [])
      .filter(isPlayableCandidate)
      .map(mapItem)
      .filter(item => item.name.main);

    return json({ ok: true, items: rows, sources: ['YummyAnime'], page, q, count: rows.length });
  } catch (error) {
    console.error('catalog-all', error);
    // Do not break native AniLiberty catalogue when the extra source is temporarily down.
    return json({ ok: true, items: [], sources: [], error: String(error?.message || error) });
  }
};
