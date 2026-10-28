import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const boards = sqliteTable('boards', {
  keyHash: text('key_hash').primaryKey(), data: text('data').notNull(), updatedAt: integer('updated_at').notNull(),
});
export const operations = sqliteTable('crdt_ops', {
  opId: text('op_id').notNull(), keyHash: text('key_hash').notNull(), type: text('type').notNull(), ts: integer('ts').notNull(),
  clientId: text('client_id'), payload: text('payload').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.keyHash, table.opId] }), index('crdt_ops_ts').on(table.keyHash, table.ts)]);
export const snapshots = sqliteTable('crdt_snapshots', {
  keyHash: text('key_hash').primaryKey(), snap: text('snap').notNull(), snapTs: integer('snap_ts').notNull(), updatedAt: integer('updated_at').notNull(),
});
