import { invoke } from '@tauri-apps/api/core';
export interface Entry {
  id: string;
  version: number;
  date: string;
  occurredAt: string;
  savedAt: string;
  title: string;
  body: string;
  sessionId: string;
  source: string;
  project?: string;
  sourceChat?: string;
  artifacts?: { label: string; path: string }[];
  deletedAt?: string;
  placeholder?: boolean;
  importPath?: string;
  taskLinks?: unknown[];
}
export interface Knowledge {
  path: string;
  version: number;
  title: string;
  topic: string;
  usage: string;
  topics: string[];
  project?: string;
  updatedAt: string;
  body?: string;
  snippet?: string;
  headings?: string[];
  sourceJournalIds?: string[];
}
export interface PersonalSettings {
  timezone: string;
  autoRecord: boolean;
  checkpointMinutes: number;
  knowledgeDir: string;
  exportDir: string | null;
  hidePlaceholders: boolean;
  dataDir: string;
}
export interface Conflict {
  id: string;
  kind: 'journal' | 'knowledge';
  target: string;
  proposed: Record<string, unknown>;
  current: Entry | Knowledge;
  createdAt: string;
}
export interface Integration {
  skill: { version: string | null; bundledVersion: string; status: string };
  hooksConfigured: boolean;
  hookVersion: string | null;
  hooksTrusted: boolean | null;
  oldTaskSkill: boolean;
  oldJournalEnabled: boolean;
  reviewInstructions: string;
  configPath: string;
}
export const local = <T = unknown>(op: string, args: Record<string, unknown> = {}) =>
  invoke<T>('local_request', { request: { ...args, op } });
export const chooseDirectory = () => invoke<string | null>('choose_directory');
export const openPath = (path: string) => invoke('open_path', { path });
export const integrationStatus = (target: string) => invoke<Integration>('integration_status', { target });
export const takeover = (target: string) => invoke<Integration>('takeover', { target });
