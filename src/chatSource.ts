export interface ChatSource { url: string }

export function validChatUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'codex:') return url.hostname === 'threads' && /^\/[a-zA-Z0-9-]+\/?$/.test(url.pathname) && url.pathname !== '/new';
    return url.protocol === 'https:' && (
      (url.hostname === 'chatgpt.com' && /^\/(?:c|share)\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) ||
      (url.hostname === 'claude.ai' && /^\/chat\/[a-zA-Z0-9-]+\/?$/.test(url.pathname))
    );
  } catch { return false; }
}

export function validChatSource(value: unknown): value is ChatSource {
  return !!value && typeof value === 'object' && validChatUrl((value as ChatSource).url);
}
