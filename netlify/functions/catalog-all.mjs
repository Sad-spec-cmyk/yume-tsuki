const UA = 'YumeTsuki/1.0 (federated catalog)';
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=180, stale-while-revalidate=600'}});
const fetchJson = async (url, ms=9000) => {
  const r = await fetch(url, {headers:{accept:'application/json','user-agent':UA}, signal:AbortSignal.timeout(ms)});
  if(!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`);
  return r.json();
};
const first = (...xs) => xs.map(x=>String(x??'').trim()).find(Boolean) || '';
const yearFrom = value => Number(String(value||'').match(/(?:19|20)\d{2}/)?.[0] || 0) || '';

function jikanItem(a){
  const title = first(a?.title_english, a?.title, a?.title_japanese);
  return {
    id:`federated-jikan-${a?.mal_id || encodeURIComponent(title)}`,
    _federated:true, source:'Jikan',
    name:{main:title, english:first(a?.title, a?.title_english), alternative:first(a?.title_japanese)},
    title,
    year:a?.year || yearFrom(a?.aired?.from),
    type:{description:first(a?.type,'Аниме')},
    poster:{src:first(a?.images?.webp?.large_image_url,a?.images?.webp?.image_url,a?.images?.jpg?.large_image_url,a?.images?.jpg?.image_url)},
    description:first(a?.synopsis,a?.background),
    genres:[...(a?.genres||[]),...(a?.themes||[])].map(x=>({name:first(x?.name)})).filter(x=>x.name),
    episodes_total:a?.episodes ?? null,
    added_in_users_favorites:a?.favorites ?? a?.members ?? null,
    is_ongoing:!!a?.airing,
    age_rating:{label:first(a?.rating)},
    episodes:[],
  };
}

function shikiItem(a){
  const title = first(a?.russian, a?.name);
  const image = first(a?.image?.original,a?.image?.preview,a?.image?.x96);
  return {
    id:`federated-shiki-${a?.id || encodeURIComponent(title)}`,
    _federated:true, source:'Shikimori',
    name:{main:title, english:first(a?.name), alternative:''},
    title,
    year:yearFrom(a?.aired_on || a?.released_on),
    type:{description:first(a?.kind,'Аниме').toUpperCase()},
    poster:{src:image ? new URL(image,'https://shikimori.one/').toString() : ''},
    description:'',
    genres:[],
    episodes_total:a?.episodes || a?.episodes_aired || null,
    added_in_users_favorites:null,
    is_ongoing:String(a?.status||'').toLowerCase()==='ongoing',
    age_rating:{label:first(a?.rating)},
    episodes:[],
  };
}

async function collectJikan(q,page,sort){
  const u = new URL('https://api.jikan.moe/v4/anime');
  u.searchParams.set('sfw','true'); u.searchParams.set('limit','25'); u.searchParams.set('page',String(page));
  if(q) u.searchParams.set('q',q);
  if(sort==='popular'){u.searchParams.set('order_by','popularity');u.searchParams.set('sort','asc');}
  else {u.searchParams.set('order_by','start_date');u.searchParams.set('sort','desc');}
  const data = await fetchJson(u);
  return (Array.isArray(data?.data)?data.data:[]).map(jikanItem).filter(x=>x.name.main);
}

async function collectShikimori(q,page,sort){
  const u = new URL('https://shikimori.one/api/animes');
  u.searchParams.set('limit','50'); u.searchParams.set('page',String(page));
  u.searchParams.set('order',sort==='popular'?'popularity':'aired_on');
  if(q) u.searchParams.set('search',q);
  const data = await fetchJson(u);
  return (Array.isArray(data)?data:[]).map(shikiItem).filter(x=>x.name.main);
}

export default async request => {
  const u = new URL(request.url);
  const q = first(u.searchParams.get('q'),u.searchParams.get('search'));
  const page = Math.max(1,Number(u.searchParams.get('page')||1)||1);
  const rawSort = first(u.searchParams.get('sort'),u.searchParams.get('sorting')).toLowerCase();
  const sort = rawSort.includes('popular') || rawSort === '1' ? 'popular' : 'fresh';
  const [jikan,shiki] = await Promise.allSettled([collectJikan(q,page,sort),collectShikimori(q,page,sort)]);
  const items = [
    ...(jikan.status==='fulfilled'?jikan.value:[]),
    ...(shiki.status==='fulfilled'?shiki.value:[]),
  ];
  if(!items.length && jikan.status==='rejected' && shiki.status==='rejected'){
    return json({error:'Дополнительные каталоги временно недоступны.',items:[],diagnostics:{jikan:String(jikan.reason?.message||jikan.reason),shikimori:String(shiki.reason?.message||shiki.reason)}},502);
  }
  return json({ok:true,items,sources:['Jikan','Shikimori'].filter((s,i)=>[jikan,shiki][i].status==='fulfilled'),page,q,sort});
};
