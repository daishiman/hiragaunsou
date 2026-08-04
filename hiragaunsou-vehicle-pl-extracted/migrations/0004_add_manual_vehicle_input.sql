-- 業務フロー STEP3(燃料費) / STEP5(修繕費・タイヤ) / STEP6(高速料金) の人手入力を保存する。
-- 追加のみ。既存テーブル・既存データには一切触れない。
CREATE TABLE `manual_vehicle_input` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text NOT NULL,
	`fuel_in_qty` real DEFAULT 0 NOT NULL,
	`fuel_out` real DEFAULT 0 NOT NULL,
	`fuel_out_qty` real DEFAULT 0 NOT NULL,
	`adblue` real DEFAULT 0 NOT NULL,
	`repair_actual` real DEFAULT 0 NOT NULL,
	`tire_actual` real,
	`equip` real DEFAULT 0 NOT NULL,
	`mainte` real DEFAULT 0 NOT NULL,
	`toll_actual` real,
	`toll_discount_actual` real,
	`misc_other` real DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_vehicle_input_ym_no_idx` ON `manual_vehicle_input` (`year_month`,`vehicle_no`);--> statement-breakpoint
CREATE INDEX `manual_vehicle_input_ym_idx` ON `manual_vehicle_input` (`year_month`);
