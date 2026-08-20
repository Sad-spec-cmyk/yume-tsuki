import { getStore, getDeployStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const SESSION_COOKIE='yume_session';
const sha256=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const cleanUsername=v=>String(v||'').trim().toLowerCase();

function isProduction(){
  const context=globalThis.Netlify?.context?.deploy?.context||process.env.CONTEXT||'';
  if(context)return context==='production';
  const branch=process.env.BRANCH||'';
  const productionBranch=process.env.PRODUCTION_BRANCH||'main';
  return Boolean(branch&&branch===productionBranch&&process.env.SITE_ID);
}
function store(name,strong=false){return isProduction()?getStore(name,strong?{consistency:'strong'}:undefined):getDeployStore(name);}
const users=()=>store('yume-users',true);const sessions=()=>store('yume-sessions',true);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function cookies(req){const out={};for(const part of(req.headers.get('cookie')||'').split(';')){const i=part.indexOf('=');if(i<0)continue;const k=part.slice(0,i).trim(),v=part.slice(i+1).trim();if(k)out[k]=decodeURIComponent(v);}return out;}
async function sessionUser(req){const token=cookies(req)[SESSION_COOKIE];if(!token)return null;const s=await sessions().get(`s/${sha256(token)}`,{type:'json'});if(!s?.userId||Number(s.expiresAt)<Date.now())return null;return users().get(`u/${s.userId}`,{type:'json'});}
function mediaUrl(user,kind){const has=kind==='avatar'?user?.hasAvatar:user?.hasBanner;if(!user?.id||!has)return'';const v=encodeURIComponent(user.updatedAt||user.createdAt||'1');return`/.netlify/functions/yume-api?action=media&user=${encodeURIComponent(user.id)}&kind=${kind}&v=${v}`;}
function safeUser(user){return{id:user.id,email:user.email,username:user.username,displayName:user.displayName||user.username,bio:user.bio||'',accent:user.accent||'#ff395f',avatarUrl:mediaUrl(user,'avatar'),bannerUrl:mediaUrl(user,'banner'),createdAt:user.createdAt,updatedAt:user.updatedAt};}

export default async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const current=await sessionUser(request);if(!current)return json({error:'Нужно войти в аккаунт.'},401);
    let data={};try{data=await request.json();}catch{}
    const username=cleanUsername(data.username);
    if(!/^[a-z0-9_]{3,20}$/.test(username))return json({error:'@username: 3–20 символов, только латиница, цифры и _.'},400);
    if(username===cleanUsername(current.username))return json({user:safeUser(current)});
    const us=users();const newKey=`username/${sha256(username)}`;const taken=await us.get(newKey);
    if(taken&&String(taken)!==String(current.id))return json({error:'Этот @username уже занят.'},409);
    const oldUsername=cleanUsername(current.username);const oldKey=oldUsername?`username/${sha256(oldUsername)}`:'';
    const displayName=(String(current.displayName||'').trim().toLowerCase()===oldUsername)?username:current.displayName;
    const updated={...current,username,displayName:displayName||username,updatedAt:new Date().toISOString()};
    await us.setJSON(`u/${updated.id}`,updated);
    await us.set(newKey,updated.id);
    if(oldKey&&oldKey!==newKey)await us.delete(oldKey);
    return json({user:safeUser(updated)});
  }catch(error){console.error('change-username',error);return json({error:'Не удалось изменить @username.'},500);}
};