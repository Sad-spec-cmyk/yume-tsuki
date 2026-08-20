function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' },
  });
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/ё/g,'е').replace(/[’'`]/g,'').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
}
function unique(values) { return [...new Set((values || []).map(x=>String(x||'').trim()).filter(Boolean))]; }
function tokens(value) { return new Set(normalize(value).split(' ').filter(x=>x.length>1)); }
function similarity(a,b) {
  const A=tokens(a), B=tokens(b); if(!A.size||!B.size)return 0;
  let same=0; for(const x of A) if(B.has(x)) same++;
  return same/Math.max(1,Math.min(A.size,B.size));
}
async function safeFetch(url, options={}, timeout=9000) {
  return fetch(url,{redirect:'follow',...options,signal:AbortSignal.timeout(timeout)});
}
function decodeHtml(value) {
  return String(value||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&laquo;/gi,'«').replace(/&raquo;/gi,'»').replace(/&ndash;/gi,'–').replace(/&mdash;/gi,'—').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function htmlLines(html) {
  return decodeHtml(String(html||'').replace(/<script[\s\S]*?<\/script>/gi,'\n').replace(/<style[\s\S]*?<\/style>/gi,'\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/li>|<\/div>|<\/button>|<\/a>|<\/span>|<\/h\d>/gi,'\n').replace(/<[^>]+>/g,'\n')).split(/\n+/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function slugifyRu(value) {
  const m={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
  return String(value||'').toLowerCase().split('').map(ch=>m[ch]??ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,180);
}

async function jikan(query, year) {
  if(!query)return {titles:[],ids:[]};
  try {
    const u=new URL('https://api.jikan.moe/v4/anime'); u.searchParams.set('q',query); u.searchParams.set('limit','10');
    const r=await safeFetch(u,{headers:{accept:'application/json','user-agent':'YumeTsuki/1.0'}},8000); if(!r.ok)return {titles:[],ids:[]};
    const d=await r.json(), rows=Array.isArray(d?.data)?d.data:[];
    const variants=[query], ranked=[];
    for(const x of rows){
      const ts=unique([x?.title,x?.title_english,x?.title_japanese,...(x?.title_synonyms||[]),...(x?.titles||[]).map(t=>t?.title)]); variants.push(...ts);
      let score=Math.max(...ts.map(t=>similarity(query,t)),0); const y=String(x?.year||x?.aired?.from||'').match(/(?:19|20)\d{2}/)?.[0]||''; if(year&&y===year)score+=.3; if(year&&y&&y!==year)score-=.25;
      ranked.push({id:String(x?.mal_id||''),score,titles:ts});
    }
    ranked.sort((a,b)=>b.score-a.score);
    return {titles:unique(variants),ids:unique(ranked.filter(x=>x.id&&x.score>=.35).map(x=>x.id)).slice(0,8)};
  } catch { return {titles:[],ids:[]}; }
}

async function shikimoriIds(query, variants, year) {
  try {
    const u=new URL('https://shikimori.one/api/animes'); u.searchParams.set('search',query); u.searchParams.set('limit','12');
    const r=await safeFetch(u,{headers:{accept:'application/json','user-agent':'YumeTsuki/1.0'}},8000); if(!r.ok)return [];
    const rows=await r.json();
    return (Array.isArray(rows)?rows:[]).map(x=>{
      let s=Math.max(...unique([x?.name,x?.russian]).flatMap(t=>variants.map(v=>similarity(t,v))),0);
      const y=String(x?.aired_on||'').slice(0,4); if(year&&y===year)s+=.25; if(year&&y&&y!==year)s-=.25;
      return {id:String(x?.id||''),score:s,russian:x?.russian||''};
    }).filter(x=>x.id&&x.score>=.35).sort((a,b)=>b.score-a.score).slice(0,8);
  } catch { return []; }
}

function parseAnimeOn(html, pageUrl) {
  const lines=htmlLines(html); let start=lines.findIndex(x=>/^Озвучка\s*\d*/i.test(x)); if(start<0)start=lines.findIndex(x=>/^Озвучки$/i.test(x)); if(start<0)return [];
  const out=[]; const ignore=/^(Озвучка|Озвучки|Поиск студии|Звезда слева.*|AnimeOn|Смотреть|В список|Поделиться|В подборку|№)$/i;
  for(let i=start+1;i<Math.min(lines.length,start+100);i++){
    const raw=lines[i]; if(/^(Комментарии|Новые|Войдите|Студия|Кадры|Сюжет)$/i.test(raw))break; if(!raw||ignore.test(raw)||/поиск|любим/i.test(raw))continue;
    if(/^\d+(?:[.,]\d+)?[KКМ]?$/i.test(raw)||/^\d+\s*\/\s*\d+$/.test(raw)||raw.length>100)continue;
    const name=raw.replace(/\s+\d+(?:[.,]\d+)?(?:\s+\d+)?\s*$/,'').trim(); if(!name||name.length<2||/^\d/.test(name)||name.split(' ').length>10)continue;
    if(out.some(x=>normalize(x.name)===normalize(name)))continue;
    const subtitles=/sub(title|titles)|субтитр/i.test(name);
    out.push({id:`animeon-${normalize(name).replace(/\s+/g,'-').slice(0,70)}`,source:'AnimeOn',name,translationType:subtitles?'subtitles':'voice',externalPage:pageUrl,catalogOnly:true});
  }
  return out.slice(0,60);
}

async function animeOnById(id, russianTitle, variants) {
  const url=`https://animeon.cc/anime/${slugifyRu(russianTitle)||'anime'}-${encodeURIComponent(id)}`;
  try {
    const r=await safeFetch(url,{headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 YumeTsuki/1.0'}},10000); if(!r.ok)return {providers:[],url:'',status:r.status};
    const html=await r.text(); const lines=htmlLines(html); const titleOk=lines.some(line=>variants.some(v=>similarity(line,v)>=.68)); if(!titleOk&&!/Озвучк/i.test(html))return {providers:[],url:'',status:200};
    return {providers:parseAnimeOn(html,r.url||url),url:r.url||url,status:200};
  } catch { return {providers:[],url:'',status:0}; }
}

async function collectAnimeOn(ids, russianTitle, variants) {
  for(const id of ids.slice(0,5)){ const r=await animeOnById(id,russianTitle,variants); if(r.providers.length)return r; }
  return {providers:[],url:'',status:0};
}

function extractLinks(html,base) {
  const out=[]; const re=/href\s*=\s*["']([^"'#]+)["']/gi; let m;
  while((m=re.exec(html))){try{const u=new URL(decodeHtml(m[1]),base); if(u.hostname==='anilibria.media')out.push(u.toString());}catch{}}
  return unique(out);
}
function parseAniLibriaMedia(html,pageUrl) {
  const lines=htmlLines(html); const start=lines.findIndex(x=>/^Озвучка\s*:/i.test(x)); if(start<0)return [];
  const names=[]; const first=lines[start].replace(/^Озвучка\s*:\s*/i,'').trim(); if(first)names.push(...first.split(/\s*,\s*/));
  for(let i=start+1;i<Math.min(lines.length,start+20);i++){const x=lines[i]; if(/^(Другие названия|Про что аниме|Смотреть аниме|Тип|Эпизоды|Статус|Жанры|Выпуск|Сезон)\s*:?/i.test(x))break; if(x.length<90&&!/^\d/.test(x))names.push(...x.split(/\s*,\s*/));}
  return unique(names).filter(x=>x&&x.length<80).map(name=>({id:`anilibriamedia-${normalize(name).replace(/\s+/g,'-').slice(0,70)}`,source:'AniLibria.media',name,translationType:/sub(title|titles)|субтитр/i.test(name)?'subtitles':'voice',externalPage:pageUrl,catalogOnly:true}));
}

async function collectAniLibriaMedia(primary,variants) {
  const q=encodeURIComponent(primary); const searches=[`https://anilibria.media/index.php?do=search&subaction=search&story=${q}`,`https://anilibria.media/?do=search&subaction=search&story=${q}`,`https://anilibria.media/search/?q=${q}`];
  for(const searchUrl of searches){
    try{
      const r=await safeFetch(searchUrl,{headers:{accept:'text/html','user-agent':'Mozilla/5.0 YumeTsuki/1.0'}},8000); if(!r.ok)continue; const html=await r.text();
      const links=extractLinks(html,r.url||searchUrl).filter(x=>!/(\/catalog|\/search|\/login|\/register|\/genre)/i.test(x));
      for(const link of links.slice(0,15)){
        const label=decodeURIComponent(link).replace(/[-_/]+/g,' '); if(!variants.some(v=>similarity(label,v)>=.25))continue;
        try{const p=await safeFetch(link,{headers:{accept:'text/html','user-agent':'Mozilla/5.0 YumeTsuki/1.0'}},7000); if(!p.ok)continue; const body=await p.text(); const providers=parseAniLibriaMedia(body,p.url||link); if(providers.length)return {providers,url:p.url||link};}catch{}
      }
    }catch{}
  }
  return {providers:[],url:''};
}

function merge(groups) {
  const map=new Map();
  for(const p of groups.flat()){
    const kind=p.translationType==='subtitles'?'subtitles':'voice'; const key=`${kind}:${normalize(p.name)}`; if(!key||key.endsWith(':'))continue;
    if(!map.has(key))map.set(key,{...p,sources:[p.source]}); else {const x=map.get(key); x.sources=unique([...(x.sources||[]),p.source]); if(!x.externalPage&&p.externalPage)x.externalPage=p.externalPage;}
  }
  return [...map.values()].sort((a,b)=>a.translationType.localeCompare(b.translationType)||a.name.localeCompare(b.name,'ru')).slice(0,80);
}

export default async request => {
  const u=new URL(request.url); if(request.method!=='GET')return json({error:'Method not allowed'},405);
  const title=String(u.searchParams.get('title')||'').trim().slice(0,180); const year=String(u.searchParams.get('year')||'').trim().slice(0,8); const alternates=String(u.searchParams.get('titles')||'').split('|').map(x=>x.trim()).filter(Boolean).slice(0,10); if(!title)return json({error:'Не указано название.'},400);
  try{
    const jk=await jikan(title,year); const variants=unique([title,...alternates,...jk.titles]).slice(0,35); const sh=await shikimoriIds(title,variants,year); const ids=unique([...sh.map(x=>x.id),...jk.ids]); const russian=unique([title,...sh.map(x=>x.russian)]).find(x=>/[а-яё]/i.test(x))||title;
    const [animeon,media]=await Promise.all([collectAnimeOn(ids,russian,variants),collectAniLibriaMedia(title,variants)]); const providers=merge([animeon.providers,media.providers]);
    return json({providers,count:providers.length,matchedIds:ids,diagnostics:{animeon:{found:animeon.providers.length,page:animeon.url||''},anilibriamedia:{found:media.providers.length,page:media.url||''}}});
  }catch(error){console.error('provider-catalogs',error);return json({providers:[],count:0,error:'Каталоги озвучек временно недоступны.',diagnostics:{message:String(error?.message||error)}});}
};
