import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const SESSION_COOKIE = 'yume_session';

function isProduction() {
  const context = globalThis.Netlify?.context?.deploy?.context || process.env.CONTEXT || '';
  if (context) return context === 'production';
  const branch = process.env.BRANCH || '';
  const productionBranch = process.env.PRODUCTION_BRANCH || 'main';
  return Boolean(branch && branch === productionBranch && process.env.SITE_ID);
}

function store(name, strong = false) {
  return isProduction()
    ? getStore(name, strong ? { consistency: 'strong' } : undefined)
    : getDeployStore(name);
}

const users = () => store('yume-users', true);
const sessions = () => store('yume-sessions', true);
const history = () => store('yume-history', true);
const activity = () => store('yume-activity', true);

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const num = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.min(max, Math.max(min, Number(value) || 0));
const uniq = values => [...new Set((values || []).filter(Boolean))];
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

async function sessionUser(request) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const session = await sessions().get(`s/${sha256(token)}`, { type: 'json' });
  if (!session?.userId || Number(session.expiresAt) < Date.now()) return null;
  return users().get(`u/${session.userId}`, { type: 'json' });
}

function animeIdentity(data = {}) {
  return String(data.animeId || data.alias || data.key || data.title || '').trim().slice(0, 180);
}

function historyKey(userId, data = {}) {
  const identity = animeIdentity(data);
  return identity ? `u/${userId}/${sha256(identity)}` : '';
}

function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function markActivity(userId, title, episodeKeys, watchSecondsDelta) {
  const a = activity();
  const key = `u/${userId}/${dayKey()}`;
  const existing = await a.get(key, { type: 'json' }) || {
    date: dayKey(),
    watchSeconds: 0,
    episodes: [],
    titles: [],
  };
  existing.watchSeconds = num(existing.watchSeconds) + num(watchSecondsDelta, 0, 60 * 60 * 24 * 365);
  existing.titles = uniq([...(existing.titles || []), title]).slice(-120);
  existing.episodes = uniq([...(existing.episodes || []), ...episodeKeys]).slice(-500);
  existing.updatedAt = Date.now();
  await a.setJSON(key, existing);
}

async function getStatus(request, url) {
  const user = await sessionUser(request);
  if (!user) return json({ watched: false, authenticated: false });
  const data = {
    animeId: url.searchParams.get('animeId') || '',
    alias: url.searchParams.get('alias') || '',
    key: url.searchParams.get('key') || '',
    title: url.searchParams.get('title') || '',
  };
  const key = historyKey(user.id, data);
  if (!key) return json({ watched: false, authenticated: true });
  const item = await history().get(key, { type: 'json' });
  return json({ watched: Boolean(item?.manualWatched), authenticated: true, markedAt: item?.manualMarkedAt || null });
}

async function markWatched(request) {
  const user = await sessionUser(request);
  if (!user) return json({ error: 'Чтобы отметить просмотренным, войдите в аккаунт.' }, 401);

  const data = await body(request);
  const title = String(data.title || '').trim().slice(0, 180);
  if (!title) return json({ error: 'Не удалось определить аниме.' }, 400);
  const key = historyKey(user.id, data);
  if (!key) return json({ error: 'Не удалось определить аниме.' }, 400);

  const h = history();
  const existing = await h.get(key, { type: 'json' }) || {};
  if (existing.manualWatched) return json({ ok: true, watched: true, entry: existing });

  const totalEpisodes = Math.max(1, Math.floor(num(data.totalEpisodes, 1, 5000)));
  const episodeKeys = Array.from({ length: totalEpisodes }, (_, index) => String(index + 1));
  const averageEpisodeSeconds = num(data.averageEpisodeSeconds, 60, 60 * 60 * 4) || 24 * 60;
  const estimatedWatchSeconds = Math.min(60 * 60 * 24 * 365, totalEpisodes * averageEpisodeSeconds);
  const currentWatchSeconds = num(existing.watchSeconds, 0, 60 * 60 * 24 * 365);
  const watchSecondsDelta = Math.max(0, estimatedWatchSeconds - currentWatchSeconds);
  const now = Date.now();

  const entry = {
    ...existing,
    animeId: animeIdentity(data),
    alias: String(data.alias || existing.alias || '').slice(0, 180),
    title,
    episode: existing.episode || `Просмотрено полностью · ${totalEpisodes} серий`,
    episodeNumber: existing.episodeNumber || String(totalEpisodes),
    episodeTitle: existing.episodeTitle || '',
    poster: String(data.poster || existing.poster || '').trim().slice(0, 1200),
    href: String(data.href || existing.href || '').trim().slice(0, 700),
    year: String(data.year || existing.year || '').slice(0, 10),
    type: String(data.type || existing.type || '').slice(0, 60),
    genres: uniq([...(existing.genres || []), ...((Array.isArray(data.genres) ? data.genres : []).map(x => String(x).slice(0, 50)))]).slice(0, 20),
    totalEpisodes: Math.max(totalEpisodes, num(existing.totalEpisodes, 0, 5000)),
    episodesSeen: uniq([...(existing.episodesSeen || []), ...episodeKeys]).slice(-5000),
    completedEpisodes: uniq([...(existing.completedEpisodes || []), ...episodeKeys]).slice(-5000),
    watchSeconds: currentWatchSeconds + watchSecondsDelta,
    lastPosition: num(existing.lastPosition, 0, 60 * 60 * 8),
    duration: num(existing.duration, 0, 60 * 60 * 8),
    watchedAt: now,
    manualWatched: true,
    manualMarkedAt: now,
    manualEstimatedWatchSeconds: estimatedWatchSeconds,
    manualWatchSecondsAdded: watchSecondsDelta,
  };

  await h.setJSON(key, entry);
  await markActivity(user.id, title, episodeKeys, watchSecondsDelta);
  return json({ ok: true, watched: true, entry }, 201);
}

export default async request => {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') return getStatus(request, url);
    if (request.method === 'POST') return markWatched(request);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('watched', error);
    return json({ error: 'Не удалось сохранить статус просмотра.' }, 500);
  }
};
