-- 車両単位の最終上書き (STEP7の確定後に、請求側の事情で人が直す値)。
-- 追加のみ。既存テーブル・既存データには一切触れない。
--
-- values_json には「計算の入口の値」だけを入れる (OVERRIDABLE_FIELDS)。
-- 損益・経費計・各小計は上書きできない。上書き後も calculateVehiclePl が下流を作り直すため、
-- 「損益 = 運送収入 - 経費計」は常に成立する。
CREATE TABLE `vehicle_pl_override` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text NOT NULL,
	`excluded` integer DEFAULT false NOT NULL,
	`values_json` text DEFAULT '{}' NOT NULL,
	`reason` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicle_pl_override_ym_no_idx` ON `vehicle_pl_override` (`year_month`,`vehicle_no`);--> statement-breakpoint
CREATE INDEX `vehicle_pl_override_ym_idx` ON `vehicle_pl_override` (`year_month`);
