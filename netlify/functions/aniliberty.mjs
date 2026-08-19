const API_BASES = [
  'https://api.anilibria.app/api/v1',
  'https://aniliberty.top/api/v1'
];

export default async (request) => {
  const url = new URL(request.url);
  const rawPath = url.searchParams.get('path') || '';

  if (!rawPath.startsWith('/anime/')) {
    return new Response(JSON.stringify({ error: 'Invalid API path' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  let lastStatus = 502;
  let lastText = JSON.stringify({ error: 'AniLiberty API unavailable' });

  for (const base of API_BASES) {
    try {
      const upstream = await fetch(`${base}${rawPath}`, {
        headers: {
          'accept': 'application/json',
          'user-agent': 'YumeAnime/1.0'
        },
        signal: AbortSignal.timeout(12000)
      });
      const text = await upstream.text();
      if (upstream.ok) {
        return new Response(text, {
          status: upstream.status,
          headers: {
            'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
            'cache-control': rawPath.includes('/catalog/') ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=30, stale-while-revalidate=120'
          }
        });
      }
      lastStatus = upstream.status;
      lastText = text || lastText;
    } catch (error) {
      lastStatus = 502;
      lastText = JSON.stringify({ error: error?.message || 'Upstream request failed' });
    }
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
};
