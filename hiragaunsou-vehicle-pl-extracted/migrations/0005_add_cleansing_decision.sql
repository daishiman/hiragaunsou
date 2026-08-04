-- 業務フロー STEP1「データ整形」で人が下した判断の履歴。
-- 2重計上疑い・諸口の伝票について「除外する/修正して残す/そのまま残す」を記録し、
-- 翌月以降の既定値の提案に使う。既存テーブルには一切触れない追加のみ。
CREATE TABLE `cleansing_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`source_type` text NOT NULL,
	`row_key` text NOT NULL,
	`vehicle_no` text,
	`driver_name` text,
	`flag_types` text NOT NULL,
	`decision` text NOT NULL,
	`corrected_vehicle_no` text,
	`note` text,
	`decided_by` text,
	`decided_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cleansing_decision_ym_src_row_idx` ON `cleansing_decision` (`year_month`,`source_type`,`row_key`);
--> statement-breakpoint
CREATE INDEX `cleansing_decision_ym_idx` ON `cleansing_decision` (`year_month`);
--> statement-breakpoint
CREATE INDEX `cleansing_decision_row_idx` ON `cleansing_decision` (`source_type`,`row_key`);
--> statement-breakpoint
-- 業務ルールのうち、コードに埋めたくない設定値 (キリン協力金の配賦先車番など)。
CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- 取込時に機械的に除外した行数 (傭車=車番88888)。既存行は 0 で埋まる。
ALTER TABLE `csv_import_batch` ADD `excluded_row_count` integer DEFAULT 0 NOT NULL;
