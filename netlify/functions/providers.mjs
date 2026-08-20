function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120, stale-while-revalidate=600' },
  });
}

const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const playerUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
};

async function discoverPublicToken() {
  const configured = Netlify.env.get('KODIK_TOKEN');
  if (configured) return configured;
  const response = await fetch('https://kodik-add.com/add-players.min.js?v=2', {
    headers: { accept: 'text/javascript,*/*;q=0.8', 'user-agent': 'YumeTsuki/1.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Kodik token script ${response.status}`);
  const script = await response.text();
  const token = script.match(/token\s*[=:]\s*["']([0-9a-f]+)["']/i)?.[1];
  if (!token) throw new Error('Kodik public token not found');
  return token;
}

async function kodikSearch(title, year) {
  const token = await discoverPublicToken();
  const params = new URLSearchParams({ token, title, limit: '50', with_material_data: 'true' });
  const response = await fetch(`https://kodik-api.com/search?${params}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'user-agent': 'YumeTsuki/1.0' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Kodik API ${response.status}`);
  const data = await response.json();
  const wanted = normalize(title);
  const items = Array.isArray(data?.results) ? data.results : [];

  const scored = items.map(item => {
    const titles = [item?.title, item?.title_orig, item?.other_title, item?.material_data?.title, item?.material_data?.title_en].filter(Boolean);
    const exact = titles.some(x => normalize(x) === wanted);
    const contains = titles.some(x => normalize(x).includes(wanted) || wanted.includes(normalize(x)));
    const yearMatch = !year || !item?.year || String(item.year) === String(year);
    return { item, score: (exact ? 100 : contains ? 60 : 0) + (yearMatch ? 20 : 0) };
  }).filter(x => x.score >= 60).sort((a,b) => b.score - a.score);

  const seen = new Set();
  const providers = [];
  for (const { item } of scored) {
    const link = playerUrl(item?.link);
    if (!link) continue;
    const translation = item?.translation || {};
    const name = String(translation?.title || 'Kodik').trim();
    const type = String(translation?.type || '').toLowerCase();
    if (type && type !== 'voice') continue;
    const key = `${translation?.id || name.toLowerCase()}|${link}`;
    if (seen.has(key)) continue;
    seen.add(key);
    providers.push({
      id: `kodik-${translation?.id || providers.length + 1}`,
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
    if (providers.length >= 18) break;
  }
  return providers;
}

export default async request => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const title = String(url.searchParams.get('title') || '').trim().slice(0, 180);
  const year = String(url.searchParams.get('year') || '').trim().slice(0, 8);
  if (!title) return json({ error: 'Не указано название аниме.' }, 400);
  try {
    const providers = await kodikSearch(title, year);
    return json({ providers, source: 'Kodik', count: providers.length });
  } catch (error) {
    console.error('providers', error);
    return json({ providers: [], source: 'Kodik', count: 0, error: 'Kodik временно недоступен.' }, 200);
  }
};
