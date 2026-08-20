const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

const PLAYER_HOSTS = [
  'yummyani.me','yani.tv','kodikplayer.com','kodik.info','kodik.biz','kodik.cc',
  'aksor.tv','cdnvideohub.com','vk.com','vkvideo.ru','rutube.ru','sibnet.ru',
  'zedfilm.ru','hlamer.ru','alloha.tv','alloha.video','alloha.club'
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, max-age=60, stale-while-revalidate=180',
  },
});

const cleanUrl = raw => {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) value = `https:${value}`;
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch { return ''; }
};

const allowedPlayerUrl = raw => {
  const value = cleanUrl(raw);
  if (!value) return '';
  try {
    const host = new URL(value).hostname.toLowerCase();
    return PLAYER_HOSTS.some(x => host === x || host.endsWith(`.${x}`)) ? value : '';
  } catch { return ''; }
};

const absolute = (raw, base) => {
  const value = String(raw || '')
    .trim()
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
  if (!value) return '';
  try { return new URL(value, base).toString(); } catch { return ''; }
};

const fetchTimeout = async (url, options = {}, timeout = 9000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally { clearTimeout(timer); }
};

const qualityNumber = label => Number(String(label || '').match(/\d+/)?.[0] || 0);
const sortQualities = input => Object.fromEntries(
  Object.entries(input || {}).filter(([,v]) => cleanUrl(v)).sort((a, b) => qualityNumber(a[0]) - qualityNumber(b[0]))
);
const bestQuality = input => Object.values(sortQualities(input || {})).at(-1) || '';
const norm = value => String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();

function studioScore(item, wanted) {
  const target = norm(wanted);
  if (!target) return 0;
  const values = [item?.voiceStudio, item?.name, item?.voiceType, item?.dubbing, item?.studio].map(norm).filter(Boolean);
  let best = 0;
  for (const value of values) {
    if (value === target) best = Math.max(best, 10);
    else if (value.includes(target) || target.includes(value)) best = Math.max(best, 7);
    else {
      const A = new Set(value.split(' ')), B = new Set(target.split(' '));
      let same = 0; for (const x of A) if (B.has(x)) same++;
      best = Math.max(best, same / Math.max(1, Math.min(A.size, B.size)) * 5);
    }
  }
  return best;
}

async function getHtml(url, referer = 'https://ru.yummyani.me/', timeout = 9000) {
  const response = await fetchTimeout(url, {
    headers: {
      'user-agent': CHROME_UA,
      'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      referer,
    },
  }, timeout);
  if (!response.ok) throw new Error(`Источник ответил ${response.status}`);
  return { html: await response.text(), response };
}

function findNestedPlayer(html, base) {
  const text = String(html || '').replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const patterns = [
    /<iframe[^>]+src=["']([^"']+)["']/ig,
    /(?:iframe_url|iframeUrl|player_url|playerUrl|playerSrc|src)\s*[:=]\s*["']([^"']+)["']/ig,
    /\.src\s*=\s*["']([^"']+)["']/ig,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const candidate = absolute(match[1], base);
      if (!candidate || candidate === base) continue;
      try {
        const host = new URL(candidate).hostname.toLowerCase();
        if (PLAYER_HOSTS.some(x => host === x || host.endsWith(`.${x}`))) return candidate;
      } catch {}
    }
  }
  return '';
}

async function generic(input, html = '') {
  const url = cleanUrl(input);
  if (!url) return null;
  if (!html) html = (await getHtml(url)).html;
  const text = String(html).replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const found = [];
  const patterns = [
    /https?:\/\/[^"'\s<>\\]+?\.m3u8(?:\?[^"'\s<>\\]*)?/gi,
    /https?:\/\/[^"'\s<>\\]+?\.mp4(?:\?[^"'\s<>\\]*)?/gi,
    /["'](?:file|src|hls|stream|url)["']\s*:\s*["']([^"']+)["']/gi,
    /(?:file|src|hls|stream)\s*[:=]\s*["']([^"']+)["']/gi,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const candidate = absolute(match[1] || match[0], url);
      if (candidate && (/\.m3u8(?:$|\?)/i.test(candidate) || /\.mp4(?:$|\?)/i.test(candidate))) found.push(candidate);
    }
  }
  const unique = [...new Set(found)];
  const stream = unique.filter(x => /\.mp4(?:$|\?)/i.test(x)).at(-1)
    || unique.filter(x => /\.m3u8(?:$|\?)/i.test(x)).at(-1)
    || unique.at(-1) || '';
  return stream ? { stream, qualities: { Auto: stream }, player: new URL(url).hostname, adFree:true } : null;
}

function decodeKodikSource(src) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (raw.includes('//')) return cleanUrl(raw);
  try {
    const rotated = raw.replace(/[a-zA-Z]/g, ch => {
      const code = ch.charCodeAt(0);
      const base = code <= 90 ? 65 : 97;
      return String.fromCharCode(((code - base + 18) % 26) + base);
    });
    const padded = rotated + '='.repeat((4 - rotated.length % 4) % 4);
    return cleanUrl(Buffer.from(padded, 'base64').toString('latin1'));
  } catch { return ''; }
}

function rewriteKodik(raw) {
  const value = cleanUrl(raw);
  if (!value) return '';
  try {
    const u = new URL(value);
    if (/^(?:www\.)?kodik\.(?:info|biz|cc)$/i.test(u.hostname) || /^(?:www\.)?kodikplayer\.com$/i.test(u.hostname)) {
      u.protocol = 'https:'; u.hostname = 'kodikplayer.com'; u.port = '';
    }
    return u.toString();
  } catch { return value; }
}

async function kodik(input) {
  const url = rewriteKodik(input);
  if (!url) return null;
  const { html, response } = await getHtml(url, 'https://ru.yummyani.me/', 10000);
  const flat = html.replace(/[\r\n]/g, ' ');
  const rawParams = flat.match(/\burlParams\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  const type = flat.match(/\b(?:videoInfo|vInfo)\.type\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  const hash = flat.match(/\b(?:videoInfo|vInfo)\.hash\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  const id = flat.match(/\b(?:videoInfo|vInfo)\.id\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';
  if (!rawParams || !type || !hash || !id) return generic(url, html);

  let params = {};
  try { params = JSON.parse(rawParams.replace(/&quot;/g, '"')); } catch {}
  const scriptSrc = flat.match(/src=['"]((?:(?:https?:)?\/\/[^'"]+)?\/assets\/js\/app\.player_single[^'"]+)['"]/)?.[1] || '';
  const scriptUrl = absolute(scriptSrc, url);
  let endpoint = '/ftor';
  if (scriptUrl) {
    try {
      const r = await fetchTimeout(scriptUrl, { headers:{'user-agent':CHROME_UA, referer:url} }, 7000);
      if (r.ok) {
        const script = await r.text();
        for (const match of script.matchAll(/atob\(['"]([A-Za-z0-9+/=]+)['"]\)/g)) {
          try {
            const decoded = Buffer.from(match[1], 'base64').toString('utf8');
            if (/^\/[a-z0-9_-]{1,12}$/i.test(decoded)) { endpoint = decoded; break; }
          } catch {}
        }
      }
    } catch {}
  }

  const body = new URLSearchParams();
  for (const key of ['d','d_sign','pd','pd_sign','ref','ref_sign']) if (params?.[key] != null) body.set(key, String(params[key]));
  body.set('bad_user','true'); body.set('cdn_is_working','true'); body.set('type',type); body.set('hash',hash); body.set('id',id); body.set('info','{}');
  const endpointUrl = new URL(endpoint, scriptUrl || url).toString();
  const cookies = response.headers.get('set-cookie') || '';
  const post = await fetchTimeout(endpointUrl, {
    method:'POST',
    headers:{
      'user-agent':CHROME_UA, referer:url, origin:new URL(endpointUrl).origin,
      'content-type':'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with':'XMLHttpRequest',
      ...(cookies ? {cookie:cookies} : {}),
    }, body,
  }, 10000);
  if (!post.ok) throw new Error(`Kodik stream ${post.status}`);
  const data = await post.json().catch(() => null);
  const qualities = {};
  for (const [label, list] of Object.entries(data?.links || {})) {
    const src = Array.isArray(list) ? list[0]?.src : list?.src;
    const resolved = decodeKodikSource(src);
    if (resolved) qualities[`${String(label).replace(/p$/i,'')}p`] = resolved;
  }
  const sorted = sortQualities(qualities), stream = bestQuality(sorted);
  return stream ? {stream, qualities:sorted, player:'Kodik', adFree:true} : null;
}

function replaceHostIfIp(raw, failoverHost) {
  const url = cleanUrl(raw);
  if (!url || !failoverHost) return url;
  try {
    const u = new URL(url);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname)) u.hostname = failoverHost;
    return u.toString();
  } catch { return url; }
}

function parseCvhRuntime(script, html = '') {
  const text = `${String(html || '')}\n${String(script || '')}`;
  const pub = text.match(/["']data-publisher-id["']\s*:\s*["']?(\d+)/i)?.[1]
    || text.match(/data-publisher-id=["'](\d+)/i)?.[1] || '';
  const aggr = text.match(/["']data-aggregator["']\s*:\s*["']([^"']+)/i)?.[1]
    || text.match(/data-aggregator=["']([^"']+)/i)?.[1] || '';
  return { pub, aggr };
}

async function cvhRuntime(input) {
  let html = '', script = '';
  try {
    const loaded = await getHtml(input, 'https://ru.yummyani.me/', 8000);
    html = loaded.html;
    const scriptSrc = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1]
      || html.match(/<script[^>]+src=["']([^"']+)["'][^>]+type=["']module["']/i)?.[1]
      || '';
    const scriptUrl = absolute(scriptSrc, input);
    if (scriptUrl) {
      const r = await fetchTimeout(scriptUrl, { headers:{'user-agent':CHROME_UA, referer:input, accept:'*/*'} }, 8000);
      if (r.ok) script = await r.text();
    }
  } catch {}
  return { ...parseCvhRuntime(script, html), html };
}

function pickCvhItem(rows, episode, wanted) {
  const eps = rows.filter(x => Number(x?.episode) === Number(episode));
  if (!eps.length) return null;
  if (!wanted) return eps[0];
  return [...eps].sort((a,b) => studioScore(b,wanted) - studioScore(a,wanted))[0] || eps[0];
}

async function cvh(input, wantedName = '', episodeHint = '') {
  const url = cleanUrl(input);
  if (!url) return null;
  const u = new URL(url);
  const anime = u.searchParams.get('anime_id') || u.searchParams.get('id') || '';
  const episode = Number(u.searchParams.get('episode') || episodeHint || 1);
  const wanted = u.searchParams.get('dubbing_code') || u.searchParams.get('dubbing') || wantedName || '';
  if (!anime) return null;

  const runtime = await cvhRuntime(url);
  const variants = [];
  const pushVariant = (pub, aggr) => { if (pub && aggr && !variants.some(x => x.pub===pub && x.aggr===aggr)) variants.push({pub,aggr}); };
  pushVariant(runtime.pub, runtime.aggr);
  pushVariant('745','mali');

  const headers = { 'user-agent':CHROME_UA, accept:'application/json, text/plain, */*', referer:url, origin:new URL(url).origin };
  let lastError = null;
  for (const cfg of variants) {
    try {
      const endpoint = new URL('https://plapi.cdnvideohub.com/api/v1/player/sv/playlist');
      endpoint.searchParams.set('pub', cfg.pub); endpoint.searchParams.set('id', anime); endpoint.searchParams.set('aggr', cfg.aggr);
      const playlist = await fetchTimeout(endpoint, {headers}, 9000);
      if (!playlist.ok) throw new Error(`CVH playlist ${playlist.status}`);
      const payload = await playlist.json();
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      const item = pickCvhItem(rows, episode, wanted);
      if (!item?.vkId) throw new Error(`CVH: серия ${episode} / ${wanted || 'озвучка'} не найдена`);

      const videoEndpoint = `https://plapi.cdnvideohub.com/api/v1/player/sv/video/${encodeURIComponent(item.vkId)}`;
      const videoResponse = await fetchTimeout(videoEndpoint, {headers}, 9000);
      if (!videoResponse.ok) throw new Error(`CVH video ${videoResponse.status}`);
      const video = await videoResponse.json();
      const sources = video?.sources || {};
      const failoverHost = String(video?.failoverHost || '').trim();
      const qualities = {};
      for (const [label, key] of [
        ['240p','mpegLowestUrl'],['360p','mpegLowUrl'],['480p','mpegMediumUrl'],['720p','mpegHighUrl'],
        ['1080p','mpegFullHdUrl'],['1440p','mpegQhdUrl'],['2K','mpeg2kUrl'],['4K','mpeg4kUrl']
      ]) {
        const source = replaceHostIfIp(sources?.[key], failoverHost);
        if (source) qualities[label] = source;
      }
      let sorted = sortQualities(qualities), stream = bestQuality(sorted);
      if (!stream) {
        const hls = replaceHostIfIp(sources?.hlsUrl, failoverHost);
        if (hls) { sorted = {Auto:hls}; stream = hls; }
      }
      if (stream) {
        return {
          stream, qualities:sorted, player:'CVH', adFree:true,
          matchedStudio:String(item?.voiceStudio || item?.name || wanted || ''),
          episode:Number(item?.episode || episode), publisher:cfg.pub, aggregator:cfg.aggr,
        };
      }
      throw new Error('CVH не вернул видеопоток');
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('CVH недоступен');
}

async function aksor(input) {
  const url = cleanUrl(input); if (!url) return null;
  const u = new URL(url), parts = u.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('video'), hash = (idx >= 0 ? parts[idx+1] : parts.at(-1)) || '';
  if (!hash) return null;
  const headers = {'user-agent':CHROME_UA, referer:url, accept:'application/json'};
  let data = null;
  try { const r = await fetchTimeout(`https://player.aksor.tv/api/video/${encodeURIComponent(hash)}`,{headers},8000); if (r.ok) data=await r.json(); } catch {}
  const qualities = {};
  for (const [key,label] of [['q360','360p'],['q480','480p'],['q720','720p'],['q1080','1080p'],['q2k','2K'],['q4k','4K']]) {
    const src = cleanUrl(String(data?.qualities?.[key] || '').replace(/ /g,'%20')); if (src) qualities[label]=src;
  }
  const sorted=sortQualities(qualities), stream=bestQuality(sorted);
  if (stream) return {stream,qualities:sorted,player:'Aksor',adFree:true};
  const {html}=await getHtml(url,'https://ru.yummyani.me/',8000);
  const meta=html.match(/<meta[^>]+name=["']video_url["'][^>]+content=["']([^"']+)["']/i)?.[1]||'';
  const direct=cleanUrl(meta.replace(/ /g,'%20'));
  return direct ? {stream:direct,qualities:{Auto:direct},player:'Aksor',adFree:true} : generic(url,html);
}

async function vk(input) {
  const url=cleanUrl(input); if(!url)return null;
  const {html}=await getHtml(url,'https://ru.yummyani.me/',8000); const qualities={};
  for(const number of [144,240,360,480,720,1080,1440,2160]){
    const raw=html.match(new RegExp(`["']?url${number}["']?\\s*[:=]\\s*["']([^"']+)`,'i'))?.[1];
    const src=absolute(raw,url); if(src)qualities[`${number}p`]=src;
  }
  const sorted=sortQualities(qualities),stream=bestQuality(sorted);
  return stream?{stream,qualities:sorted,player:'VK',adFree:true}:generic(url,html);
}

async function rutube(input) {
  const url=cleanUrl(input); if(!url)return null;
  const u=new URL(url); const id=u.pathname.split('/').filter(Boolean).find(x=>/^[a-f0-9]{16,}$/i.test(x))||u.searchParams.get('id')||'';
  if(!id)return null;
  const r=await fetchTimeout(`https://rutube.ru/api/play/options/${encodeURIComponent(id)}/?format=json`,{headers:{'user-agent':CHROME_UA,referer:url,accept:'application/json'}},9000);
  if(!r.ok)throw new Error(`Rutube ${r.status}`); const data=await r.json();
  const stream=cleanUrl(data?.video_balancer?.m3u8||data?.video_balancer?.default||'');
  return stream?{stream,qualities:{Auto:stream},player:'Rutube',adFree:true}:null;
}

async function sibnet(input) {
  const url=cleanUrl(input); if(!url)return null;
  const {html}=await getHtml(url,'https://ru.yummyani.me/',8000);
  const raw=html.match(/player\.src\s*\(\s*\[?\s*\{[^}]*src\s*:\s*["']([^"']+)/i)?.[1]
    ||html.match(/(?:video_src|file)\s*[:=]\s*["']([^"']+)/i)?.[1]||'';
  const stream=absolute(raw,url);
  return stream?{stream,qualities:{Auto:stream},player:'Sibnet',adFree:true}:generic(url,html);
}

async function unwrapYummy(input) {
  const url=cleanUrl(input); if(!url)return'';
  let host=''; try{host=new URL(url).hostname.toLowerCase();}catch{}
  if(!host.includes('yummyani.me')&&!host.includes('yani.tv'))return url;
  const lowerPath=new URL(url).pathname.toLowerCase();
  if(lowerPath.includes('iframecvh'))return url;
  const {html}=await getHtml(url,'https://ru.yummyani.me/',8000);
  const nested=findNestedPlayer(html,url); if(nested)return nested;
  const direct=await generic(url,html); if(direct?.stream)return direct.stream;
  return url;
}

async function resolve(input, hint='', wantedName='', episodeHint='', depth=0) {
  let url=cleanUrl(input); if(!url)return null;
  if(/\.(?:m3u8|mp4)(?:$|\?)/i.test(url))return{stream:url,qualities:{Auto:url},player:'Direct',adFree:true};
  if(depth>3)return null;
  const original=url, hintLower=String(hint||'').toLowerCase();
  const host=new URL(url).hostname.toLowerCase();
  if(/yummyani\.me|yani\.tv/i.test(host)){
    const unwrapped=await unwrapYummy(url);
    if(/\.(?:m3u8|mp4)(?:$|\?)/i.test(unwrapped))return{stream:unwrapped,qualities:{Auto:unwrapped},player:hint||'Direct',adFree:true};
    if(unwrapped&&unwrapped!==url)url=unwrapped;
  }
  const lower=url.toLowerCase();
  if(lower.includes('iframecvh')||hintLower.includes('cvh')||hintLower.includes('cdnvideohub'))return cvh(url,wantedName,episodeHint);
  if(lower.includes('aksor.tv')||hintLower.includes('aksor'))return aksor(url);
  if(lower.includes('kodik')||hintLower.includes('kodik'))return kodik(url);
  if(lower.includes('vk.com')||lower.includes('vkvideo')||lower.includes('video_ext.php')||lower.includes('iframevk')||hintLower==='vk')return vk(url);
  if(lower.includes('rutube.ru')||hintLower.includes('rutube'))return rutube(url);
  if(lower.includes('sibnet.ru')||hintLower.includes('sibnet'))return sibnet(url);
  if(lower.includes('zedfilm')||lower.includes('hlamer')||hintLower.includes('zedfilm'))return generic(url);
  const genericResult=await generic(url).catch(()=>null); if(genericResult?.stream)return genericResult;
  if(url!==original)return resolve(url,hint,wantedName,episodeHint,depth+1);
  return null;
}

export default async request => {
  const requestUrl=new URL(request.url);
  const sourceRaw=requestUrl.searchParams.get('url')||'';
  const hint=requestUrl.searchParams.get('player')||'';
  const wantedName=requestUrl.searchParams.get('name')||'';
  const episode=requestUrl.searchParams.get('episode')||'';
  const source=allowedPlayerUrl(sourceRaw);
  if(!source)return json({error:'Недопустимый или неизвестный источник.'},400);
  try{
    const result=await resolve(source,hint,wantedName,episode);
    if(!result?.stream)return json({error:'Этот источник не отдал прямой поток.',source,adFree:true},422);
    return json({ok:true,stream:result.stream,qualities:sortQualities(result.qualities||{}),player:result.player||hint||'',source,adFree:true,matchedStudio:result.matchedStudio||'',episode:result.episode||episode||'',debug:{publisher:result.publisher||'',aggregator:result.aggregator||''}});
  }catch(error){
    return json({error:error?.name==='AbortError'?'Источник не ответил вовремя.':String(error?.message||error||'Ошибка источника.'),source,adFree:true},502);
  }
};
