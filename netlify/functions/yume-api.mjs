import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'yume_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function store(name, strong = false) {
  const isProd = process.env.CONTEXT === 'production';
  return isProd
    ? getStore(name, strong ? { consistency: 'strong' } : undefined)
    : getDeployStore(name);
}

const users = () => store('yume-users', true);
const sessions = () => store('yume-sessions', true);
const history = () => store('yume-history', true);
const chat = () => store('yume-chat', true);
const chatRate = () => store('yume-chat-rate', true);

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

function parseCookies(req) {
  const raw = req.headers.get('cookie') || '';
  const out = {};
  for (const pair of raw.split(';')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const key = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cleanEmail = value => String(value || '').trim().toLowerCase();
const cleanUsername = value => String(value || '').trim().toLowerCase();
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || '',
    avatar: user.avatar || '🌙',
    accent: user.accent || '#ff395f',
    createdAt: user.createdAt,
  };
}

async function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(String(password), salt, 64);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

async function verifyPassword(password, user) {
  const { hash } = await passwordHash(password, user.passwordSalt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const key = sha256(token);
  await sessions().setJSON(`s/${key}`, {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  });
  return token;
}

async function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sessionKey = `s/${sha256(token)}`;
  const session = await sessions().get(sessionKey, { type: 'json' });
  if (!session || !session.userId || Number(session.expiresAt) < Date.now()) {
    if (session) await sessions().delete(sessionKey);
    return null;
  }
  const user = await users().get(`u/${session.userId}`, { type: 'json' });
  return user ? { user, token, sessionKey } : null;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function bodyJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function validateProfileInput(data) {
  const displayName = String(data.displayName || '').trim().slice(0, 30);
  const bio = String(data.bio || '').trim().slice(0, 180);
  const avatar = String(data.avatar || '🌙').trim().slice(0, 8) || '🌙';
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(data.accent || '')) ? String(data.accent) : '#ff395f';
  return { displayName, bio, avatar, accent };
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
  if (await userStore.get(emailKey) || await userStore.get(usernameKey)) {
    return json({ error: 'Email или логин уже используется.' }, 409);
  }

  const id = uid();
  const { salt, hash } = await passwordHash(password);
  const user = {
    id, email, username,
    displayName: username,
    bio: '', avatar: '🌙', accent: '#ff395f',
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
  if (!id) return json({ error: 'Неверный логин или пароль.' }, 401);
  const user = await userStore.get(`u/${id}`, { type: 'json' });
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
  if (!current) return json({ user: null }, 200);
  return json({ user: publicUser(current.user) });
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

async function handleHistory(req) {
  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Нужно войти в аккаунт.' }, 401);
  const h = history();
  const prefix = `u/${current.user.id}/`;

  if (req.method === 'GET') {
    const { blobs } = await h.list({ prefix });
    const items = (await Promise.all(blobs.map(b => h.get(b.key, { type: 'json' })))).filter(Boolean);
    items.sort((a, b) => Number(b.watchedAt || 0) - Number(a.watchedAt || 0));
    return json({ items: items.slice(0, 120) });
  }

  if (req.method === 'DELETE') {
    const { blobs } = await h.list({ prefix });
    await Promise.all(blobs.map(b => h.delete(b.key)));
    return json({ ok: true });
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const data = await bodyJson(req);
  const title = String(data.title || '').trim().slice(0, 180);
  if (!title) return json({ error: 'Нет названия аниме.' }, 400);
  const entry = {
    title,
    episode: String(data.episode || '').trim().slice(0, 60),
    poster: String(data.poster || '').trim().slice(0, 1000),
    href: String(data.href || '').trim().slice(0, 500),
    watchedAt: Date.now(),
  };
  await h.setJSON(`${prefix}${sha256(title)}`, entry);
  return json({ ok: true, entry }, 201);
}

async function handleChat(req) {
  const c = chat();
  if (req.method === 'GET') {
    const { blobs } = await c.list({ prefix: 'm/' });
    const selected = blobs.sort((a, b) => a.key.localeCompare(b.key)).slice(-100);
    const messages = (await Promise.all(selected.map(b => c.get(b.key, { type: 'json' })))).filter(Boolean);
    messages.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    return json({ messages });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const current = await getSessionUser(req);
  if (!current) return json({ error: 'Чтобы писать в чат, зарегистрируйтесь или войдите.' }, 401);
  const data = await bodyJson(req);
  const text = String(data.text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
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
      avatar: current.user.avatar || '🌙',
      accent: current.user.accent || '#ff395f',
    },
  };
  const key = `m/${String(createdAt).padStart(13, '0')}-${message.id}`;
  await c.setJSON(key, message);
  return json({ message }, 201);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'me';
    if (action === 'register' && req.method === 'POST') return await handleRegister(req);
    if (action === 'login' && req.method === 'POST') return await handleLogin(req);
    if (action === 'logout' && req.method === 'POST') return await handleLogout(req);
    if (action === 'me' && req.method === 'GET') return await handleMe(req);
    if (action === 'profile') return await handleProfile(req);
    if (action === 'history') return await handleHistory(req);
    if (action === 'chat') return await handleChat(req);
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    console.error('yume-api', error);
    return json({ error: 'Внутренняя ошибка сервера.' }, 500);
  }
}
