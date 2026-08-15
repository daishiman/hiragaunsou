CREATE TABLE `improvement_request` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`reporter_name` text DEFAULT '' NOT NULL,
	`submission_key` text NOT NULL,
	`path` text NOT NULL,
	`route_pattern` text NOT NULL,
	`screen_label` text NOT NULL,
	`body` text NOT NULL,
	`viewport` text,
	`user_agent` text,
	`status` text DEFAULT 'open' NOT NULL,
	`handled_by_id` text,
	`handled_note` text,
	`handled_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `ck_improvement_request_status` CHECK (`status` IN ('open', 'doing', 'done', 'dropped'))
);
--> statement-breakpoint
CREATE INDEX `improvement_request_created_idx` ON `improvement_request` (`created_at`);
--> statement-breakpoint
CREATE INDEX `improvement_request_status_idx` ON `improvement_request` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `improvement_request_route_idx` ON `improvement_request` (`route_pattern`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_request_submission_idx` ON `improvement_request` (`reporter_id`,`submission_key`);
--> statement-breakpoint
CREATE TABLE `improvement_shot` (
	`request_id` text PRIMARY KEY NOT NULL,
	`data_url` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `improvement_request`(`id`) ON UPDATE no action ON DELETE cascade
);
