import { isDesktop, desktopInfo } from '../desktop';
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { WORKER_URL, COL_COLORS, resolveTheme } from '../constants.ts';
import { DEFAULT_FILTERS, uid } from '../utils.ts';
import { DatabaseService } from '../services/DatabaseService.ts';
import { SyncService } from '../services/SyncService.ts';
import { CryptoService } from '../services/CryptoService.ts';
import { boardIdFromPath, setBoardUrl } from '../boardRouting.ts';
import { applyOp, emptyState, generationOf, materialize, mergeStates, stripMeta, validId, validOp, type CrdtState } from '../services/crdt.ts';
import type {
  FlowState, Board, Column, Card, ActivityEvent, CrdtOp, View,
} from '../types';

const db = new DatabaseService();
const sync = new SyncService(db, WORKER_URL, (ok) => useFlowStore.setState({ workerStatus: ok }));

export { db, sync };

const THEME_CACHE_KEY = 'flowboard-theme';

const applyTheme = (id: string | null) => {
  const theme = resolveTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.scheme = theme.scheme;
  const vars: Record<string, string> = {
    canvas: theme.canvas, sidebar: theme.sidebar, surface: theme.surface, card: theme.card, raised: theme.raised,
    hover: theme.hover, line: theme.line, 'line-strong': theme.lineStrong,
    fg: theme.fg, 'fg-muted': theme.fgMuted, 'fg-subtle': theme.fgSubtle, accent: theme.accent, 'accent-fg': theme.accentFg,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(`--${k}`, v);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme.sidebar);
  localStorage.setItem(THEME_CACHE_KEY, theme.id);
  return theme.id;
};

// Paint the last-used theme before IndexedDB finishes loading, so there's no flash.
applyTheme(localStorage.getItem(THEME_CACHE_KEY));

export const useFlowStore = create<FlowState>((set, get) => {

  let writes = Promise.resolve();
  let syncWork = Promise.resolve();
  const persist = (boardId: string, update: (state: CrdtState) => CrdtOp[], remote?: CrdtState) => {
    const work = writes.then(async () => {
      const initial = emptyState();
      const current = get();
      for (const store of ['boards', 'columns', 'cards', 'activity'] as const) {
        for (const row of current[store]) {
          if (store === 'boards' ? row.id === boardId : 'boardId' in row && row.boardId === boardId) {
            initial[store][row.id] = { __ts: 0, ...row };
          }
        }
      }
      const state = await db.updateSyncState(boardId, initial, state => {
        const ops = update(state);
        // Seed old unversioned records without giving stale data a new clock.
        for (const [store, type] of [['boards', 'board.update'], ['columns', 'column.create'], ['cards', 'card.create'], ['activity', 'activity.create']] as const) {
          for (const row of Object.values(state[store])) {
            if (row.__ts || row.__opId || row.__deleted) continue;
            const seed = { boardId, opId: uid(), clientId: '', ts: 0, type, payload: { ...stripMeta(row), boardId } };
            applyOp(state, seed);
            ops.push(seed);
          }
        }
        return ops;
      }, remote);
      const data = materialize(state) as unknown as Pick<FlowState, 'boards' | 'columns' | 'cards' | 'activity'>;
      const latest = get();
      set({
        boards: [...latest.boards.filter(b => b.id !== boardId), ...data.boards].sort((a, b) => a.createdAt - b.createdAt),
        columns: [...latest.columns.filter(c => c.boardId !== boardId), ...data.columns].sort((a, b) => a.order - b.order),
        cards: [...latest.cards.filter(c => c.boardId !== boardId), ...data.cards].sort((a, b) => a.order - b.order),
        activity: [...latest.activity.filter(a => a.boardId !== boardId), ...data.activity].sort((a, b) => b.ts - a.ts),
      });
    });
    writes = work.catch(() => {});
    return work;
  };
  const commit = (boardId: string, changes: { type: string; payload: Record<string, unknown>; baseVersion?: number; baseValues?: Record<string, unknown>; restore?: boolean }[]) => persist(boardId, state => {
    let after = 0;
    for (const map of Object.values(state)) for (const row of Object.values(map)) after = Math.max(after, row.__ts ?? 0);
    return changes.map(({ type, payload, ...preconditions }) => {
      const op = sync.createOp(boardId, type, type === 'board.update' && generationOf(state, boardId)
        ? { ...payload, syncGeneration: generationOf(state, boardId) } : payload, after);
      Object.assign(op, preconditions);
      if (!validOp(op, boardId)) throw new Error('Invalid local operation');
      after = op.ts;
      applyOp(state, op);
      return op;
    });
  }).then(() => sync.scheduleSync(() => {
    const { workerUrl, syncInterval } = get();
    get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
  }));

  const armSyncTimer = (seconds:number) => sync.startTimer(seconds, async () => {
    if (document.visibilityState !== 'visible') return;
    const state=get(), id=state.activeBoardId;
    if (id && await sync.hasRemoteChanges(id)) await get().saveSettings({workerUrl:get().workerUrl,syncInterval:get().syncInterval});
  });

  const download = (data: unknown, filename: string) => {
    if (isDesktop) { void invoke<string>('export_backup', { data, filename }).then(path => get().toast(`备份已保存：${path}`)).catch(() => get().toast('无法导出备份', '⚠')); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const parseData = (data: unknown, boardId?: string): CrdtState => {
    if (!data || typeof data !== 'object') throw new Error('Invalid board data');
    const state = emptyState();
    for (const store of Object.keys(state) as (keyof CrdtState)[]) {
      const rows = (data as Record<string, unknown>)[store] ?? [];
      if (!Array.isArray(rows)) throw new Error('Invalid board records');
      for (const row of rows) {
        if (!row || !validId(row.id) || (store !== 'boards' && !validId(row.boardId))
          || boardId && (store === 'boards' ? row.id !== boardId : row.boardId !== boardId)) throw new Error('Invalid or cross-board record');
        const fields = stripMeta(row);
        state[store][row.id] = { ...fields, __ts: 0, __opId: '' };
      }
    }
    return state;
  };

  return {
    conflicts: [],
    boards: [],
    columns: [],
    cards: [],
    activity: [],
    activeBoardId: null,
    activeView: 'board',
    activeTheme: 'midnight',
    backlogOpen: true,
    searchQuery: '',
    filters: { ...DEFAULT_FILTERS },
    density: 'comfortable',
    showDueDateOnly: false,
    calendarDate: new Date(),
    modal: null,
    toasts: [],
    workerStatus: false,
    workerUrl: WORKER_URL,
    syncInterval: 60,
    isLoading: true,
    error: null,

    init: async () => {
      // Best effort: reduce storage eviction without blocking startup or requiring support.
      try { void navigator.storage?.persist?.().catch(() => {}); }
      catch { /* Storage permissions must not prevent opening existing boards. */ }
      try {
        await db.open();
        const [boards, columns, cards, settings, activity] = await Promise.all([
          db.getAll<Board>('boards'),
          db.getAll<Column>('columns'),
          db.getAll<Card>('cards'),
          db.getAll<{ key: string; value: unknown }>('settings'),
          db.getAll<ActivityEvent>('activity'),
        ]);

        let activeBoardId: string | null = null;
        let workerUrl = WORKER_URL;
        let syncInterval = 60;
        let activeTheme = 'paper';
        let backlogOpen = true;
        let density: FlowState['density'] = 'comfortable';

        for (const s of settings) {
          if (s.key === 'syncConflicts') set({ conflicts: s.value as FlowState['conflicts'] });
          if (s.key === 'activeBoardId') activeBoardId = s.value as string | null;
          if (s.key === 'workerUrl') workerUrl = (s.value as string) || WORKER_URL;
          if (s.key === 'syncInterval') syncInterval = Math.max(60, (s.value as number) || 60);
          if (s.key === 'activeTheme') activeTheme = s.value as string;
          if (s.key === 'backlogOpen') backlogOpen = s.value !== false;
          if (s.key === 'density' && s.value === 'compact') density = 'compact';
        }

        const sortedBoards = boards.sort((a, b) => a.createdAt - b.createdAt);
        if (!sortedBoards.some((b) => b.id === activeBoardId)) {
          activeBoardId = sortedBoards[0]?.id ?? null;
        }

        if (isDesktop) workerUrl = (await desktopInfo()).workerUrl;
        activeTheme = applyTheme(activeTheme);
        sync.setWorkerUrl(workerUrl);

        set({
          boards: sortedBoards,
          columns: columns.sort((a, b) => a.order - b.order),
          cards: cards.sort((a, b) => a.order - b.order),
          activity: activity.sort((a, b) => b.ts - a.ts),
          activeBoardId,
          activeTheme,
          workerUrl,
          syncInterval,
          backlogOpen,
          density,
          isLoading: false,
        });

        if (isDesktop) {
          if (!get().boards.some(b => b.id === 'shared')) {
            if (!await get().joinBoard('shared', '')) throw new Error('暂时无法打开共享看板，请连接网络后重新打开应用。');
          }
          await get().setActiveBoard('shared', true);
        } else await get().setActiveBoard(boardIdFromPath(window.location.pathname) ?? activeBoardId, true);

        const creds = await sync.getAllBoardCreds();
        if (creds.length) {
          get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
        }

        const inviteId = new URLSearchParams(window.location.search).get('invite');
        if (inviteId) setTimeout(() => set({ modal: { type: 'joinInvite', props: { boardId: inviteId } } }), 400);
      } catch (e) {
        set({ error: (e as Error).message, isLoading: false });
      }
    },

    setActiveBoard: async (id, replace = false) => {
      if (id && !get().boards.some((b) => b.id === id)) {
        const boardId = id;
        get().toast('This board isn’t on this device. Join it with its password.', '⚠', {
          label: 'Join board', run: async () => { get().openModal('joinInvite', { boardId }); },
        });
        id = null;
        replace = true;
      }
      setBoardUrl(id, replace);
      set({ activeBoardId: id, filters: { ...DEFAULT_FILTERS }, searchQuery: '' });
      await db.put('settings', { key: 'activeBoardId', value: id });
    },

    setActiveView: (view: View) => set({ activeView: view }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    setFilters: (filters) => set((s) => ({ filters: { ...s.filters, ...filters } })),
    clearFilters: () => set({ filters: { ...DEFAULT_FILTERS }, searchQuery: '' }),
    setDensity: async (density) => {
      set({ density });
      await db.put('settings', { key: 'density', value: density });
    },

    toggleBacklog: async () => {
      const next = !get().backlogOpen;
      await db.put('settings', { key: 'backlogOpen', value: next });
      set({ backlogOpen: next });
    },

    toggleDueDateOnly: () => set((s) => ({ showDueDateOnly: !s.showDueDateOnly })),
    setCalendarDate: (d) => set({ calendarDate: d }),
    openModal: (type, props) => set({ modal: { type, props } }),
    closeModal: () => set({ modal: null }),

    toast: (message, icon = '✓', action) => {
      const id = uid();
      set((s) => ({ toasts: [...s.toasts, { id, message, icon, action }] }));
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, action ? 10000 : 4000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    createBoard: async (name, password) => {
      const boardId = uid();
      const keyHash = await CryptoService.hashKey(boardId, password);
      const board: Board = { id: boardId, name: name || 'New Board', createdAt: Date.now() };
      await sync.saveBoardCreds(boardId, keyHash, board.name, password);
      const defaultCols = ['待办', '进行中', '已交付'];
      const newCols = defaultCols.map((colName, i) => ({
        id: uid(), boardId, name: colName, order: i,
        color: COL_COLORS[i % COL_COLORS.length],
      }));
      await commit(boardId, [{ type: 'board.update', payload: { boardId, ...board } }, ...newCols.map(c => ({ type: 'column.create', payload: { ...c } }))]);
      await get().setActiveBoard(boardId);
    },

    renameBoard: async (id, name) => {
      const board = get().boards.find((b) => b.id === id);
      if (!board) return;
      const next = { ...board, name };
      await commit(id, [{ type: 'board.update', payload: { ...next, boardId: id } }]);
    },

    deleteBoard: async (id) => {
      const state = get();
      const nextBoards = state.boards.filter((b) => b.id !== id);
      const nextColumns = state.columns.filter((c) => c.boardId !== id);
      const nextCards = state.cards.filter((c) => c.boardId !== id);
      await db.delete('boards', id);
      await db.delete('boardCreds', id);
      const nextActive = state.activeBoardId === id ? nextBoards[0]?.id || null : state.activeBoardId;
      if (state.activeBoardId === id) {
        await db.put('settings', { key: 'activeBoardId', value: nextActive });
        setBoardUrl(nextActive, true);
      }
      set({ boards: nextBoards, columns: nextColumns, cards: nextCards, activeBoardId: nextActive, filters: { ...DEFAULT_FILTERS }, searchQuery: '' });
    },

    createColumn: async (boardId, name) => {
      const existing = get().columns.filter((c) => c.boardId === boardId);
      const col: Column = {
        id: uid(),
        boardId,
        name: name || 'New Column',
        order: existing.length,
        color: COL_COLORS[existing.length % COL_COLORS.length],
      };
      await commit(boardId, [{ type: 'column.create', payload: { ...col } }]);
    },

    updateColumn: async (id, updates) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      const next = { ...col, ...updates };
      await commit(col.boardId, [{ type: 'column.update', payload: { ...next } }]);
    },

    deleteColumn: async (id) => {
      const col = get().columns.find((c) => c.id === id);
      if (!col) return;
      // ponytail: O(n²) column deletion reuses ordering/sync; batch-plan moves if columns reach thousands of cards.
      for (const card of get().cards.filter((c) => c.columnId === id).sort((a, b) => a.order - b.order)) {
        const count = get().cards.filter((c) => c.boardId === col.boardId && c.columnId === null).length;
        await get().moveCard(card.id, null, count);
      }
      await commit(col.boardId, [{ type: 'column.delete', payload: { id, boardId: col.boardId } }]);
      set(s => ({ filters: { ...s.filters, columnId: s.filters.columnId === id ? 'all' : s.filters.columnId } }));
    },

    createCard: async (boardId, columnId, data) => {
      const colCards = get().cards.filter((c) => c.columnId === columnId && c.boardId === boardId);
      const card: Card = {
        id: uid(),
        boardId,
        columnId,
        title: data.title || 'New Card',
        desc: data.desc || '',
        tags: data.tags || [],
        color: data.color || 'transparent',
        priority: (data.priority) || 'medium',
        dueDate: data.dueDate || null,
        checklist: data.checklist ?? [],
        sourceChat: data.sourceChat,
        completedAt: data.completedAt ?? null,
        updatedAt: Date.now(),
        order: colCards.length ? Math.max(...colCards.map((c) => c.order)) + 1 : 0,
        createdAt: Date.now(),
      };
      await commit(boardId, [{ type: 'card.create', payload: { ...card } }]);

    },

    updateCard: async (id, updates, base) => {
      const current = get().cards.find(c => c.id === id);
      if (!current) throw new Error('这张卡片已删除，草稿已保留。');
      const original = base ?? current;
      const details = Object.fromEntries(Object.entries(updates).filter(([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(original[key as keyof Card] ?? null)));
      const { columnId, ...patch } = details;
      if (columnId !== undefined) await get().moveCard(id, columnId as string | null, get().cards.filter(c => c.columnId === columnId).length);
      if (!Object.keys(patch).length) return;
      await commit(current.boardId, [{ type:'card.update', payload:{id,boardId:current.boardId,...patch}, baseVersion:original.version ?? 0, baseValues:Object.fromEntries(Object.keys(patch).map(key => [key, original[key as keyof Card] ?? null])) }]);
    },

    resolveConflict: async (opId, choice) => {
      const draft = get().conflicts.find(c => c.opId === opId);
      if (!draft) return;
      if (choice === 'local') {
        await get().saveSettings({workerUrl:get().workerUrl,syncInterval:get().syncInterval});
        const current = get().cards.find(c => c.id === draft.cardId);
        if (!current) throw new Error('这张卡片已删除，不能自动恢复。请复制草稿内容。');
        const fields = ['title','desc','tags','color','priority','dueDate','checklist','completedAt'];
        await get().updateCard(current.id, Object.fromEntries(fields.filter(key => Object.hasOwn(draft.local,key)).map(key => [key,draft.local[key]])),current);
      }
      const conflicts = get().conflicts.filter(c => c.opId !== opId);
      await db.put('settings',{key:'syncConflicts',value:conflicts});
      set({conflicts});
    },

    toggleCardComplete: async (id) => {
      const card = get().cards.find(c => c.id === id);
      if (card) await get().updateCard(id, { completedAt: card.completedAt ? null : Date.now() });
    },

    deleteCard: async (id) => {
      const card = get().cards.find((c) => c.id === id);
      if (!card) return;
      const position = get().cards.filter((c) => c.boardId === card.boardId && c.columnId === card.columnId).sort((a, b) => a.order - b.order).findIndex((c) => c.id === id);
      await commit(card.boardId, [{ type: 'card.delete', payload: { id, boardId: card.boardId } }]);
      get().toast('Card deleted', '🗑', { label: 'Undo', run: async () => {
        const state = get();
        if (!state.boards.some((b) => b.id === card.boardId)) return;
        if (state.cards.some((c) => c.id === id)) return;
        const columnId = state.columns.some((c) => c.id === card.columnId) ? card.columnId : null;
        const restored = { ...card, columnId };
        await commit(card.boardId, [{type:'card.create',payload:{...restored,order:position},restore:true}]);
        get().toast('Card restored');
      } });
    },

    moveCard: async (cardId, targetColumnId, targetIndex) => {
      const state = get();
      const card = state.cards.find((c) => c.id === cardId);
      if (!card) return;
      if (targetColumnId && !state.columns.some((c) => c.id === targetColumnId && c.boardId === card.boardId)) throw new Error('The destination column no longer exists.');
      await commit(card.boardId, [{type:'card.move',payload:{id:cardId,boardId:card.boardId,columnId:targetColumnId,targetIndex}}]);
    },

    reorderColumns: async (orderedIds) => {
      const state = get();
      const nextColumns = state.columns.map((c) => {
        const idx = orderedIds.indexOf(c.id);
        if (idx === -1) return c;
        return { ...c, order: idx };
      });
      const changed = nextColumns.filter((c) => {
        const orig = state.columns.find((x) => x.id === c.id);
        return orig && orig.order !== c.order;
      });
      for (const boardId of new Set(changed.map(c => c.boardId))) {
        await commit(boardId, changed.filter(c => c.boardId === boardId).map(c => ({ type: 'column.update', payload: { ...c } })));
      }
    },

    saveTheme: async (id) => {
      applyTheme(id);
      set({ activeTheme: id });
      await db.put('settings', { key: 'activeTheme', value: id });
    },

    setSyncInterval: async (seconds) => {
      const interval=Math.max(60,seconds);
      await db.put('settings',{key:'syncInterval',value:interval});
      set({syncInterval:interval});
      armSyncTimer(interval);
    },

    saveSettings: ({ workerUrl, syncInterval }) => {
      const intervalChanged=get().syncInterval!==syncInterval;
      // Debounced edits must use the latest requested endpoint, not queue an obsolete setting.
      sync.stopTimer();
      set({ workerUrl, syncInterval });
      const run = syncWork.catch(() => {}).then(async () => {
        if (get().workerUrl !== workerUrl || get().syncInterval !== syncInterval) return;
        await db.put('settings', { key: 'workerUrl', value: workerUrl });
        if (intervalChanged) await db.put('settings', { key: 'syncInterval', value: syncInterval });
        sync.setWorkerUrl(workerUrl);
        sync.stopTimer();
        const creds = await sync.getAllBoardCreds();
        for (const c of creds) {
          if (!get().boards.some(b => b.id === c.boardId)) continue;
          try {
            await writes;
            const result = await sync.synchronize(c.boardId);
            const data = materialize(result.state) as unknown as Pick<FlowState,'boards'|'columns'|'cards'|'activity'>;
            const latest = get();
            set({boards:[...latest.boards.filter(b=>b.id!==c.boardId),...data.boards],columns:[...latest.columns.filter(b=>b.boardId!==c.boardId),...data.columns].sort((a,b)=>a.order-b.order),cards:[...latest.cards.filter(b=>b.boardId!==c.boardId),...data.cards].sort((a,b)=>a.order-b.order),activity:[...latest.activity.filter(b=>b.boardId!==c.boardId),...data.activity].sort((a,b)=>b.ts-a.ts),conflicts:result.conflicts});
          } catch { set({workerStatus:false}); }
        }
        armSyncTimer(get().syncInterval);
      });
      syncWork = run;
      return run;
    },

    joinBoard: async (boardId, password) => {
      const keyHash = await CryptoService.hashKey(boardId, password);
      const ok = await sync.pullFromWorker(boardId, password, async (data, remote) => {
        const baseline = parseData(data, boardId);
        await persist(boardId, state => {
          mergeStates(state, baseline);
          if (remote) mergeStates(state, remote);
          return [];
        }, remote);
      }, keyHash);
      if (!ok) return false;
      // Boards whose server history lost the board record still need a sidebar entry.
      if (!get().boards.some((b) => b.id === boardId)) {
        await commit(boardId, [{ type: 'board.update', payload: { id: boardId, boardId, name: 'Shared board', createdAt: Date.now() } }]);
      }
      await sync.saveBoardCreds(boardId, keyHash, get().boards.find(b => b.id === boardId)!.name, password);
      await get().setActiveBoard(boardId);
      const { workerUrl, syncInterval } = get();
      get().saveSettings({ workerUrl, syncInterval }).catch(() => {});
      return true;
    },

    exportData: () => {
      const state = get();
      const data = { boards: state.boards, columns: state.columns, cards: state.cards, activity: state.activity };
      download(data, `flowboard-export-${Date.now()}.json`);
    },

    importData: async (json) => {
      const data = parseData(JSON.parse(json));
      const grouped = new Map<string, { type: string; payload: Record<string, unknown>; baseVersion?: number; baseValues?: Record<string, unknown> }[]>();
      // Merging adds and edits records but never restores deleted ones.
      for (const [store, type] of [['boards', 'board.update'], ['columns', 'column.update'], ['cards', 'card.update'], ['activity', 'activity.create']] as const) {
        for (const row of Object.values(data[store]).map(stripMeta)) {
          // Imports cannot change an existing board's sync history identifier.
          if (store === 'boards') delete row.syncGeneration;
          const boardId = String(store === 'boards' ? row.id : row.boardId);
          const list = grouped.get(boardId) ?? [];
          if (store === 'cards') {
            const current = get().cards.find(c => c.id === row.id);
            const fields = ['title','desc','tags','color','priority','dueDate','checklist','completedAt'];
            const patch = Object.fromEntries(fields.filter(key => Object.hasOwn(row,key) && JSON.stringify(row[key] ?? null) !== JSON.stringify(current?.[key as keyof Card] ?? null)).map(key=>[key,row[key]]));
            list.push(current ? {type:'card.update',payload:{id:row.id,boardId,...patch},baseVersion:current.version ?? 0,baseValues:Object.fromEntries(Object.keys(patch).map(key=>[key,current[key as keyof Card] ?? null]))} : {type:'card.create',payload:{...row,boardId}});
          } else list.push({ type, payload: { ...row, boardId } });
          grouped.set(boardId, list);
        }
      }
      for (const [boardId, ops] of grouped) await commit(boardId, ops);
      get().toast('Data imported', '✓');
    },
  };
});
