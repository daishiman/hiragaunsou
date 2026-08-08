-- 月次収支表を「その場で直して、確認済みにして、最後にまとめて反映する」ための追加。
-- 既存テーブルのデータには触れない (追加と、既存行の初期値埋めのみ)。

-- 1) 直した値を「収支表に反映したか」を持たせる。
--    これまでは上書きを1件保存するたびに月まるごとの再計算が走っていた。
--    保存と再計算を切り離すと「保存したのに表が変わらない」が起きるため、
--    未反映であること自体をデータとして持ち、画面が件数で示せるようにする。
--    既存行は保存と同時に必ず再計算されていたので、反映済みとして updated_at を入れる。
ALTER TABLE `vehicle_pl_override` ADD `applied_at` integer;--> statement-breakpoint
UPDATE `vehicle_pl_override` SET `applied_at` = `updated_at`;--> statement-breakpoint

-- 2) 指摘を見たうえで「このままでよい」と人が判断した記録。
--
--    指摘 (VehiclePlIssue) はDBに持たず表示のたびに導出される。だから確認済みの印は
--    「どの指摘か」を指す4つ組 (年月・車番・列・指摘の種類) をキーにして別に持つ。
--    年月をキーに含めているので、翌月に同じ指摘が出たら必ずもう一度出る
--    (先月OKだったことは今月OKの根拠にならない)。
CREATE TABLE `pl_issue_ack` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	`vehicle_no` text NOT NULL,
	`field` text NOT NULL,
	`code` text NOT NULL,
	`note` text,
	`acked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`acked_by` text,
	FOREIGN KEY (`acked_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `pl_issue_ack_key_idx` ON `pl_issue_ack` (`year_month`,`vehicle_no`,`field`,`code`);--> statement-breakpoint
CREATE INDEX `pl_issue_ack_ym_idx` ON `pl_issue_ack` (`year_month`);
