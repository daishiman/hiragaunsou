CREATE TABLE `annual_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`year_month` text NOT NULL,
	`sales` real DEFAULT 0 NOT NULL,
	`expense` real DEFAULT 0 NOT NULL,
	`note` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `annual_reference_kind_ym_idx` ON `annual_reference` (`kind`,`year_month`);