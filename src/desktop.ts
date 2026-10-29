import { invoke, isTauri } from '@tauri-apps/api/core';

export const isDesktop = typeof window !== 'undefined' && isTauri();
export interface DesktopInfo { configured: boolean; workerUrl: string | null; updatesUrl: string | null; boardId: string; error?: string | null }
const CONNECTION_KEY='xingji-web-connection';
export function browserConnection():{workerUrl:string;appToken:string}|null {try{return JSON.parse(localStorage.getItem(CONNECTION_KEY)||'null');}catch{return null;}}
export const desktopInfo = async ():Promise<DesktopInfo> => isDesktop ? invoke<DesktopInfo>('desktop_info') : {configured:!!browserConnection()?.appToken,workerUrl:browserConnection()?.workerUrl||location.origin,updatesUrl:null,boardId:'shared'};
export const saveConnection = async (workerUrl:string,appToken:string) => {
 if(isDesktop)return invoke('save_connection',{workerUrl,appToken});
 const url=new URL(workerUrl.trim());if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('请使用 HTTPS 服务地址');
 const origin=url.origin;const key=appToken.trim();
 const response=await fetch(origin+'/api/connection/info',{method:'POST',headers:{'Content-Type':'application/json','X-FlowBoard-Access':key},body:'{}'});
 if(!response.ok)throw new Error(response.status===401?'共享密钥无效':'无法连接共享看板');
 const info=await response.json();if(info.boardId!=='shared')throw new Error('此地址不是共享看板服务');
 localStorage.setItem(CONNECTION_KEY,JSON.stringify({workerUrl:origin,appToken:key}));
};
export function forgetConnection(){localStorage.removeItem(CONNECTION_KEY);location.reload();}
export interface SkillStatus { status: 'missing' | 'compatible' | 'update_required' | 'installed'; path: string; version: string | null; bundledVersion: string; protocolVersion: number }
export const checkSkill = (target: 'codex' | 'claude') => invoke<SkillStatus>('skill_status', { target });
export const installSkill = (target: 'codex' | 'claude', update = false) => invoke<SkillStatus>('install_skill', { target, update });
export async function openSourceChat(url: string) {
  const { validChatUrl } = await import('./chatSource');
  if (!validChatUrl(url)) throw new Error('来源聊天链接无效');
  if (isDesktop) await invoke('open_source_chat', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export async function desktopRequest(path: string, body: unknown) {
  const reply = await invoke<{ status: number; body: string }>('api_request', { path, body });
  return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
}
