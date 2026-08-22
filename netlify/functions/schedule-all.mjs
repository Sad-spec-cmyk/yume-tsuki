const UA = 'YumeTsuki/1.0 (multi-source schedule)';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'public, max-age=180, stale-while-revalidate=600',
  },
});

const timeoutFetch = (url, options = {}, ms = 9000) => fetch(url, {
  ...options,
  headers: { 'user-agent': UA, accept:'application/json', ...(options.headers || {}) },
  signal: AbortSignal.timeout(ms),
});

const text = v => String(v ?? '').trim();
const first = (...values) => values.map(text).find(Boolean) || '';
const unique = values => [...new Set((values || []).map(text).filter(Boolean))];

function fullPoster(raw, base = '') {
  const value = text(raw);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (!base) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
}

function aniTitle(a) { return first(a?.name?.main, a?.name?.english, a?.names?.ru, a?.names?.en, a?.title); }
function aniPoster(a) {
  const p = a?.poster;
  const raw = typeof p === 'string' ? p : first(p?.src, p?.preview, p?.optimized?.preview, p?.thumbnail, p?.original);
  return fullPoster(raw, 'https://static.wwnd.space/');
}
function aniHref(a) {
  const alias = first(a?.alias, a?.release?.alias);
  return alias ? `/anime?alias=${encodeURIComponent(alias)}` : `/anime?q=${encodeURIComponent(aniTitle(a))}`;
}

async function aniliberty(path, query = {}) {
  const qs = new URLSearchParams();
  for (const [k,v] of Object.entries(query)) if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
  const suffix = `${path}${qs.size ? `?${qs}` : ''}`;
  const bases = ['https://api.anilibria.app/api/v1', 'https://aniliberty.top/api/v1'];
  let last = null;
  for (const base of bases) {
    try {
      const r = await timeoutFetch(`${base}${suffix}`, { headers:{accept:'application/json'} }, 9000);
      if (!r.ok) { last = new Error(`AniLiberty ${r.status}`); continue; }
      return await r.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('AniLiberty unavailable');
}

function releaseOf(item) { return item?.release || item || {}; }

async function collectAniLiberty() {
  const items = [];
  const diagnostics = { ok:false, exact:0, recurring:0, error:'' };
  try {
    const [nowData, catalogData] = await Promise.all([
      aniliberty('/anime/schedule/now').catch(() => ({})),
      aniliberty('/anime/catalog/releases', { limit:100, 'f[production_statuses]':'IS_IN_PRODUCTION', 'f[sorting]':'FRESH_AT_DESC' }).catch(() => ({data:[]})),
    ]);
    for (const [relativeDay, list] of [[0, nowData?.today], [1, nowData?.tomorrow]]) {
      for (const raw of Array.isArray(list) ? list : []) {
        const a = releaseOf(raw), title = aniTitle(a); if (!title) continue;
        items.push({title,poster:aniPoster(a),href:aniHref(a),nextEpisode:raw?.next_release_episode_number ?? a?.next_release_episode_number ?? '',relativeDay,exact:true,source:'AniLiberty'});
        diagnostics.exact++;
      }
    }
    const list = Array.isArray(catalogData) ? catalogData : (catalogData?.data || catalogData?.items || []);
    for (const a of list) {
      const title = aniTitle(a); if (!title || !a?.publish_day) continue;
      const published = Number(a?.published_release_episode?.ordinal || 0);
      const nextEpisode = a?.next_release_episode_number || (published ? published + 1 : '');
      items.push({title,poster:aniPoster(a),href:aniHref(a),nextEpisode,weekday:a.publish_day?.value ?? a.publish_day?.description ?? a.publish_day,exact:false,source:'AniLiberty'});
      diagnostics.recurring++;
    }
    diagnostics.ok = true;
  } catch (e) { diagnostics.error = String(e?.message || e); }
  return { items, diagnostics };
}

async function collectShikimori() {
  const items = [], diagnostics = { ok:false, count:0, error:'' };
  try {
    const r = await timeoutFetch('https://shikimori.one/api/calendar', {}, 9000);
    if (!r.ok) throw new Error(`Shikimori ${r.status}`);
    const rows = await r.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      const a = row?.anime || {}, title = first(a?.russian, a?.name); if (!title) continue;
      const nextAt = first(row?.next_episode_at); if (!nextAt) continue;
      items.push({title,poster:fullPoster(first(a?.image?.original,a?.image?.preview),'https://shikimori.one/'),href:`/anime?q=${encodeURIComponent(title)}`,nextEpisode:row?.next_episode ?? '',nextAt,exact:true,source:'Shikimori'});
      diagnostics.count++;
    }
    diagnostics.ok = true;
  } catch (e) { diagnostics.error = String(e?.message || e); }
  return { items, diagnostics };
}

async function jikanPage(page) {
  const url = new URL('https://api.jikan.moe/v4/schedules');
  url.searchParams.set('sfw','true'); url.searchParams.set('limit','25'); url.searchParams.set('page', String(page));
  const r = await timeoutFetch(url, {}, 9000);
  if (!r.ok) throw new Error(`Jikan ${r.status}`);
  return r.json();
}

async function collectJikan() {
  const items = [], diagnostics = { ok:false, count:0, pages:0, error:'' };
  try {
    for (let page = 1; page <= 3; page++) {
      const data = await jikanPage(page); diagnostics.pages++;
      for (const a of Array.isArray(data?.data) ? data.data : []) {
        const title = first(a?.title_english,a?.title,a?.title_japanese), weekday = first(a?.broadcast?.day);
        if (!title || !weekday) continue;
        items.push({title,poster:first(a?.images?.webp?.image_url,a?.images?.jpg?.image_url),href:`/anime?q=${encodeURIComponent(title)}`,nextEpisode:'',weekday,exact:false,source:'Jikan'});
        diagnostics.count++;
      }
      if (!data?.pagination?.has_next_page) break;
      await new Promise(resolve => setTimeout(resolve, 420));
    }
    diagnostics.ok = true;
  } catch (e) { diagnostics.error = String(e?.message || e); }
  return { items, diagnostics };
}

export default async () => {
  const [ani, shiki, jikan] = await Promise.all([collectAniLiberty(), collectShikimori(), collectJikan()]);
  const all = [...ani.items, ...shiki.items, ...jikan.items];
  if (!all.length) return json({ error:'Все источники расписания временно недоступны.', items:[], diagnostics:{ aniliberty:ani.diagnostics, shikimori:shiki.diagnostics, jikan:jikan.diagnostics } }, 502);
  return json({ok:true,items:all,sources:unique(all.map(x=>x.source)),diagnostics:{aniliberty:ani.diagnostics,shikimori:shiki.diagnostics,jikan:jikan.diagnostics}});
};
