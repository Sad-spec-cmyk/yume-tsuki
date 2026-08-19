import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'yume_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const LEGACY_DEPLOY_IDS = [
  '6a85f58b3562d00008adb6d1',
  '6a85f5a4a72ee70008d100a6',
  '6a85f5f634183a0008d994ea',
  '6a85f7c9a07a440008d8215b',
  '6a85f7ef10c56900081eba67',
  '6a85f7fa0e8e710008f332b3',
];

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
function legacyStore(name, deployID) { return getDeployStore({ name, deployID }); }

const users = () => store('yume-users', true);
const sessions = () => store('yume-sessions', true);
const history = () => store('yume-history', true);
const activity = () => store('yume-activity', true);
const media = () => store('yume-media', true);
const chat = () => store('yume-chat', true);
const chatRate = () => store('yume-chat-rate', true);

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanEmail = value => String(value || '').trim().toLowerCase();
const cleanUsername = value => String(value || '').trim().toLowerCase();
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function parseCookies(req) {
  const out = {};
  for (const pair of (req.headers.get('cookie') || '').split(';')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const key = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function mediaUrl(user, kind) {
  if (!user?.id) return '';
  const has = kind === 'avatar' ? user.hasAvatar : user.hasBanner;
  if (!has) return '';
  const v = encodeURIComponent(user.updatedAt || user.createdAt || '1');
  return `/.netlify/functions/yume-api?action=media&user=${encodeURIComponent(user.id)}&kind=${kind}&v=${v}`;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || '',
    accent: user.accent || '#ff395f',
    avatarUrl: mediaUrl(user, 'avatar'),
    bannerUrl: mediaUrl(user, 'banner'),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function bodyJson(req) { try { return await req.json(); } catch { return {}; } }
async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(String(password), salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}
async function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const { hash } = await passwordHash(password, user.passwordSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function migrateLegacyHistory(userId, deployID) {
  try {
    const source = legacyStore('yume-history', deployID);
    const target = history();
    const prefix = `u/${userId}/`;
    const { blobs } = await source.list({ prefix });
    for (const blob of blobs) {
      const entry = await source.get(blob.key, { type: 'json' });
      if (entry) await target.setJSON(blob.key, entry);
    }
  } catch {}
}
async function migrateLegacyUser(user, deployID) {
  if (!user?.id) return null;
  const target = users();
  await target.setJSON(`u/${user.id}`, user);
  if (user.email) await target.set(`email/${sha256(cleanEmail(user.email))}`, user.id);
  if (user.username) await target.set(`username/${sha256(cleanUsername(user.username))}`, user.id);
  await migrateLegacyHistory(user.id, deployID);
  return user;
}
async function findLegacyUserByIdentity(identity, password = null) {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!normalized) return null;
  const indexKey = normalized.includes('@') ? `email/${sha256(normalized)}` : `username/${sha256(normalized)}`;
  for (const deployID of LEGACY_DEPLOY_IDS) {
    try {
      const source = legacyStore('yume-users', deployID);
      const id = await source.get(indexKey);
      if (!id) continue;
      const user = await source.get(`u/${id}`, { type: 'json' });
      if (!user) continue;
      if (password !== null && !(await verifyPassword(password, user))) continue;
      await migrateLegacyUser(user, deployID);
      return user;
    } catch {}
  }
  return null;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const key = `s/${sha256(token)}`;
  await sessions().setJSON(key, { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_MAX_AGE * 1000 });
  return token;
}
async function recoverLegacySession(token, sessionKey) {
  for (const deployID of LEGACY_DEPLOY_IDS) {
    try {
      const sourceSessions = legacyStore('yume-sessions', deployID);
      const session = await sourceSessions.get(sessionKey, { type: 'json' });
      if (!session?.userId || Number(session.expiresAt) < Date.now()) continue;
      const sourceUsers = legacyStore('yume-users', deployID);
      const user = await sourceUsers.get(`u/${session.userId}`, { type: 'json' });
      if (!user) continue;
      await migrateLegacyUser(user, deployID);
      await sessions().setJSON(sessionKey, session);
      return { user, token, sessionKey };
    } catch {}
  }
  return null;
}
async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sessionKey = `s/${sha256(token)}`;
  const sessionStore = sessions();
  const session = await sessionStore.get(sessionKey, { type: 'json' });
  if (session?.userId && Number(session.expiresAt) >= Date.now()) {
    const user = await users().get(`u/${session.userId}`, { type: 'json' });
    if (user) return { user, token, sessionKey };
  }
  if (session && Number(session.expiresAt) < Date.now()) await sessionStore.delete(sessionKey);
  return recoverLegacySession(token, sessionKey);
}
function sessionCookie(token) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`; }
function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

function validateProfileInput(data) {
  const displayName = String(data.displayName || '').trim().slice(0, 32);
  const bio = String(data.bio || '').trim().slice(0, 300);
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(data.accent || '')) ? String(data.accent) : '#ff395f';
  return { displayName, bio, accent };
}

async function handleRegister(req) {
  const data = await bodyJson(req);
  const email = cleanEmail(data.email);
  const username = cleanUsername(data.username);
  const password = String(data.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Введите корректный email.' }, 400);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return json({ error: 'Логин: 3–20 символов, только латиница, цифры и _.' }, 400);
  if (password.length < 8 || password.length > 128) return json({ error: 'Пароль должен быть от 8 символов.' }, 400);

  const userStore = users();
  const emailKey = `email/${sha256(email)}`;
  const usernameKey = `username/${sha256(username)}`;
  if (await userStore.get(emailKey) || await userStore.get(usernameKey)) return json({ error: 'Email или логин уже используется.' }, 409);
  if (await findLegacyUserByIdentity(email) || await findLegacyUserByIdentity(username)) return json({ error: 'Этот аккаунт уже существует. Войдите со старым паролем.' }, 409);

  const id = uid();
  const { salt, hash } = await passwordHash(password);
  const user = {
    id, email, username, displayName: username, bio: '', accent: '#ff395f',
    hasAvatar: false, hasBanner: false,
    passwordSalt: salt, passwordHash: hash,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  await userStore.setJSON(`u/${id}`, user);
  await userStore.set(emailKey, id);
  await userStore.set(usernameKey, id);
  const token = await createSession(id);
  return json({ user: publicUser(user) }, 201, { 'set-cookie': sessionCookie(token) });
}

async function handleLogin(req) {
  const data = await bodyJson(req);
  const identity = String(data.identity || '').trim().toLowerCase();
  const password = String(data.password || '');
  if (!identity || !password) return json({ error: 'Введите логин/email и пароль.' }, 400);
  const userStore = users();
  const indexKey = identity.includes('@') ? `email/${sha256(identity)}` : `username/${sha256(identity)}`;
  const id = await userStore.get(indexKey);
  let user = id ? await userStore.get(`u/${id}`, { type: 'json' }) : null;
  if (!user || !(await verifyPassword(password, user))) user = await findLegacyUserByIdentity(identity, password);
  if (!user || !(await verifyPassword(password, user))) return json({ error: 'Неверный логин или пароль.' }, 401);
  const token = await createSession(user.id);
  return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token) });
}

async function handleLogout(req) {
  const current = await getSessionUser(req);
  if (current?.sessionKey) await sessions().delete(current.sessionKey);
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}
async function handleMe(req) {
  const current = await getSessionUser(req);
  return json({ user: current ? publicUser(current.user) : null });
}
async function handleProfile(req) {
  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  if (req.method === 'GET') return json({ user: publicUser(current.user) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const patch = validateProfileInput(await bodyJson(req));
  if (!patch.displayName) patch.displayName = current.user.username;
  const updated = { ...current.user, ...patch, updatedAt: nowIso() };
  await users().setJSON(`u/${updated.id}`, updated);
  return json({ user: publicUser(updated) });
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return { mime: match[1], bytes, dataUrl: `data:${match[1]};base64,${match[2]}` };
}
async function handleMedia(req, url) {
  if (req.method === 'GET') {
    const userId = String(url.searchParams.get('user') || '').trim();
    const kind = url.searchParams.get('kind') === 'banner' ? 'banner' : 'avatar';
    if (!userId) return new Response('Not found', { status: 404 });
    const stored = await media().get(`u/${userId}/${kind}`);
    if (!stored) return new Response('Not found', { status: 404 });
    const parsed = parseDataUrl(stored);
    if (!parsed) return new Response('Not found', { status: 404 });
    return new Response(parsed.bytes, { status: 200, headers: { 'content-type': parsed.mime, 'cache-control': 'public, max-age=3600' } });
  }

  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  if (req.method !== 'POST' && req.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
  const data = await bodyJson(req);
  const kind = data.kind === 'banner' ? 'banner' : 'avatar';
  const key = `u/${current.user.id}/${kind}`;

  if (req.method === 'DELETE') {
    await media().delete(key);
    const updated = { ...current.user, [kind === 'avatar' ? 'hasAvatar' : 'hasBanner']: false, updatedAt: nowIso() };
    await users().setJSON(`u/${updated.id}`, updated);
    return json({ user: publicUser(updated) });
  }

  const parsed = parseDataUrl(data.dataUrl);
  if (!parsed) return json({ error: 'Неверный формат изображения. Используйте JPG, PNG или WebP.' }, 400);
  const limit = kind === 'avatar' ? 1_500_000 : 3_000_000;
  if (parsed.bytes.length > limit) return json({ error: kind === 'avatar' ? 'Аватар слишком большой.' : 'Фон профиля слишком большой.' }, 413);
  await media().set(key, parsed.dataUrl);
  const updated = { ...current.user, [kind === 'avatar' ? 'hasAvatar' : 'hasBanner']: true, updatedAt: nowIso() };
  await users().setJSON(`u/${updated.id}`, updated);
  return json({ user: publicUser(updated) });
}

const uniq = arr => [...new Set((arr || []).filter(Boolean))];
const num = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Math.min(max, Math.max(min, Number(v) || 0));
function dayKey(timestamp = Date.now()) { return new Date(timestamp).toISOString().slice(0, 10); }

async function updateActivity(userId, payload) {
  const a = activity();
  const key = `u/${userId}/${dayKey()}`;
  const existing = await a.get(key, { type: 'json' }) || { date: dayKey(), watchSeconds: 0, episodes: [], titles: [] };
  existing.watchSeconds = num(existing.watchSeconds) + num(payload.watchSecondsDelta, 0, 600);
  existing.titles = uniq([...existing.titles, payload.title]).slice(-120);
  if (payload.episodeKey) existing.episodes = uniq([...existing.episodes, payload.episodeKey]).slice(-300);
  existing.updatedAt = Date.now();
  await a.setJSON(key, existing);
}

async function handleHistory(req) {
  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  const h = history();
  const prefix = `u/${current.user.id}/`;
  if (req.method === 'GET') {
    const { blobs } = await h.list({ prefix });
    const items = (await Promise.all(blobs.map(b => h.get(b.key, { type: 'json' })))).filter(Boolean);
    items.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    return json({ items: items.slice(0, 160) });
  }
  if (req.method === 'DELETE') {
    const { blobs } = await h.list({ prefix });
    await Promise.all(blobs.map(b => h.delete(b.key)));
    const activityStore = activity();
    const activityList = await activityStore.list({ prefix });
    await Promise.all(activityList.blobs.map(b => activityStore.delete(b.key)));
    return json({ ok: true });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const data = await bodyJson(req);
  const title = String(data.title || '').trim().slice(0, 180);
  if (!title) return json({ error: 'Нет названия аниме.' }, 400);
  const animeKey = String(data.animeId || data.alias || title).trim().slice(0, 180);
  const key = `${prefix}${sha256(animeKey)}`;
  const existing = await h.get(key, { type: 'json' }) || {};
  const episodeNumber = String(data.episodeNumber || '').trim().slice(0, 20);
  const episodeTitle = String(data.episodeTitle || '').trim().slice(0, 120);
  const episodeKey = episodeNumber || String(data.episode || '').trim().slice(0, 80);
  const episodesSeen = uniq([...(existing.episodesSeen || []), ...(episodeKey ? [episodeKey] : [])]).slice(-500);
  const completedEpisodes = uniq([...(existing.completedEpisodes || []), ...(data.completed && episodeKey ? [episodeKey] : [])]).slice(-500);
  const watchSecondsDelta = num(data.watchSecondsDelta, 0, 600);
  const entry = {
    ...existing,
    animeId: animeKey,
    title,
    episode: episodeNumber ? `Серия ${episodeNumber}${episodeTitle ? ` · ${episodeTitle}` : ''}` : String(data.episode || existing.episode || '').trim().slice(0, 160),
    episodeNumber,
    episodeTitle,
    poster: String(data.poster || existing.poster || '').trim().slice(0, 1200),
    href: String(data.href || existing.href || '').trim().slice(0, 700),
    year: String(data.year || existing.year || '').slice(0, 10),
    type: String(data.type || existing.type || '').slice(0, 60),
    genres: uniq([...(existing.genres || []), ...((Array.isArray(data.genres) ? data.genres : []).map(x => String(x).slice(0, 50)))]).slice(0, 20),
    totalEpisodes: num(data.totalEpisodes || existing.totalEpisodes, 0, 5000),
    episodesSeen,
    completedEpisodes,
    watchSeconds: num(existing.watchSeconds) + watchSecondsDelta,
    lastPosition: num(data.position, 0, 60 * 60 * 8),
    duration: num(data.duration, 0, 60 * 60 * 8),
    watchedAt: Date.now(),
  };
  await h.setJSON(key, entry);
  await updateActivity(current.user.id, { title, episodeKey, watchSecondsDelta });
  return json({ ok: true, entry }, 201);
}

function diffDays(a, b) { return Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000); }
async function handleStats(req) {
  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  const h = history();
  const prefix = `u/${current.user.id}/`;
  const { blobs } = await h.list({ prefix });
  const items = (await Promise.all(blobs.map(b => h.get(b.key, { type: 'json' })))).filter(Boolean);
  const a = activity();
  const activityList = await a.list({ prefix });
  const days = (await Promise.all(activityList.blobs.map(b => a.get(b.key, { type: 'json' })))).filter(Boolean).sort((x, y) => String(x.date).localeCompare(String(y.date)));

  let watchSeconds = 0, episodes = 0, completed = 0;
  const genreCounts = new Map(), typeCounts = new Map();
  for (const item of items) {
    watchSeconds += num(item.watchSeconds);
    episodes += (item.episodesSeen || []).length || (item.episode ? 1 : 0);
    completed += (item.completedEpisodes || []).length;
    for (const genre of item.genres || []) genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    if (item.type) typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
  }
  const genres = [...genreCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,count])=>({name,count}));
  const types = [...typeCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
  const dates = days.map(d => d.date).filter(Boolean);
  let streak = 0;
  if (dates.length) {
    const sorted = [...new Set(dates)].sort().reverse();
    const today = dayKey();
    const firstGap = diffDays(today, sorted[0]);
    if (firstGap <= 1) {
      streak = 1;
      for (let i = 1; i < sorted.length; i++) {
        if (diffDays(sorted[i-1], sorted[i]) === 1) streak++;
        else break;
      }
    }
  }
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0,10);
    const row = days.find(x => x.date === d);
    last14.push({ date: d, watchSeconds: num(row?.watchSeconds), episodes: (row?.episodes || []).length });
  }
  return json({
    titles: items.length,
    episodes,
    completed,
    watchSeconds,
    watchHours: Math.round((watchSeconds / 3600) * 10) / 10,
    streak,
    activityDays: dates.length,
    genres,
    types,
    last14,
  });
}

let legacyChatMigrationPromise = null;
async function migrateLegacyChat() {
  if (!isProduction()) return;
  if (legacyChatMigrationPromise) return legacyChatMigrationPromise;
  legacyChatMigrationPromise = (async () => {
    const target = chat();
    for (const deployID of LEGACY_DEPLOY_IDS) {
      try {
        const source = legacyStore('yume-chat', deployID);
        const { blobs } = await source.list({ prefix: 'm/' });
        for (const blob of blobs.slice(-100)) {
          const message = await source.get(blob.key, { type: 'json' });
          if (message) await target.setJSON(blob.key, message);
        }
      } catch {}
    }
  })();
  return legacyChatMigrationPromise;
}
async function handleChat(req) {
  const c = chat();
  if (req.method === 'GET') {
    await migrateLegacyChat();
    const { blobs } = await c.list({ prefix: 'm/' });
    const selected = blobs.sort((a,b)=>a.key.localeCompare(b.key)).slice(-100);
    const messages = (await Promise.all(selected.map(b => c.get(b.key, { type:'json' })))).filter(Boolean).sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));
    return json({ messages });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Чтобы писать в чат, зарегистрируйтесь или войдите.' }, 401);
  const data = await bodyJson(req);
  const text = String(data.text || '').replace(/\s+/g,' ').trim().slice(0,500);
  if (!text) return json({ error: 'Сообщение пустое.' }, 400);
  const rate = chatRate();
  const rateKey = `u/${current.user.id}`;
  const previous = Number(await rate.get(rateKey) || 0);
  if (Date.now() - previous < 2000) return json({ error: 'Не так быстро. Подождите пару секунд.' }, 429);
  await rate.set(rateKey, String(Date.now()));
  const createdAt = Date.now();
  const message = {
    id: uid(), text, createdAt,
    user: {
      id: current.user.id,
      username: current.user.username,
      displayName: current.user.displayName || current.user.username,
      accent: current.user.accent || '#ff395f',
      avatarUrl: mediaUrl(current.user, 'avatar'),
    },
  };
  await c.setJSON(`m/${String(createdAt).padStart(13,'0')}-${message.id}`, message);
  return json({ message }, 201);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'me';
    if (action === 'register' && req.method === 'POST') return handleRegister(req);
    if (action === 'login' && req.method === 'POST') return handleLogin(req);
    if (action === 'logout' && req.method === 'POST') return handleLogout(req);
    if (action === 'me' && req.method === 'GET') return handleMe(req);
    if (action === 'profile') return handleProfile(req);
    if (action === 'media') return handleMedia(req, url);
    if (action === 'history') return handleHistory(req);
    if (action === 'stats' && req.method === 'GET') return handleStats(req);
    if (action === 'chat') return handleChat(req);
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('yume-api', error);
    return json({ error: 'Внутренняя ошибка сервера.' }, 500);
  }
}
