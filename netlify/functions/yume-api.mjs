import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'yume_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

// До этой правки production определялся только через process.env.CONTEXT.
// В runtime это могло быть undefined, поэтому аккаунты случайно попадали
// в deploy-specific Blobs и пропадали после следующего деплоя.
const LEGACY_DEPLOY_IDS = [
  '6a85f58b3562d00008adb6d1',
  '6a85f5a4a72ee70008d100a6',
  '6a85f5f634183a0008d994ea',
  '6a85f7c9a07a440008d8215b',
  '6a85f7ef10c56900081eba67',
];

function isProduction() {
  return globalThis.Netlify?.context?.deploy?.context === 'production'
    || process.env.CONTEXT === 'production';
}

function store(name, strong = false) {
  return isProduction()
    ? getStore(name, strong ? { consistency: 'strong' } : undefined)
    : getDeployStore(name);
}

function legacyStore(name, deployID) {
  return getDeployStore({ name, deployID });
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
  } catch (error) {
    console.warn('legacy history migration skipped', deployID, error?.message || error);
  }
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
  const indexKey = normalized.includes('@')
    ? `email/${sha256(normalized)}`
    : `username/${sha256(normalized)}`;

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
    } catch (error) {
      console.warn('legacy user lookup skipped', deployID, error?.message || error);
    }
  }
  return null;
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
    } catch (error) {
      console.warn('legacy session recovery skipped', deployID, error?.message || error);
    }
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

  if (session && Number(session.expiresAt) < Date.now()) {
    await sessionStore.delete(sessionKey);
  }

  // Автоматически подхватываем старую сессию из deploy-specific Blobs
  // и переносим аккаунт в постоянное production-хранилище.
  return await recoverLegacySession(token, sessionKey);
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

  // Если аккаунт был создан до исправления persistent storage, не даём
  // создать дубликат — старый аккаунт теперь можно просто логинить.
  if (await findLegacyUserByIdentity(email) || await findLegacyUserByIdentity(username)) {
    return json({ error: 'Этот аккаунт уже существует. Войдите со старым паролем.' }, 409);
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
  let id = await userStore.get(indexKey);
  let user = id ? await userStore.get(`u/${id}`, { type: 'json' }) : null;

  if (!user || !(await verifyPassword(password, user))) {
    // Ищем аккаунт в старых deploy-specific Blobs и сразу переносим его
    // в постоянное production-хранилище. Это чинит аккаунты, которые
    // переставали логиниться после обновления сайта.
    user = await findLegacyUserByIdentity(identity, password);
  }

  if (!user || !(await verifyPassword(password, user))) {
    return json({ error: 'Неверный логин или пароль.' }, 401);
  }

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
      } catch (error) {
        console.warn('legacy chat migration skipped', deployID, error?.message || error);
      }
    }
  })();
  return legacyChatMigrationPromise;
}

async function handleChat(req) {
  const c = chat();
  if (req.method === 'GET') {
    await migrateLegacyChat();
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
