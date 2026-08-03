CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text DEFAULT 'input_staff'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `csv_import_batch` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`year_month` text NOT NULL,
	`file_name` text NOT NULL,
	`imported_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`imported_by` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	FOREIGN KEY (`imported_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `driver_master` (
	`employee_code` text PRIMARY KEY NOT NULL,
	`driver_name` text NOT NULL,
	`vehicle_no` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`vehicle_no`) REFERENCES `vehicle_master`(`vehicle_no`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_master` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`year_month` text,
	`value` real NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_master_key_ym_idx` ON `rate_master` (`key`,`year_month`);--> statement-breakpoint
CREATE TABLE `raw_ingestion` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`source_type` text NOT NULL,
	`year_month` text NOT NULL,
	`row_index` integer NOT NULL,
	`natural_key` text,
	`raw_json` text NOT NULL,
	`flags` text,
	FOREIGN KEY (`batch_id`) REFERENCES `csv_import_batch`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `raw_ingestion_batch_idx` ON `raw_ingestion` (`batch_id`);--> statement-breakpoint
CREATE INDEX `raw_ingestion_ym_source_idx` ON `raw_ingestion` (`year_month`,`source_type`);--> statement-breakpoint
CREATE TABLE `review_flag` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text,
	`field` text,
	`type` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`monthly_reference` real,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution_note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_flag_ym_status_idx` ON `review_flag` (`year_month`,`status`);--> statement-breakpoint
CREATE INDEX `review_flag_vehicle_idx` ON `review_flag` (`vehicle_no`);--> statement-breakpoint
CREATE TABLE `vehicle_master` (
	`vehicle_no` text PRIMARY KEY NOT NULL,
	`vehicle_type` text NOT NULL,
	`depot` text DEFAULT '' NOT NULL,
	`reg_date` text,
	`cost_category` text DEFAULT 'medium' NOT NULL,
	`ins_compulsory` real DEFAULT 0 NOT NULL,
	`ins_voluntary` real DEFAULT 0 NOT NULL,
	`tax_auto` real DEFAULT 0 NOT NULL,
	`tax_weight` real DEFAULT 0 NOT NULL,
	`lease` real DEFAULT 0 NOT NULL,
	`installment` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vehicle_pl` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`depot` text DEFAULT '' NOT NULL,
	`reg` text,
	`code` text,
	`driver` text,
	`trips` real DEFAULT 0 NOT NULL,
	`slips` real DEFAULT 0 NOT NULL,
	`hours` real DEFAULT 0 NOT NULL,
	`km` real DEFAULT 0 NOT NULL,
	`fare` real DEFAULT 0 NOT NULL,
	`fee` real DEFAULT 0 NOT NULL,
	`sales` real DEFAULT 0 NOT NULL,
	`toll` real DEFAULT 0 NOT NULL,
	`toll_disc` real DEFAULT 0 NOT NULL,
	`toll_net` real DEFAULT 0 NOT NULL,
	`fuel_in` real DEFAULT 0 NOT NULL,
	`fuel_in_qty` real DEFAULT 0 NOT NULL,
	`fuel_out` real DEFAULT 0 NOT NULL,
	`fuel_out_qty` real DEFAULT 0 NOT NULL,
	`fuel_qty` real DEFAULT 0 NOT NULL,
	`nempi` real DEFAULT 0 NOT NULL,
	`adblue` real DEFAULT 0 NOT NULL,
	`fuel_total` real DEFAULT 0 NOT NULL,
	`repair` real DEFAULT 0 NOT NULL,
	`repair_standard` real DEFAULT 0 NOT NULL,
	`tire` real DEFAULT 0 NOT NULL,
	`equip` real DEFAULT 0 NOT NULL,
	`mainte` real DEFAULT 0 NOT NULL,
	`repair_total` real DEFAULT 0 NOT NULL,
	`salary` real DEFAULT 0 NOT NULL,
	`bonus` real DEFAULT 0 NOT NULL,
	`welfare` real DEFAULT 0 NOT NULL,
	`labor_total` real DEFAULT 0 NOT NULL,
	`ins_compulsory` real DEFAULT 0 NOT NULL,
	`ins_voluntary` real DEFAULT 0 NOT NULL,
	`ins_total` real DEFAULT 0 NOT NULL,
	`tax_auto` real DEFAULT 0 NOT NULL,
	`tax_weight` real DEFAULT 0 NOT NULL,
	`tax_total` real DEFAULT 0 NOT NULL,
	`misc_other` real DEFAULT 0 NOT NULL,
	`misc_total` real DEFAULT 0 NOT NULL,
	`lease` real DEFAULT 0 NOT NULL,
	`installment` real DEFAULT 0 NOT NULL,
	`transport_total` real DEFAULT 0 NOT NULL,
	`admin_fee` real DEFAULT 0 NOT NULL,
	`admin_total` real DEFAULT 0 NOT NULL,
	`fixed` real DEFAULT 0 NOT NULL,
	`variable` real DEFAULT 0 NOT NULL,
	`expense` real DEFAULT 0 NOT NULL,
	`profit` real DEFAULT 0 NOT NULL,
	`margin` real DEFAULT 0 NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_pl_ym_no_idx` ON `vehicle_pl` (`year_month`,`vehicle_no`);--> statement-breakpoint
CREATE INDEX `vehicle_pl_ym_idx` ON `vehicle_pl` (`year_month`);