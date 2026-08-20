import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';
const sha256=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const clean=v=>String(v||'').trim().toLowerCase();
function isProduction(){const c=globalThis.Netlify?.context?.deploy?.context||process.env.CONTEXT||'';if(c)return c==='production';const b=process.env.BRANCH||'',p=process.env.PRODUCTION_BRANCH||'main';return Boolean(b&&b===p&&process.env.SITE_ID);}
function store(name,strong=false){return isProduction()?getStore(name,strong?{consistency:'strong'}:undefined):getDeployStore(name);}
const users=()=>store('yume-users',true),history=()=>store('yume-history',true);
const num=v=>Math.max(0,Number(v)||0);
const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
export default async request=>{
  if(request.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    const url=new URL(request.url),username=clean(url.searchParams.get('username'));if(!username)return json({error:'Укажите username.'},400);
    const us=users(),id=await us.get(`username/${sha256(username)}`);if(!id)return json({error:'Профиль не найден.'},404);
    const hs=history(),prefix=`u/${id}/`,{blobs}=await hs.list({prefix});
    const items=(await Promise.all(blobs.map(b=>hs.get(b.key,{type:'json'})))).filter(Boolean);
    let episodes=0,completed=0,watchSeconds=0;
    for(const item of items){episodes+=(item.episodesSeen||[]).length||(item.episode?1:0);completed+=(item.completedEpisodes||[]).length;watchSeconds+=num(item.watchSeconds);}
    return json({titles:items.length,episodes,completed,watchSeconds,watchHours:Math.round((watchSeconds/3600)*10)/10});
  }catch(error){console.error('public-stats',error);return json({error:'Не удалось загрузить статистику.'},500);}
};