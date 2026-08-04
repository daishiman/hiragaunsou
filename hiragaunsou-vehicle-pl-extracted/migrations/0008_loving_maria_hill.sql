CREATE TABLE `deficit_factor_analysis` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text NOT NULL,
	`summary` text NOT NULL,
	`factors_json` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deficit_factor_analysis_ym_no_idx` ON `deficit_factor_analysis` (`year_month`,`vehicle_no`);