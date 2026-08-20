function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=120, stale-while-revalidate=600',
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
const unique = values => [...new Set((values || []).map(x => String(x || '').trim()).filter(Boolean))];
const safeFetch = (url, options = {}, timeout = 9000) => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
const safeUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  return /^https?:\/\//i.test(raw) ? raw : '';
};

function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.max(1, Math.min(A.size, B.size));
}

async function jikanTitles(query) {
  if (!query) return [];
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

function candidateScore(item, variants, year) {
  const itemTitles = unique([item?.name, item?.russian]);
  let best = 0;
  for (const a of variants) for (const b of itemTitles) best = Math.max(best, similarity(a, b));
  const normalizedVariants = variants.map(normalize);
  if (itemTitles.some(t => normalizedVariants.some(v => normalize(t) === v))) best += .45;
  const itemYear = String(item?.aired_on || item?.released_on || '').slice(0, 4);
  if (year && itemYear && String(year) === itemYear) best += .25;
  else if (year && itemYear && String(year) !== itemYear) best -= .35;
  return best;
}

async function buildContext(primary, alternates, year) {
  const seeds = unique([primary, ...(alternates || [])]).slice(0, 8);
  const extra = await jikanTitles(seeds[0] || primary);
  const variants = unique([...seeds, ...extra]).slice(0, 20);

  const found = [];
  const seen = new Set();
  for (const query of variants.slice(0, 6)) {
    const rows = await shikimoriSearch(query);
    for (const row of rows) {
      const id = String(row?.id || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(row);
    }
    if (found.length >= 18) break;
  }
  found.sort((a, b) => candidateScore(b, variants, year) - candidateScore(a, variants, year));
  const candidates = found.filter(x => candidateScore(x, variants, year) >= .35).slice(0, 4);
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
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function shikiProviders(rows, animeId) {
  const groups = new Map();
  for (const row of rows) {
    const kind = String(row?.kind || '').toLowerCase();
    const language = String(row?.language || '').toLowerCase();
    const episode = Number(row?.episode || 0);
    const link = safeUrl(row?.url);
    if (kind !== 'fandub' || language !== 'russian' || !episode || !link) continue;

    const source = String(row?.source || '').trim();
    const author = String(row?.author_name || '').trim();
    const host = hostName(link);
    const label = author || source || host || 'Русская озвучка';
    const groupKey = normalize(label) || `${source}|${host}` || String(row?.id || episode);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: `shiki-${animeId}-${groupKey.replace(/\s+/g, '-').slice(0, 70)}`,
        source: 'Shikimori',
        name: label,
        translationType: 'voice',
        quality: String(row?.quality || '').trim(),
        episodes: {},
        episodeSources: {},
      });
    }
    const group = groups.get(groupKey);
    const key = String(episode);
    if (!group.episodes[key]) {
      group.episodes[key] = link;
      group.episodeSources[key] = source || host;
    }
    if (!group.quality && row?.quality) group.quality = String(row.quality);
  }

  const out = [];
  for (const group of groups.values()) {
    const episodeNumbers = Object.keys(group.episodes).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!episodeNumbers.length) continue;
    group.availableEpisodes = episodeNumbers;
    group.firstEpisode = episodeNumbers[0];
    group.lastEpisode = episodeNumbers[episodeNumbers.length - 1];
    group.link = group.episodes[String(group.firstEpisode)] || '';
    out.push(group);
  }
  out.sort((a, b) => b.availableEpisodes.length - a.availableEpisodes.length || a.name.localeCompare(b.name, 'ru'));
  return out.slice(0, 30);
}

async function collectShikimori(primary, alternates, year) {
  const { variants, candidates } = await buildContext(primary, alternates, year);
  const all = [];
  const matchedIds = [];
  for (const candidate of candidates.slice(0, 3)) {
    const rows = await shikimoriVideos(candidate.id);
    if (rows.length) matchedIds.push(String(candidate.id));
    all.push(...shikiProviders(rows, candidate.id));
    if (all.length >= 12) break;
  }

  const seen = new Set();
  const providers = [];
  for (const provider of all) {
    const signature = `${normalize(provider.name)}|${provider.availableEpisodes.join(',')}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    providers.push(provider);
  }
  return { providers, variants, matchedIds, candidates: candidates.map(x => ({ id: x.id, name: x.name, russian: x.russian })) };
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
      item?.title,
      item?.title_orig,
      item?.other_title,
      item?.material_data?.title,
      item?.material_data?.title_en,
      item?.material_data?.anime_title,
      item?.material_data?.anime_title_english,
      ...(Array.isArray(item?.material_data?.anime_other_titles) ? item.material_data.anime_other_titles : []),
    ]);
    let best = 0;
    for (const a of variants) for (const b of titles) best = Math.max(best, similarity(a, b));
    if (best < .42) continue;
    if (year && item?.year && String(item.year) !== String(year)) continue;
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
    providers.push({
      id: `kodik-${id}`,
      source: 'Kodik',
      name,
      translationType: 'voice',
      link,
      quality: item?.quality || '',
      lastSeason: item?.last_season || null,
      lastEpisode: item?.last_episode || null,
    });
  }
  return providers.slice(0, 30);
}

async function collectKodik(variants, year, shikiIds) {
  const token = globalThis.Netlify?.env?.get?.('KODIK_TOKEN') || process.env.KODIK_TOKEN || '';
  if (!token) return { providers: [], configured: false, error: '' };
  const all = [];
  const errors = [];
  for (const id of shikiIds.slice(0, 3)) {
    try {
      all.push(...await kodikRequest(token, new URLSearchParams({ shikimori_id: String(id) })));
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }
  if (kodikProviders(all, variants, year).length < 3) {
    for (const query of variants.slice(0, 6)) {
      try {
        const params = new URLSearchParams({ title: query, strict: 'false' });
        if (/^\d{4}$/.test(String(year || ''))) params.set('year', String(year));
        all.push(...await kodikRequest(token, params));
      } catch (e) {
        errors.push(String(e?.message || e));
      }
      if (kodikProviders(all, variants, year).length >= 8) break;
    }
  }
  return { providers: kodikProviders(all, variants, year), configured: true, error: errors[0] || '' };
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
    const shiki = await collectShikimori(title, alternates, year);
    const kodik = await collectKodik(shiki.variants, year, shiki.matchedIds);
    const combined = [...kodik.providers, ...shiki.providers];
    const seen = new Set();
    const providers = [];
    for (const provider of combined) {
      const key = `${normalize(provider.source)}|${normalize(provider.name)}|${provider.link || JSON.stringify(provider.episodes || {})}`;
      if (seen.has(key)) continue;
      seen.add(key);
      providers.push(provider);
    }

    return json({
      providers: providers.slice(0, 40),
      count: providers.length,
      playbackSources: ['AniLiberty', 'Shikimori', ...(kodik.configured ? ['Kodik'] : [])],
      metadataSources: ['Jikan', 'Shikimori'],
      matchedTitles: shiki.variants,
      shikimoriIds: shiki.matchedIds,
      matchedAnime: shiki.candidates,
      diagnostics: {
        shikimori: { found: shiki.providers.length, ids: shiki.matchedIds },
        kodik: { configured: kodik.configured, found: kodik.providers.length, error: kodik.error },
      },
    });
  } catch (error) {
    console.error('providers', error);
    return json({
      providers: [],
      count: 0,
      playbackSources: ['AniLiberty', 'Shikimori'],
      metadataSources: ['Jikan', 'Shikimori'],
      error: 'Дополнительные озвучки временно недоступны.',
    }, 200);
  }
};
