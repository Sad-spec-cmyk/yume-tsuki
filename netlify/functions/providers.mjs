function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120, stale-while-revalidate=600' },
  });
}

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[’'`]/g, '')
  .replace(/[^a-zа-я0-9]+/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const tokens = value => new Set(normalize(value).split(' ').filter(x => x.length > 1));
const unique = values => [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))];
const playerUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
};
const safeFetch = (url, options = {}, timeout = 9000) => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });

function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.max(1, Math.min(A.size, B.size));
}

async function discoverPublicToken() {
  const configured = Netlify.env.get('KODIK_TOKEN');
  if (configured) return configured;
  for (const url of ['https://kodik-add.com/add-players.min.js?v=2', 'https://kodik-add.com/add-players.min.js']) {
    try {
      const response = await safeFetch(url, {
        headers: { accept: 'text/javascript,*/*;q=0.8', 'user-agent': 'YumeTsuki/1.0' },
      }, 7000);
      if (!response.ok) continue;
      const script = await response.text();
      const token = script.match(/token\s*[=:]\s*["']([0-9a-f]+)["']/i)?.[1]
        || script.match(/["']token["']\s*:\s*["']([0-9a-f]+)["']/i)?.[1];
      if (token) return token;
    } catch {}
  }
  throw new Error('Kodik token unavailable');
}

async function enrichWithJikan(query) {
  try {
    const url = new URL('https://api.jikan.moe/v4/anime');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '5');
    const r = await safeFetch(url, { headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0' } }, 8000);
    if (!r.ok) return [];
    const data = await r.json();
    const out = [];
    for (const item of Array.isArray(data?.data) ? data.data : []) {
      out.push(item?.title, item?.title_english, item?.title_japanese);
      for (const t of item?.titles || []) out.push(t?.title);
      for (const s of item?.title_synonyms || []) out.push(s);
    }
    return unique(out);
  } catch { return []; }
}

async function enrichWithShikimori(query) {
  try {
    const url = new URL('https://shikimori.one/api/animes');
    url.searchParams.set('search', query);
    url.searchParams.set('limit', '5');
    const r = await safeFetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0 (anime catalogue)' },
    }, 8000);
    if (!r.ok) return { titles: [], ids: [] };
    const data = await r.json();
    const titles = [], ids = [];
    for (const item of Array.isArray(data) ? data : []) {
      titles.push(item?.name, item?.russian);
      if (item?.id) ids.push(String(item.id));
    }
    return { titles: unique(titles), ids: unique(ids) };
  } catch { return { titles: [], ids: [] }; }
}

async function buildSearchContext(primary, alternates = []) {
  const seeds = unique([primary, ...alternates]).slice(0, 5);
  const [jikan, shiki] = await Promise.all([
    enrichWithJikan(seeds[0] || primary),
    enrichWithShikimori(seeds[0] || primary),
  ]);
  const variants = unique([...seeds, ...jikan, ...shiki.titles]);
  variants.sort((a, b) => {
    const ar = /[а-яё]/i.test(a) ? 0 : 1;
    const br = /[а-яё]/i.test(b) ? 0 : 1;
    return ar - br || a.length - b.length;
  });
  return { variants: variants.slice(0, 15), shikimoriIds: shiki.ids.slice(0, 5) };
}

async function kodikRequest(token, params) {
  params.set('token', token);
  params.set('limit', '100');
  params.set('with_material_data', 'true');
  params.set('translation_type', 'voice');
  params.set('prioritize_translation_type', 'voice');
  const response = await safeFetch(`https://kodik-api.com/search?${params}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0' },
  }, 12000);
  if (!response.ok) throw new Error(`Kodik API ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function kodikByTitle(token, query, year) {
  const params = new URLSearchParams({ title: query, strict: 'false' });
  if (/^\d{4}$/.test(String(year || ''))) params.set('year', String(year));
  return kodikRequest(token, params);
}
async function kodikByShikimori(token, id) {
  return kodikRequest(token, new URLSearchParams({ shikimori_id: String(id) }));
}

function itemTitles(item) {
  return unique([
    item?.title,
    item?.title_orig,
    item?.other_title,
    item?.material_data?.title,
    item?.material_data?.title_en,
    item?.material_data?.anime_title,
    item?.material_data?.anime_title_english,
    ...(Array.isArray(item?.material_data?.anime_other_titles) ? item.material_data.anime_other_titles : []),
  ]);
}

function acceptItem(item, variants, year, shikimoriIds) {
  const itemShiki = String(item?.shikimori_id || item?.material_data?.shikimori_id || '');
  if (itemShiki && shikimoriIds.includes(itemShiki)) return true;
  const titles = itemTitles(item);
  const yearOk = !year || !item?.year || String(item.year) === String(year);
  if (!yearOk) return false;
  let best = 0;
  for (const a of variants) for (const b of titles) best = Math.max(best, similarity(a, b));
  if (best >= .42) return true;
  const normalizedVariants = variants.map(normalize);
  return titles.some(t => normalizedVariants.some(v => normalize(t) === v || normalize(t).includes(v) || v.includes(normalize(t))));
}

function toProviders(items, variants, year, shikimoriIds) {
  const seen = new Set(), providers = [];
  for (const item of items) {
    if (!acceptItem(item, variants, year, shikimoriIds)) continue;
    const link = playerUrl(item?.link);
    if (!link) continue;
    const translation = item?.translation || {};
    const type = String(translation?.type || '').toLowerCase();
    if (type && type !== 'voice') continue;
    const name = String(translation?.title || 'Kodik').trim();
    const id = String(translation?.id || `${name}-${item?.id || providers.length + 1}`);
    const key = `${id}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push({
      id: `kodik-${id}`,
      source: 'Kodik',
      name,
      translationType: type || 'voice',
      link,
      quality: item?.quality || '',
      year: item?.year || '',
      serial: String(item?.type || '').includes('serial'),
      lastSeason: item?.last_season || null,
      lastEpisode: item?.last_episode || null,
    });
    if (providers.length >= 40) break;
  }
  return providers;
}

async function kodikSearch(primary, alternates, year) {
  const token = await discoverPublicToken();
  const { variants, shikimoriIds } = await buildSearchContext(primary, alternates);
  const all = [], errors = [];

  // ID lookup is the most reliable way to avoid a different anime with a similar translated name.
  for (const id of shikimoriIds.slice(0, 3)) {
    try {
      const items = await kodikByShikimori(token, id);
      all.push(...items);
      if (items.length >= 4) break;
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  if (toProviders(all, variants, year, shikimoriIds).length < 2) {
    for (const query of variants.slice(0, 8)) {
      try {
        const items = await kodikByTitle(token, query, year);
        all.push(...items);
        if (toProviders(all, variants, year, shikimoriIds).length >= 8) break;
      } catch (e) { errors.push(String(e?.message || e)); }
    }
  }

  let providers = toProviders(all, variants, year, shikimoriIds);
  // Some databases attach a slightly different release year. Retry without year rather than hiding valid dubs.
  if (!providers.length && year) {
    for (const query of variants.slice(0, 5)) {
      try { all.push(...await kodikByTitle(token, query, '')); } catch (e) { errors.push(String(e?.message || e)); }
    }
    providers = toProviders(all, variants, '', shikimoriIds);
  }
  return { providers, variants, shikimoriIds, errors };
}

export default async request => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const title = String(url.searchParams.get('title') || '').trim().slice(0, 180);
  const year = String(url.searchParams.get('year') || '').trim().slice(0, 8);
  const alternates = String(url.searchParams.get('titles') || '')
    .split('|')
    .map(x => x.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!title) return json({ error: 'Не указано название аниме.' }, 400);

  try {
    const kodik = await kodikSearch(title, alternates, year);
    return json({
      providers: kodik.providers,
      count: kodik.providers.length,
      playbackSources: ['AniLiberty', 'Kodik'],
      metadataSources: ['Jikan', 'Shikimori'],
      matchedTitles: kodik.variants,
      shikimoriIds: kodik.shikimoriIds,
      errors: kodik.errors.slice(0, 3),
    });
  } catch (error) {
    console.error('providers', error);
    return json({
      providers: [],
      count: 0,
      playbackSources: ['AniLiberty', 'Kodik'],
      metadataSources: ['Jikan', 'Shikimori'],
      error: 'Дополнительные озвучки временно недоступны.',
    }, 200);
  }
};