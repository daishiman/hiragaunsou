CREATE TABLE `improvement_diagnostics` (
	`request_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `improvement_request`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_issue_number` integer;
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_issue_url` text;
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_issued_at` integer;
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_issued_by_id` text REFERENCES `user`(`id`);
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_issuing_at` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_request_issue_idx` ON `improvement_request` (`github_issue_number`);
