(() => {
  if (window.__YUME_FEDERATED_CATALOG_V16) return;
  window.__YUME_FEDERATED_CATALOG_V16 = true;

  const nativeFetch = window.fetch.bind(window);
  const cache = new Map();
  const norm = v => String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();

  function urlOf(input){ try{return typeof input==='string'?input:input?.url||''}catch{return''} }
  function listOf(data){ return Array.isArray(data)?data:(Array.isArray(data?.data)?data.data:(Array.isArray(data?.items)?data.items:[])); }
  function titleOf(a){ return a?.name?.main || a?.name?.english || a?.title || ''; }
  function remember(a){ if(!a?._federated||!a?.id)return; cache.set(String(a.id),a); const k=norm(titleOf(a)); if(k&&!cache.has(`title:${k}`))cache.set(`title:${k}`,a); }
  function response(data,status=200){ return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}}); }

  function parseAniPath(rawUrl){
    try{
      const u=new URL(rawUrl,location.href);
      if(!u.pathname.includes('/.netlify/functions/aniliberty'))return null;
      return decodeURIComponent(u.searchParams.get('path')||'');
    }catch{return null}
  }

  function parseCatalog(path){
    try{
      const u=new URL(path,'https://yume.local');
      if(u.pathname!=='/anime/catalog/releases')return null;
      return {
        q:u.searchParams.get('f[search]')||'',
        page:u.searchParams.get('page')||'1',
        limit:u.searchParams.get('limit')||'36',
        sorting:u.searchParams.get('f[sorting]')||'FRESH_AT_DESC',
      };
    }catch{return null}
  }

  function merge(nativeList, extraList, limit=72){
    const out=[],seen=new Set();
    for(const a of [...nativeList,...extraList]){
      const key=norm(titleOf(a)) || String(a?.id||'');
      if(!key||seen.has(key))continue;
      seen.add(key); if(a?._federated)remember(a); out.push(a);
      if(out.length>=limit)break;
    }
    return out;
  }

  async function externalCatalog(info){
    const qs=new URLSearchParams({q:info.q,page:info.page,limit:info.limit,sorting:info.sorting,_:String(Date.now())});
    const r=await nativeFetch(`/.netlify/functions/catalog-all?${qs}`,{headers:{accept:'application/json'},cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    return r.ok&&Array.isArray(data?.items)?data.items:[];
  }

  window.fetch = async (...args) => {
    const raw=urlOf(args[0]); const path=parseAniPath(raw);
    if(!path)return nativeFetch(...args);

    const releaseMatch=path.match(/^\/anime\/releases\/([^?]+)/);
    if(releaseMatch){
      const key=decodeURIComponent(releaseMatch[1]);
      const found=cache.get(key);
      if(found)return response({data:found});
    }

    const catalog=parseCatalog(path);
    if(!catalog)return nativeFetch(...args);

    const [nativeResult,extra] = await Promise.all([
      nativeFetch(...args).then(async r=>({r,data:await r.clone().json().catch(()=>({}))})).catch(()=>({r:null,data:{}})),
      externalCatalog(catalog).catch(()=>[]),
    ]);
    const nativeList=listOf(nativeResult.data);
    const combined=merge(nativeList,extra,Math.max(72,Number(catalog.limit||36)*2));
    if(combined.length)return response({data:combined,meta:{federated:true,native:nativeList.length,external:extra.length}});
    if(nativeResult.r)return nativeResult.r;
    return response({data:[]});
  };

  // Browse's old modal player can only play AniLiberty episodes. For a federated-only title,
  // route the Watch button to the normal anime page where the multi-source episode resolver runs.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('#watchBtn'); if(!button)return;
    const title=document.querySelector('#modalTitle')?.textContent?.trim()||'';
    const external=cache.get(`title:${norm(title)}`);
    if(!external)return;
    event.preventDefault(); event.stopImmediatePropagation();
    location.href=`/anime?q=${encodeURIComponent(title)}`;
  },true);
})();
