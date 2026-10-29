import { invoke, isTauri } from '@tauri-apps/api/core';

export const isDesktop = typeof window !== 'undefined' && isTauri();
export interface DesktopInfo { configured: boolean; workerUrl: string | null; updatesUrl: string | null; boardId: string; error?: string | null }
export const desktopInfo = () => invoke<DesktopInfo>('desktop_info');
export const saveConnection = (workerUrl:string,appToken:string) => invoke('save_connection',{workerUrl,appToken});
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
