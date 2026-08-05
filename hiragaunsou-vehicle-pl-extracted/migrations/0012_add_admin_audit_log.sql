CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`detail_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
