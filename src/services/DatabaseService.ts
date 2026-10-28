import { DB_NAME, DB_VERSION } from '../constants.ts';
import { applyOp, generationOf, mergeStates, settle, type CrdtState } from './crdt.ts';
import type { CrdtOp, StoreName, CardConflict } from '../types';

export class DatabaseService {
  private db: IDBDatabase | null = null;

  async open(): Promise<this> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const stores: { name: StoreName; keyPath: string; indexes: string[] }[] = [
          { name: 'boards', keyPath: 'id', indexes: [] },
          { name: 'columns', keyPath: 'id', indexes: ['boardId'] },
          { name: 'cards', keyPath: 'id', indexes: ['boardId', 'columnId'] },
          { name: 'settings', keyPath: 'key', indexes: [] },
          { name: 'activity', keyPath: 'id', indexes: ['boardId', 'ts'] },
          { name: 'boardCreds', keyPath: 'boardId', indexes: [] },
          { name: 'crdtOps', keyPath: 'opId', indexes: ['boardId'] },
        ];
        for (const s of stores) {
          if (!db.objectStoreNames.contains(s.name)) {
            const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
            s.indexes.forEach((idx) => store.createIndex(idx, idx));
          }
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve(this);
      };
      req.onerror = () => reject(req.error);
    });
  }

  get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  put<T>(store: StoreName, obj: T): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Write aborted'));
    });
  }

  delete(store: StoreName, key: string): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Delete aborted'));
    });
  }

  getAll<T>(store: StoreName): Promise<T[]> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const req = this.db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => rej(req.error);
    });
  }

  batchPut<T>(store: StoreName, items: T[]): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.db) return rej(new Error('DB not open'));
      const tx = this.db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const item of items) os.put(item);
      tx.oncomplete = () => res();
      tx.onabort = () => rej(tx.error ?? new Error('Batch aborted'));
    });
  }

  // Read the history identifier and pending operations from one consistent transaction.
  getSyncOutbox(boardId: string): Promise<{ generation: string; ops: CrdtOp[] }> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not open'));
      const tx = this.db.transaction(['settings', 'crdtOps'], 'readonly');
      const state = tx.objectStore('settings').get(`crdtState:${boardId}`);
      const ops = tx.objectStore('crdtOps').index('boardId').getAll(boardId);
      tx.oncomplete = () => resolve({ generation: generationOf(state.result?.value, boardId), ops: ops.result });
      tx.onabort = () => reject(tx.error ?? new Error('Outbox read aborted'));
    });
  }

  reconcile(boardId: string, remote: CrdtState, accepted: string[], conflicts: CardConflict[]): Promise<{ state: CrdtState; conflicts: CardConflict[] }> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not open'));
      const tx = this.db.transaction(['settings','boards','columns','cards','activity','crdtOps'], 'readwrite');
      const pending = tx.objectStore('crdtOps').index('boardId').getAll(boardId);
      const saved = tx.objectStore('settings').get('syncConflicts');
      let result: { state: CrdtState; conflicts: CardConflict[] };
      saved.onsuccess = () => {
        const removed = new Set([...accepted, ...conflicts.map(c => c.opId)]);
        for (const id of removed) tx.objectStore('crdtOps').delete(id);
        const state = structuredClone(remote);
        let after = Math.max(0, ...Object.values(state).flatMap(map => Object.values(map).map(row => row.__ts || 0)));
        for (const op of pending.result as CrdtOp[]) if (!removed.has(op.opId)) applyOp(state, { ...op, ts: ++after });
        settle(state);
        const drafts = new Map<string, CardConflict>((saved.result?.value ?? []).map((c: CardConflict) => [c.cardId, c]));
        for (const conflict of conflicts) {
          const previous = drafts.get(conflict.cardId);
          drafts.set(conflict.cardId, { ...conflict, local: { ...previous?.local, ...conflict.local }, fields: [...new Set([...(previous?.fields || []), ...conflict.fields])] });
        }
        for (const store of ['boards','columns','cards','activity'] as const) {
          const os = tx.objectStore(store), rows = os.getAll();
          rows.onsuccess = () => {
            for (const row of rows.result) if (store === 'boards' ? row.id === boardId : row.boardId === boardId) os.delete(row.id);
            for (const row of Object.values(state[store])) if (!row.__deleted) os.put(row);
          };
        }
        tx.objectStore('settings').put({ key: `crdtState:${boardId}`, value: state });
        tx.objectStore('settings').put({ key: 'syncConflicts', value: [...drafts.values()] });
        result = { state, conflicts: [...drafts.values()] };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Sync reconciliation failed'));
    });
  }

  // Native IDB transaction serializes concurrent tabs and commits records, versions, tombstones
  // and the outbox together. Never acknowledge a remote read before this transaction completes.
  updateSyncState(boardId: string, initial: CrdtState, update: (state: CrdtState) => CrdtOp[], remote?: CrdtState): Promise<CrdtState> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not open'));
      const tx = this.db.transaction(['settings', 'boards', 'columns', 'cards', 'activity', 'crdtOps'], 'readwrite');
      const key = `crdtState:${boardId}`;
      const read = tx.objectStore('settings').get(key);
      const pending = tx.objectStore('crdtOps').index('boardId').getAll(boardId);
      let next: CrdtState;
      // Requests execute in order; include the durable outbox when upgrading an old client.
      pending.onsuccess = () => {
        try {
          const stored = read.result?.value as CrdtState | undefined;
          // A stale tab's materialized rows are not a baseline for a different history.
          next = stored && generationOf(stored, boardId) !== generationOf(initial, boardId)
            ? structuredClone(stored) : stored ? mergeStates(initial, stored) : initial;
          for (const op of pending.result as CrdtOp[]) applyOp(next, op);
          settle(next);
          // Keep histories reset by older releases isolated without discarding local work.
          if (next.boards[boardId] && remote && generationOf(next, boardId) !== generationOf(remote, boardId)) {
            throw new Error('This device has a different board history. Export its local data before joining the cloud board in a new browser profile.');
          }
          const ops = update(next);
          settle(next);
          for (const store of ['boards', 'columns', 'cards', 'activity'] as const) {
            for (const row of Object.values(next[store])) {
              const os = tx.objectStore(store);
              const existing = os.get(row.id);
              existing.onsuccess = () => {
                if (existing.result && store !== 'boards' && existing.result.boardId !== boardId) { tx.abort(); return; }
                if (row.__deleted) os.delete(row.id);
                else os.put(row);
              };
            }
          }
          tx.objectStore('settings').put({ key, value: next });
          for (const op of ops) tx.objectStore('crdtOps').put(op);
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = () => reject(tx.error ?? new Error('Sync transaction aborted'));
    });
  }
}
