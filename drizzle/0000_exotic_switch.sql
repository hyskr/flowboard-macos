CREATE TABLE `boards` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `crdt_ops` (
	`op_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`type` text NOT NULL,
	`ts` integer NOT NULL,
	`client_id` text,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`key_hash`, `op_id`)
);
--> statement-breakpoint
CREATE INDEX `crdt_ops_ts` ON `crdt_ops` (`key_hash`,`ts`);--> statement-breakpoint
CREATE TABLE `crdt_snapshots` (
	`key_hash` text PRIMARY KEY NOT NULL,
	`snap` text NOT NULL,
	`snap_ts` integer NOT NULL,
	`updated_at` integer NOT NULL
);
