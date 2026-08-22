const UA = 'YumeTsuki/1.0 (playable multi-source schedule)';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=120, stale-while-revalidate=300',
  },
});

const env = name => {
  try { return String(Netlify.env.get(name) || '').trim(); }
  catch { return String(process.env?.[name] || '').trim(); }
};
const text = value => String(value ?? '').trim();
const first = (...values) => values.map(text).find(Boolean) || '';
const unique = values => [...new Set((values || []).map(text).filter(Boolean))];
const norm = value => text(value).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();

function fullUrl(raw, base = '') {
  const value = text(raw);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (!base) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}

async function fetchJson(url, options = {}, timeout = 10000) {
  const response = await fetch(url, {
    ...options,
    headers: { 'User-Agent': UA, Accept:'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} ${response.status}`);
  return response.json();
}

async function aniliberty(path, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  });
  const suffix = `${path}${params.size ? `?${params}` : ''}`;
  const bases = ['https://api.anilibria.app/api/v1', 'https://aniliberty.top/api/v1'];
  let lastError = null;
  for (const base of bases) {
    try { return await fetchJson(`${base}${suffix}`); }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('AniLiberty unavailable');
}

function aniTitle(item) {
  const a = item?.release || item || {};
  return first(a?.name?.main, a?.name?.english, a?.names?.ru, a?.names?.en, a?.title);
}
function aniPoster(item) {
  const a = item?.release || item || {};
  const p = a?.poster;
  const raw = typeof p === 'string' ? p : first(p?.src, p?.preview, p?.optimized?.preview, p?.thumbnail, p?.original);
  return fullUrl(raw, 'https://static.wwnd.space/');
}
function aniHref(item) {
  const a = item?.release || item || {};
  const alias = first(a?.alias);
  return alias ? `/anime?alias=${encodeURIComponent(alias)}` : `/anime?q=${encodeURIComponent(aniTitle(a))}`;
}

async function collectAniLiberty() {
  const items = [];
  const diagnostics = { ok:false, exact:0, recurring:0, error:'' };
  try {
    const [nowData, catalogData] = await Promise.all([
      aniliberty('/anime/schedule/now').catch(() => ({})),
      aniliberty('/anime/catalog/releases', {
        limit: 100,
        'f[production_statuses]': 'IS_IN_PRODUCTION',
        'f[sorting]': 'FRESH_AT_DESC',
      }).catch(() => ({ data:[] })),
    ]);

    for (const [relativeDay, rows] of [[0, nowData?.today], [1, nowData?.tomorrow]]) {
      for (const raw of Array.isArray(rows) ? rows : []) {
        const title = aniTitle(raw);
        if (!title) continue;
        const a = raw?.release || raw || {};
        items.push({
          title,
          poster: aniPoster(raw),
          href: aniHref(raw),
          nextEpisode: raw?.next_release_episode_number ?? a?.next_release_episode_number ?? '',
          relativeDay,
          exact: true,
          source: 'AniLiberty',
        });
        diagnostics.exact++;
      }
    }

    const rows = Array.isArray(catalogData) ? catalogData : (catalogData?.data || catalogData?.items || []);
    for (const a of rows) {
      const title = aniTitle(a);
      if (!title || !a?.publish_day) continue;
      const published = Number(a?.published_release_episode?.ordinal || 0);
      items.push({
        title,
        poster: aniPoster(a),
        href: aniHref(a),
        nextEpisode: a?.next_release_episode_number || (published ? published + 1 : ''),
        weekday: a?.publish_day?.value ?? a?.publish_day?.description ?? a?.publish_day,
        exact: false,
        source: 'AniLiberty',
      });
      diagnostics.recurring++;
    }
    diagnostics.ok = true;
  } catch (error) {
    diagnostics.error = String(error?.message || error);
  }
  return { items, diagnostics };
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

function yummyPoster(item) {
  const p = item?.poster || {};
  return fullUrl(first(p?.huge, p?.big, p?.fullsize, p?.medium, p?.small, typeof p === 'string' ? p : ''));
}

function timestampToIso(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /[T:-]/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  const millis = number < 1e12 ? number * 1000 : number;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function collectYummy() {
  const token = env('YUMMY_TOKEN') || env('YUMMY_APPLICATION_TOKEN');
  const diagnostics = { ok:false, count:0, configured:!!token, error:'' };
  if (!token) return { items:[], diagnostics };
  const items = [];
  try {
    const raw = await yummy('/anime/schedule', {}, token);
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
    const now = Date.now();
    const horizon = now + 8 * 24 * 60 * 60 * 1000;

    for (const item of rows) {
      const title = first(item?.title, item?.name);
      const nextAt = timestampToIso(item?.episodes?.next_date ?? item?.next_date ?? item?.nextDate);
      if (!title || !nextAt) continue;
      const at = new Date(nextAt).getTime();
      if (!Number.isFinite(at) || at < now - 12 * 60 * 60 * 1000 || at > horizon) continue;
      const aired = Number(item?.episodes?.aired ?? item?.episodes_aired ?? 0);
      items.push({
        title,
        poster: yummyPoster(item),
        href: `/anime?q=${encodeURIComponent(title)}`,
        nextEpisode: Number.isFinite(aired) && aired >= 0 ? aired + 1 : '',
        nextAt,
        exact: true,
        source: 'YummyAnime',
      });
      diagnostics.count++;
    }
    diagnostics.ok = true;
  } catch (error) {
    diagnostics.error = String(error?.message || error);
  }
  return { items, diagnostics };
}

function mergeItems(groups) {
  const byDayTitle = new Map();
  for (const item of groups.flat()) {
    if (!item?.title) continue;
    // Keep separate dates, but merge duplicate providers for the same title/time/day.
    const dateKey = item.nextAt ? item.nextAt.slice(0, 10) : `relative:${item.relativeDay ?? ''}:weekday:${item.weekday ?? ''}`;
    const key = `${norm(item.title)}|${dateKey}`;
    if (!byDayTitle.has(key)) {
      byDayTitle.set(key, { ...item, sources:[item.source].filter(Boolean) });
      continue;
    }
    const current = byDayTitle.get(key);
    const episodeA = Number(current.nextEpisode || 0);
    const episodeB = Number(item.nextEpisode || 0);
    current.nextEpisode = Math.max(episodeA || 0, episodeB || 0) || current.nextEpisode || item.nextEpisode || '';
    current.sources = unique([...(current.sources || []), item.source]);
    current.source = current.sources.join(' + ');
    if (!current.poster && item.poster) current.poster = item.poster;
    if (!current.nextAt && item.nextAt) current.nextAt = item.nextAt;
    current.exact = current.exact || item.exact;
  }
  return [...byDayTitle.values()];
}

export default async () => {
  const [ani, yummySource] = await Promise.all([collectAniLiberty(), collectYummy()]);
  const items = mergeItems([ani.items, yummySource.items]);
  if (!items.length) {
    return json({
      error: 'Все источники расписания временно недоступны.',
      items: [],
      diagnostics: { aniliberty:ani.diagnostics, yummy:yummySource.diagnostics },
    }, 502);
  }

  return json({
    ok: true,
    items,
    sources: unique(items.flatMap(item => item.sources || [item.source])),
    diagnostics: { aniliberty:ani.diagnostics, yummy:yummySource.diagnostics },
  });
};
