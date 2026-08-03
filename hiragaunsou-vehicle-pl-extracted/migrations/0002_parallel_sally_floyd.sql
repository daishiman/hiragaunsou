CREATE TABLE `usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`recorded_by` text,
	`detail_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usage_log_kind_created_idx` ON `usage_log` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_log_recorded_by_idx` ON `usage_log` (`recorded_by`);