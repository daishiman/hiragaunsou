CREATE TABLE `import_compare_snapshot` (
	`target_kind` text PRIMARY KEY NOT NULL,
	`records_json` text NOT NULL,
	`captured_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_diff_ack` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_label` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`acked_by` text,
	`acked_by_name` text DEFAULT '' NOT NULL,
	`acked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`acked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_diff_ack_kind_idx` ON `import_diff_ack` (`target_kind`,`acked_at`);
--> statement-breakpoint
CREATE TABLE `import_diff_absorbed` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`target_key` text NOT NULL,
	`target_label` text DEFAULT '' NOT NULL,
	`field` text NOT NULL,
	`before_value` text DEFAULT '' NOT NULL,
	`after_value` text DEFAULT '' NOT NULL,
	`absorbed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `import_diff_absorbed_at_idx` ON `import_diff_absorbed` (`absorbed_at`);
