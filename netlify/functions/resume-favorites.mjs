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
const resumeStore = () => store('yume-resume', true);
const favoritesStore = () => store('yume-favorites', true);

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanUsername = value => String(value || '').trim().toLowerCase();
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const num = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.min(max, Math.max(min, Number(value) || 0));

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
async function body(request) { try { return await request.json(); } catch { return {}; } }
async function sessionUser(request) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const session = await sessions().get(`s/${sha256(token)}`, { type: 'json' });
  if (!session?.userId || Number(session.expiresAt) < Date.now()) return null;
  return users().get(`u/${session.userId}`, { type: 'json' });
}
function safeUser(user) {
  if (!user) return null;
  const version = encodeURIComponent(user.updatedAt || user.createdAt || '1');
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || '',
    accent: user.accent || '#ff395f',
    createdAt: user.createdAt,
    avatarUrl: user.hasAvatar ? `/.netlify/functions/yume-api?action=media&user=${encodeURIComponent(user.id)}&kind=avatar&v=${version}` : '',
    bannerUrl: user.hasBanner ? `/.netlify/functions/yume-api?action=media&user=${encodeURIComponent(user.id)}&kind=banner&v=${version}` : '',
  };
}
function animeKey(data = {}) {
  const value = String(data.key || data.alias || data.animeId || data.title || '').trim();
  return value ? sha256(value.toLowerCase()) : '';
}
function cleanFavorite(data = {}) {
  return {
    key: animeKey(data),
    animeId: String(data.animeId || '').slice(0, 120),
    alias: String(data.alias || '').slice(0, 180),
    title: String(data.title || '').trim().slice(0, 180),
    poster: String(data.poster || '').slice(0, 1000),
    year: String(data.year || '').slice(0, 20),
    type: String(data.type || '').slice(0, 80),
    addedAt: Date.now(),
  };
}

async function handleResume(request, url) {
  const user = await sessionUser(request);
  if (!user) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  const rs = resumeStore();
  if (request.method === 'GET') {
    const key = animeKey({ key: url.searchParams.get('key') || '' });
    if (!key) return json({ item: null });
    return json({ item: await rs.get(`u/${user.id}/${key}`, { type: 'json' }) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const data = await body(request);
  const key = animeKey(data);
  if (!key || !String(data.title || '').trim()) return json({ error: 'Нет данных аниме.' }, 400);
  const item = {
    key,
    title: String(data.title || '').trim().slice(0, 180),
    animeId: String(data.animeId || '').slice(0, 120),
    alias: String(data.alias || '').slice(0, 180),
    poster: String(data.poster || '').slice(0, 1000),
    episodeIndex: num(data.episodeIndex, 0, 10000),
    episodeNumber: String(data.episodeNumber ?? '').slice(0, 40),
    episodeTitle: String(data.episodeTitle || '').slice(0, 180),
    position: num(data.position, 0, 60 * 60 * 24),
    duration: num(data.duration, 0, 60 * 60 * 24),
    quality: String(data.quality || '').slice(0, 20),
    completed: Boolean(data.completed),
    updatedAt: Date.now(),
  };
  await rs.setJSON(`u/${user.id}/${key}`, item);
  return json({ ok: true, item }, 201);
}

async function handleFavorites(request, url) {
  const user = await sessionUser(request);
  if (!user) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  const fs = favoritesStore();
  const prefix = `u/${user.id}/`;
  if (request.method === 'GET') {
    const rawKey = url.searchParams.get('key') || '';
    if (rawKey) {
      const key = animeKey({ key: rawKey });
      return json({ item: key ? await fs.get(`${prefix}${key}`, { type: 'json' }) : null });
    }
    const { blobs } = await fs.list({ prefix });
    const items = (await Promise.all(blobs.map(b => fs.get(b.key, { type: 'json' })))).filter(Boolean);
    items.sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0));
    return json({ items: items.slice(0, 250) });
  }
  const data = await body(request);
  const key = animeKey(data);
  if (!key) return json({ error: 'Нет идентификатора аниме.' }, 400);
  if (request.method === 'DELETE') {
    await fs.delete(`${prefix}${key}`);
    return json({ ok: true });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const item = cleanFavorite(data);
  if (!item.title) return json({ error: 'Нет названия аниме.' }, 400);
  await fs.setJSON(`${prefix}${key}`, item);
  return json({ ok: true, item }, 201);
}

async function publicStats(userId) {
  const hs = history();
  const prefix = `u/${userId}/`;
  const { blobs } = await hs.list({ prefix });
  const items = (await Promise.all(blobs.map(b => hs.get(b.key, { type: 'json' })))).filter(Boolean);
  let watchSeconds = 0;
  const episodeKeys = new Set();
  for (const item of items) {
    watchSeconds += num(item.watchSeconds || item.totalWatchSeconds || 0, 0, 60 * 60 * 24 * 365);
    const n = item.episodeNumber || item.episode || '';
    if (n) episodeKeys.add(`${item.title || ''}:${n}`);
  }
  const fs = favoritesStore();
  const favPrefix = `u/${userId}/`;
  const { blobs: favBlobs } = await fs.list({ prefix: favPrefix });
  const favorites = (await Promise.all(favBlobs.slice(-30).map(b => fs.get(b.key, { type: 'json' })))).filter(Boolean);
  favorites.sort((a,b) => Number(b.addedAt || 0) - Number(a.addedAt || 0));
  return {
    titles: items.length,
    episodes: episodeKeys.size,
    watchHours: Math.round((watchSeconds / 3600) * 10) / 10,
    favorites: favorites.slice(0, 24),
    favoriteCount: favBlobs.length,
  };
}

async function handlePublicProfile(url) {
  const username = cleanUsername(url.searchParams.get('username'));
  if (!username) return json({ error: 'Укажите username.' }, 400);
  const id = await users().get(`username/${sha256(username)}`);
  if (!id) return json({ error: 'Профиль не найден.' }, 404);
  const user = await users().get(`u/${id}`, { type: 'json' });
  if (!user) return json({ error: 'Профиль не найден.' }, 404);
  return json({ user: safeUser(user), stats: await publicStats(user.id) });
}

export default async request => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  try {
    if (action === 'resume') return handleResume(request, url);
    if (action === 'favorites') return handleFavorites(request, url);
    if (action === 'public-profile' && request.method === 'GET') return handlePublicProfile(url);
    return json({ error: 'Unknown action' }, 404);
  } catch (error) {
    console.error('resume-favorites', action, error);
    return json({ error: 'Внутренняя ошибка сервера.' }, 500);
  }
};
