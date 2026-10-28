import { invoke, isTauri } from '@tauri-apps/api/core';

export const isDesktop = typeof window !== 'undefined' && isTauri();
export const desktopInfo = () => invoke<{ workerUrl: string; boardId: string }>('desktop_info');
export const installSkill = (target: 'codex' | 'claude') => invoke<{ path: string }>('install_skill', { target });
export async function desktopRequest(path: string, body: unknown) {
  const reply = await invoke<{ status: number; body: string }>('api_request', { path, body });
  return new Response(reply.body, { status: reply.status, headers: { 'Content-Type': 'application/json' } });
}
