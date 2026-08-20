const API_BASE = 'https://kodik-api.com';
const PLAYER_DOMAIN = 'kodikplayer.com';
const PUBLIC_TOKENS_URL = 'https://raw.githubusercontent.com/YaNesyTortiK/AnimeParsers/main/kdk_tokns/tokens.json';
let publicTokenCache = { at: 0, tokens: [] };

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=120, stale-while-revalidate=600',
  },
});
const env = name => { try { return String(Netlify.env.get(name) || '').trim(); } catch { return String(process.env[name] || '').trim(); } };
const unique = values => [...new Set((values || []).map(x => String(x || '').trim()).filter(Boolean))];
const norm = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[’'`]/g, '').replace(/[^a-zа-я0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
const toks = value => new Set(norm(value).split(' ').filter(x => x.length > 1));

function similarity(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.5;
  const A = toks(na), B = toks(nb);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.max(1, Math.min(A.size, B.size));
}
function titleScore(candidate, variants) {
  let best = 0;
  for (const c of candidate) for (const v of variants) best = Math.max(best, similarity(c, v));
  return best;
}
function yearOf(value) { return String(value || '').match(/(?:19|20)\d{2}/)?.[0] || ''; }

function rewritePlayerUrl(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = `https:${value}`;
  try {
    const u = new URL(value);
    if (/^(?:www\.)?kodik\.(?:info|biz|cc)$/i.test(u.hostname) || /^(?:www\.)?kodikplayer\.com$/i.test(u.hostname)) {
      u.protocol = 'https:';
      u.hostname = PLAYER_DOMAIN;
      u.port = '';
    }
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch { return ''; }
}

function decryptToken(encoded) {
  const raw = String(encoded || '').trim();
  if (!raw || raw.length % 2) return '';
  try {
    const half = raw.length / 2;
    const p1 = raw.slice(0, half).split('').reverse().join('');
    const p2 = raw.slice(half).split('').reverse().join('');
    const a = Buffer.from(p1, 'base64').toString('utf8');
    const b = Buffer.from(p2, 'base64').toString('utf8');
    return `${b}${a}`.trim();
  } catch { return ''; }
}

async function publicTokens() {
  const now = Date.now();
  if (publicTokenCache.tokens.length && now - publicTokenCache.at < 30 * 60 * 1000) return publicTokenCache.tokens;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch(PUBLIC_TOKENS_URL, {
      signal: controller.signal,
      headers: { accept:'application/json', 'user-agent':'YumeTsuki/1.0' },
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const data = await r.json();
    const rows = [...(data?.stable || []), ...(data?.unstable || [])];
    const tokens = unique(rows.filter(x => x?.functions_availability?.search !== false).map(x => decryptToken(x?.tokn))).filter(x => /^[a-z0-9]{20,80}$/i.test(x));
    publicTokenCache = { at:now, tokens };
    return tokens;
  } catch { return []; }
  finally { clearTimeout(timer); }
}

async function tokenCandidates() {
  return unique([
    env('KODIK_TOKEN'),
    env('KODIK_API_TOKEN'),
    ...(await publicTokens()),
  ]);
}

async function kodikSearch(token, params) {
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('token', token);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { accept:'application/json', 'user-agent':'YumeTsuki/1.0' },
    });
    if (!r.ok) throw new Error(`Kodik ${r.status}`);
    const data = await r.json();
    if (data?.error) throw new Error(String(data.error));
    return data;
  } finally { clearTimeout(timer); }
}

async function shikimoriCandidate(variants, year) {
  const found = new Map();
  for (const q of variants.slice(0, 3)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const url = new URL('https://shikimori.one/api/animes');
      url.searchParams.set('search', q);
      url.searchParams.set('limit', '12');
      url.searchParams.set('order', 'popularity');
      const r = await fetch(url, { signal:controller.signal, headers:{ accept:'application/json', 'user-agent':'YumeTsuki/1.0' } });
      if (!r.ok) continue;
      const rows = await r.json();
      for (const item of Array.isArray(rows) ? rows : []) if (item?.id) found.set(String(item.id), item);
    } catch {}
    finally { clearTimeout(timer); }
  }
  const rows = [...found.values()];
  const scoreItem = item => {
    let s = titleScore([item?.name, item?.russian], variants);
    const y = yearOf(item?.aired_on || item?.released_on);
    if (year && y && String(year) === y) s += .35;
    else if (year && y && Math.abs(Number(year) - Number(y)) > 1) s -= .3;
    return s;
  };
  rows.sort((a, b) => scoreItem(b) - scoreItem(a));
  const best = rows[0];
  return best && scoreItem(best) >= .48 ? best : null;
}

function rowTitles(row) {
  return unique([
    row?.title, row?.title_orig, row?.other_title,
    row?.material_data?.title, row?.material_data?.anime_title, row?.material_data?.title_en,
    ...(row?.material_data?.other_titles || []), ...(row?.material_data?.other_titles_en || []), ...(row?.material_data?.other_titles_jp || []),
  ]);
}

function extractEpisodes(row) {
  const episodes = {};
  const seasonsRaw = row?.seasons;
  const seasons = Array.isArray(seasonsRaw) ? seasonsRaw : Object.values(seasonsRaw || {});
  for (const season of seasons) {
    const epsRaw = season?.episodes;
    const eps = Array.isArray(epsRaw) ? epsRaw.map((x, i) => [String(x?.number ?? x?.episode ?? i + 1), x]) : Object.entries(epsRaw || {});
    for (const [key, ep] of eps) {
      const numberValue = (ep?.number ?? ep?.episode ?? key) || '';
      const n = String(numberValue).match(/\d+(?:\.\d+)?/)?.[0] || '';
      const link = rewritePlayerUrl(ep?.link || ep?.url);
      if (n && link && !episodes[n]) episodes[n] = link;
    }
  }
  return episodes;
}

function buildProviders(rows, variants, year) {
  if (!rows.length) return [];
  let maxScore = 0;
  const scored = rows.map(row => {
    let score = titleScore(rowTitles(row), variants);
    const y = yearOf(row?.year || row?.material_data?.year || row?.material_data?.aired_at);
    if (year && y && String(year) === y) score += .3;
    else if (year && y && Math.abs(Number(year) - Number(y)) > 1) score -= .3;
    maxScore = Math.max(maxScore, score);
    return { row, score };
  });
  const accepted = scored.filter(x => x.score >= Math.max(.45, maxScore - .32)).map(x => x.row);
  const groups = new Map();

  for (const row of accepted) {
    const tr = row?.translation || {};
    const name = String(tr?.title || '').trim() || 'Kodik';
    const type = String(tr?.type || 'voice').toLowerCase() === 'subtitles' ? 'subtitles' : 'voice';
    const key = `${type}:${tr?.id || norm(name)}`;
    const episodes = extractEpisodes(row);
    const link = rewritePlayerUrl(row?.link || Object.values(episodes)[0]);
    if (!link && !Object.keys(episodes).length) continue;
    const provider = {
      id: `kodik-${String(row?.id || key).replace(/[^a-z0-9_-]/gi, '-')}-${String(tr?.id || '').replace(/\D/g, '')}`,
      name,
      type,
      source: 'Kodik',
      translationId: tr?.id || null,
      quality: String(row?.quality || '').trim(),
      link,
      episodes,
      lastEpisode: Number(row?.last_episode || row?.episodes_count || 0) || Object.keys(episodes).length,
      shikimoriId: String(row?.shikimori_id || ''),
    };
    if (!groups.has(key)) groups.set(key, provider);
    else {
      const current = groups.get(key);
      current.episodes = { ...current.episodes, ...episodes };
      current.lastEpisode = Math.max(Number(current.lastEpisode || 0), Number(provider.lastEpisode || 0));
      if (!current.link && provider.link) current.link = provider.link;
      if (!current.quality && provider.quality) current.quality = provider.quality;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'voice' ? -1 : 1;
    return (Object.keys(b.episodes || {}).length || b.lastEpisode || 0) - (Object.keys(a.episodes || {}).length || a.lastEpisode || 0);
  }).slice(0, 50);
}

export default async request => {
  const url = new URL(request.url);
  const title = String(url.searchParams.get('title') || '').trim();
  const alt = String(url.searchParams.get('alt') || '').split('|').map(x => x.trim()).filter(Boolean);
  const year = String(url.searchParams.get('year') || '').match(/(?:19|20)\d{2}/)?.[0] || '';
  const variants = unique([title, ...alt]).slice(0, 10);
  if (!title) return json({ error:'Не указано название.' }, 400);

  const tokens = await tokenCandidates();
  if (!tokens.length) return json({ providers:[], diagnostics:{ apiBase:API_BASE, playerDomain:PLAYER_DOMAIN, tokenSource:'none', error:'Нет доступного Kodik token' } });

  const shiki = await shikimoriCandidate(variants, year);
  let rows = [];
  let workingToken = '';
  let lastError = '';

  for (const token of tokens) {
    try {
      if (shiki?.id) {
        const data = await kodikSearch(token, { shikimori_id:shiki.id, limit:100, with_episodes:true, with_material_data:true });
        rows.push(...(Array.isArray(data?.results) ? data.results : []));
      }
      if (!rows.length) {
        for (const q of variants.slice(0, 4)) {
          const data = await kodikSearch(token, { title:q, limit:100, with_episodes:true, with_material_data:true });
          rows.push(...(Array.isArray(data?.results) ? data.results : []));
          if (rows.length >= 80) break;
        }
      }
      workingToken = token;
      break;
    } catch (e) {
      lastError = String(e?.message || e);
      rows = [];
    }
  }

  const providers = buildProviders(rows, variants, year);
  const envTokens = new Set([env('KODIK_TOKEN'), env('KODIK_API_TOKEN')].filter(Boolean));
  return json({
    providers,
    diagnostics: {
      apiBase: API_BASE,
      playerDomain: PLAYER_DOMAIN,
      tokenSource: workingToken ? (envTokens.has(workingToken) ? 'env' : 'public-fallback') : 'failed',
      matchedShikimoriId: shiki?.id || null,
      rawResults: rows.length,
      found: providers.length,
      error: workingToken ? '' : lastError,
    },
  });
};