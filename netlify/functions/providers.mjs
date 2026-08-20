function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=90, stale-while-revalidate=300',
    },
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
const unique = values => [...new Set((values || []).flat().map(x => String(x || '').trim()).filter(Boolean))];
const safeFetch = (url, options = {}, timeout = 9000) => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
const safeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return /^https?:\/\//i.test(raw) ? raw : '';
};
const env = name => {
  try { return String(Netlify.env.get(name) || '').trim(); } catch { return ''; }
};

function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.max(1, Math.min(A.size, B.size));
}

function yearFrom(value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/);
  return match?.[0] || '';
}

function scoreTitles(candidateTitles, variants, candidateYear, targetYear) {
  let best = 0;
  for (const a of variants) for (const b of candidateTitles) best = Math.max(best, similarity(a, b));
  const normalizedVariants = variants.map(normalize);
  if (candidateTitles.some(t => normalizedVariants.some(v => normalize(t) === v))) best += .55;
  if (targetYear && candidateYear && String(targetYear) === String(candidateYear)) best += .28;
  else if (targetYear && candidateYear && String(targetYear) !== String(candidateYear)) best -= .28;
  return best;
}

function episodeNumber(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const match = String(value || '').match(/\d+(?:\.\d+)?/);
  if (match) return Number(match[0]);
  return Number(fallback) > 0 ? Number(fallback) : 0;
}

function finalizeProvider(provider) {
  const episodes = provider?.episodes && typeof provider.episodes === 'object' ? provider.episodes : {};
  const nums = Object.keys(episodes).map(Number).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const out = { ...provider, episodes };
  if (nums.length) {
    out.availableEpisodes = nums;
    out.firstEpisode = nums[0];
    out.lastEpisode = nums[nums.length - 1];
    out.link = safeUrl(out.link) || safeUrl(episodes[String(nums[0])]);
  } else {
    out.availableEpisodes = Array.isArray(provider?.availableEpisodes) ? provider.availableEpisodes : [];
    out.link = safeUrl(out.link);
  }
  out.via = unique(provider?.via || [provider?.source]);
  return out;
}

async function jikanTitles(query) {
  if (!query) return [];
  try {
    const url = new URL('https://api.jikan.moe/v4/anime');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '6');
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
  } catch {
    return [];
  }
}

async function shikimoriSearch(query) {
  if (!query) return [];
  try {
    const url = new URL('https://shikimori.one/api/animes');
    url.searchParams.set('search', query);
    url.searchParams.set('limit', '12');
    url.searchParams.set('order', 'popularity');
    const r = await safeFetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0 (anime catalogue)' },
    }, 9000);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function shikiCandidateScore(item, variants, year) {
  return scoreTitles(unique([item?.name, item?.russian]), variants, yearFrom(item?.aired_on || item?.released_on), year);
}

async function buildContext(primary, alternates, year) {
  const seeds = unique([primary, ...(alternates || [])]).slice(0, 8);
  const extra = await jikanTitles(seeds[0] || primary);
  const variants = unique([...seeds, ...extra]).slice(0, 24);

  const found = [];
  const seen = new Set();
  for (const query of variants.slice(0, 7)) {
    const rows = await shikimoriSearch(query);
    for (const row of rows) {
      const id = String(row?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(row);
    }
    if (found.length >= 22) break;
  }
  found.sort((a, b) => shikiCandidateScore(b, variants, year) - shikiCandidateScore(a, variants, year));
  const candidates = found.filter(x => shikiCandidateScore(x, variants, year) >= .35).slice(0, 5);
  return { variants, candidates };
}

async function shikimoriVideos(id) {
  try {
    const r = await safeFetch(`https://shikimori.one/api/animes/${encodeURIComponent(id)}/videos`, {
      headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0 (anime catalogue)' },
    }, 10000);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function hostName(raw) {
  try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function shikiProviders(rows, animeId) {
  const groups = new Map();
  for (const row of rows) {
    const kind = String(row?.kind || '').toLowerCase();
    const language = String(row?.language || '').toLowerCase();
    const ep = episodeNumber(row?.episode);
    const link = safeUrl(row?.url);
    if (kind !== 'fandub' || language !== 'russian' || !ep || !link) continue;

    const source = String(row?.source || '').trim();
    const author = String(row?.author_name || '').trim();
    const host = hostName(link);
    const label = author || source || host || 'Русская озвучка';
    const key = normalize(label) || `${source}|${host}` || String(row?.id || ep);
    if (!groups.has(key)) {
      groups.set(key, {
        id: `shiki-${animeId}-${key.replace(/\s+/g, '-').slice(0, 70)}`,
        source: 'Shikimori', name: label, translationType: 'voice', quality: String(row?.quality || '').trim(),
        episodes: {}, via: ['Shikimori'],
      });
    }
    const group = groups.get(key);
    if (!group.episodes[String(ep)]) group.episodes[String(ep)] = link;
    if (!group.quality && row?.quality) group.quality = String(row.quality);
  }
  return [...groups.values()].map(finalizeProvider).sort((a, b) => b.availableEpisodes.length - a.availableEpisodes.length).slice(0, 40);
}

async function collectShikimori(context) {
  const all = [], matchedIds = [], errors = [];
  for (const candidate of context.candidates.slice(0, 4)) {
    try {
      const rows = await shikimoriVideos(candidate.id);
      if (rows.length) matchedIds.push(String(candidate.id));
      all.push(...shikiProviders(rows, candidate.id));
    } catch (e) { errors.push(String(e?.message || e)); }
    if (all.length >= 18) break;
  }
  return {
    providers: all,
    matchedIds,
    candidates: context.candidates.map(x => ({ id: x.id, name: x.name, russian: x.russian })),
    errors,
  };
}

async function yummyGet(path, params, token) {
  const url = new URL(`https://api.yani.tv${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  const response = await safeFetch(url, {
    headers: {
      'X-Application': token,
      'Accept': 'application/json,image/avif,image/webp',
      'Accept-Language': 'ru',
      'Lang': 'ru',
      'Vary': 'json',
      'User-Agent': 'YumeTsuki/1.0',
    },
  }, 12000);
  if (!response.ok) throw new Error(`YummyAnime API ${response.status}`);
  const data = await response.json();
  if (data?.error) throw new Error(data?.error_title || data?.error || 'YummyAnime API error');
  return data?.response ?? data?.data ?? data?.results ?? data;
}

function yummyCandidateTitles(item) {
  return unique([item?.title, item?.original, ...(Array.isArray(item?.other_titles) ? item.other_titles : [])]);
}

function yummyProviderGroups(videos) {
  const groups = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    const link = safeUrl(video?.iframe_url || video?.iframeUrl || video?.url);
    if (!link) continue;
    const data = video?.data || {};
    const dubbing = String(data?.dubbing || video?.dubbing || '').trim();
    const player = String(data?.player || video?.player || '').trim();
    const label = dubbing || player || 'YummyAnime';
    const ep = episodeNumber(video?.number, Number(video?.index || 0) + 1);
    if (!ep) continue;
    const key = normalize(label) || `video-${video?.video_id || video?.id || ep}`;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `yummy-${key.replace(/\s+/g, '-').slice(0, 70)}`,
        source: 'YummyAnime', name: label, translationType: 'voice', quality: '', episodes: {}, via: ['YummyAnime'],
        player,
      });
    }
    const group = groups.get(key);
    if (!group.episodes[String(ep)]) group.episodes[String(ep)] = link;
  }
  return [...groups.values()].map(finalizeProvider).sort((a, b) => b.availableEpisodes.length - a.availableEpisodes.length);
}

async function collectYummy(variants, year) {
  const token = env('YUMMY_TOKEN') || env('YUMMY_APPLICATION_TOKEN');
  if (!token) return { providers: [], configured: false, error: 'YUMMY_TOKEN не задан', matched: null };

  const candidates = [];
  const seen = new Set();
  const errors = [];
  for (const q of variants.slice(0, 6)) {
    try {
      const rows = await yummyGet('/search', { q, limit: 8, offset: 0 }, token);
      for (const item of Array.isArray(rows) ? rows : []) {
        const id = String(item?.anime_id ?? item?.id ?? item?.anime_url ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        candidates.push(item);
      }
    } catch (e) { errors.push(String(e?.message || e)); }
    if (candidates.length >= 18) break;
  }

  candidates.sort((a, b) => scoreTitles(yummyCandidateTitles(b), variants, yearFrom(b?.year), year) - scoreTitles(yummyCandidateTitles(a), variants, yearFrom(a?.year), year));
  const best = candidates.find(x => scoreTitles(yummyCandidateTitles(x), variants, yearFrom(x?.year), year) >= .42) || candidates[0];
  if (!best) return { providers: [], configured: true, error: errors[0] || 'Тайтл не найден в YummyAnime', matched: null };

  const id = best?.anime_id ?? best?.id ?? best?.anime_url;
  let videos = [];
  try {
    videos = await yummyGet(`/anime/${encodeURIComponent(id)}/videos`, {}, token);
  } catch (e) {
    errors.push(String(e?.message || e));
    try {
      const full = await yummyGet(`/anime/${encodeURIComponent(id)}`, { need_videos: 1 }, token);
      videos = full?.videos || [];
    } catch (inner) { errors.push(String(inner?.message || inner)); }
  }

  return {
    providers: yummyProviderGroups(Array.isArray(videos) ? videos : videos?.videos || []),
    configured: true,
    error: errors[0] || '',
    matched: { id, title: best?.title || '', original: best?.original || '', year: best?.year || '' },
  };
}

async function animeVostPost(path, params) {
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => body.set(k, String(v)));
  const r = await safeFetch(`https://api.animevost.org/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': 'application/json',
      'User-Agent': 'YumeTsuki/1.0',
    },
    body,
  }, 12000);
  if (!r.ok) throw new Error(`AnimeVost API ${r.status}`);
  return await r.json();
}

function animeVostRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.response)) return data.response;
  return [];
}

function animeVostTitles(item) {
  return unique([item?.title, item?.original, item?.name]);
}

async function collectAnimeVost(variants, year) {
  const candidates = [];
  const seen = new Set();
  const errors = [];
  for (const q of variants.slice(0, 7)) {
    try {
      const result = await animeVostPost('search', { name: q });
      for (const item of animeVostRows(result)) {
        const id = String(item?.id || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        candidates.push(item);
      }
    } catch (e) { errors.push(String(e?.message || e)); }
    if (candidates.length >= 18) break;
  }
  candidates.sort((a, b) => scoreTitles(animeVostTitles(b), variants, yearFrom(b?.year), year) - scoreTitles(animeVostTitles(a), variants, yearFrom(a?.year), year));
  const best = candidates.find(x => scoreTitles(animeVostTitles(x), variants, yearFrom(x?.year), year) >= .38) || candidates[0];
  if (!best?.id) return { providers: [], error: errors[0] || 'Тайтл не найден', matched: null };

  let playlist = [];
  try {
    const data = await animeVostPost('playlist', { id: best.id });
    playlist = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  } catch (e) { errors.push(String(e?.message || e)); }

  const episodes = {};
  let quality = '';
  for (let i = 0; i < playlist.length; i++) {
    const row = playlist[i] || {};
    const ep = episodeNumber(row?.name, i + 1);
    const hd = safeUrl(row?.hd);
    const std = safeUrl(row?.std);
    const link = hd || std;
    if (!ep || !link) continue;
    if (!episodes[String(ep)]) episodes[String(ep)] = link;
    if (hd) quality = 'HD';
  }
  if (!Object.keys(episodes).length) return { providers: [], error: errors[0] || 'Плейлист пуст', matched: { id: best.id, title: best.title || '', original: best.original || '' } };

  return {
    providers: [finalizeProvider({
      id: `animevost-${best.id}`,
      source: 'AnimeVost', name: 'AnimeVost', translationType: 'voice', quality, episodes, via: ['AnimeVost'], playback: 'video',
    })],
    error: errors[0] || '',
    matched: { id: best.id, title: best.title || '', original: best.original || '', year: best.year || '' },
  };
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

function kodikProviders(items, variants, year) {
  const providers = [];
  const seen = new Set();
  for (const item of items) {
    const titles = unique([
      item?.title, item?.title_orig, item?.other_title, item?.material_data?.title, item?.material_data?.title_en,
      item?.material_data?.anime_title, item?.material_data?.anime_title_english,
      ...(Array.isArray(item?.material_data?.anime_other_titles) ? item.material_data.anime_other_titles : []),
    ]);
    if (scoreTitles(titles, variants, yearFrom(item?.year), year) < .42) continue;
    const link = safeUrl(item?.link);
    if (!link) continue;
    const translation = item?.translation || {};
    const type = String(translation?.type || '').toLowerCase();
    if (type && type !== 'voice') continue;
    const name = String(translation?.title || 'Kodik').trim();
    const id = String(translation?.id || `${name}-${item?.id || providers.length + 1}`);
    const key = `${id}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push(finalizeProvider({
      id: `kodik-${id}`, source: 'Kodik', name, translationType: 'voice', link, quality: item?.quality || '',
      lastSeason: item?.last_season || null, lastEpisode: item?.last_episode || null, via: ['Kodik'],
    }));
  }
  return providers.slice(0, 40);
}

async function collectKodik(variants, year, shikiIds) {
  const token = env('KODIK_TOKEN');
  if (!token) return { providers: [], configured: false, error: 'KODIK_TOKEN не задан' };
  const all = [], errors = [];
  for (const id of shikiIds.slice(0, 3)) {
    try { all.push(...await kodikRequest(token, new URLSearchParams({ shikimori_id: String(id) }))); }
    catch (e) { errors.push(String(e?.message || e)); }
  }
  if (kodikProviders(all, variants, year).length < 3) {
    for (const query of variants.slice(0, 8)) {
      try {
        const params = new URLSearchParams({ title: query, strict: 'false' });
        if (/^\d{4}$/.test(String(year || ''))) params.set('year', String(year));
        all.push(...await kodikRequest(token, params));
      } catch (e) { errors.push(String(e?.message || e)); }
      if (kodikProviders(all, variants, year).length >= 10) break;
    }
  }
  return { providers: kodikProviders(all, variants, year), configured: true, error: errors[0] || '' };
}

function mergeProviders(groups) {
  const rank = { YummyAnime: 4, Kodik: 3, AnimeVost: 2, Shikimori: 1 };
  const map = new Map();
  for (const providerRaw of groups.flat()) {
    const provider = finalizeProvider(providerRaw);
    if (!provider.link && !Object.keys(provider.episodes || {}).length) continue;
    const key = normalize(provider.name || provider.source) || provider.id;
    if (!map.has(key)) {
      map.set(key, provider);
      continue;
    }
    const current = map.get(key);
    const mergedEpisodes = { ...(current.episodes || {}), ...(provider.episodes || {}) };
    const preferred = (rank[provider.source] || 0) > (rank[current.source] || 0) ? provider : current;
    map.set(key, finalizeProvider({
      ...preferred,
      episodes: mergedEpisodes,
      via: unique([...(current.via || [current.source]), ...(provider.via || [provider.source])]),
      quality: preferred.quality || current.quality || provider.quality || '',
      link: preferred.link || current.link || provider.link || '',
    }));
  }
  return [...map.values()]
    .sort((a, b) => b.availableEpisodes.length - a.availableEpisodes.length || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 80);
}

export default async request => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const title = String(url.searchParams.get('title') || '').trim().slice(0, 180);
  const year = String(url.searchParams.get('year') || '').trim().slice(0, 8);
  const alternates = String(url.searchParams.get('titles') || '')
    .split('|').map(x => x.trim()).filter(Boolean).slice(0, 10);
  if (!title) return json({ error: 'Не указано название аниме.' }, 400);

  try {
    const context = await buildContext(title, alternates, year);
    const [shiki, yummy, animevost] = await Promise.all([
      collectShikimori(context),
      collectYummy(context.variants, year),
      collectAnimeVost(context.variants, year),
    ]);
    const kodik = await collectKodik(context.variants, year, shiki.matchedIds);
    const providers = mergeProviders([yummy.providers, kodik.providers, animevost.providers, shiki.providers]);

    return json({
      providers,
      count: providers.length,
      playbackSources: ['AniLiberty', 'AnimeVost', 'Shikimori', ...(yummy.configured ? ['YummyAnime'] : []), ...(kodik.configured ? ['Kodik'] : [])],
      matchedTitles: context.variants,
      diagnostics: {
        yummy: { configured: yummy.configured, found: yummy.providers.length, error: yummy.error, matched: yummy.matched },
        animevost: { configured: true, found: animevost.providers.length, error: animevost.error, matched: animevost.matched },
        shikimori: { configured: true, found: shiki.providers.length, ids: shiki.matchedIds, error: shiki.errors[0] || '' },
        kodik: { configured: kodik.configured, found: kodik.providers.length, error: kodik.error },
      },
    });
  } catch (error) {
    console.error('providers', error);
    return json({ providers: [], count: 0, error: 'Не удалось проверить дополнительные источники.', diagnostics: {} }, 200);
  }
};