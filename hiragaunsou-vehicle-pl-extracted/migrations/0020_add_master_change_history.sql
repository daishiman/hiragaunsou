-- マスタ(率・車両・運転者)の直しを、後から追えて元に戻せるようにする。
--
-- 既存テーブルの列は一切変更しない(追加のみ)。収支表(vehicle_pl)の作りは変えず、
-- 「誰がいつ何を直したか」と「確定済みの月へ反映したときの反映前の姿」だけを別に残す。
--
-- なぜスナップショットを持つか:
--   収支表は毎回まるごと作り直される。まだ締めていない月はそれで構わないが、
--   確定済みの月へ反映すると、反映前の数字を復元する手段がどこにも無くなる。
--   配布済みの収支表と食い違ったときに戻せないと、反映ボタンを怖くて押せない。

CREATE TABLE `master_edit_history` (
	`id` text PRIMARY KEY NOT NULL,
	-- rate / vehicle / driver
	`target_kind` text NOT NULL,
	-- 率: "キー|年月" / 車両: 車番 / 運転者: 社員コード
	`target_key` text NOT NULL,
	-- 画面に出す対象名 (「129番」「一般管理費率」)。対象が後で消えても履歴が読めるように持つ
	`target_label` text NOT NULL,
	`field` text NOT NULL,
	`field_label` text NOT NULL,
	-- 数値も文字列も同じ表に並ぶため、値は文字列で持つ
	`before_value` text,
	`after_value` text,
	`edited_by` text,
	`edited_by_name` text DEFAULT '' NOT NULL,
	`edited_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	-- 元に戻した時刻。NULL は「生きている直し」
	`undone_at` integer,
	`undone_by` text,
	FOREIGN KEY (`edited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`undone_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `master_edit_history_at_idx` ON `master_edit_history` (`edited_at`);
--> statement-breakpoint
CREATE INDEX `master_edit_history_target_idx` ON `master_edit_history` (`target_kind`,`target_key`);
--> statement-breakpoint
CREATE TABLE `confirmed_month_apply_log` (
	`id` text PRIMARY KEY NOT NULL,
	`year_month` text NOT NULL,
	-- 画面に出す一言 (「4台の数字が変わりました」)
	`summary` text NOT NULL,
	-- 反映する直前の vehicle_pl 行 (JSON配列)。元に戻すときはこれを書き戻す
	`snapshot_json` text NOT NULL,
	`applied_by` text,
	`applied_by_name` text DEFAULT '' NOT NULL,
	`applied_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	-- 反映を取り消した時刻。NULL は「反映が生きている」
	`reverted_at` integer,
	`reverted_by` text,
	FOREIGN KEY (`applied_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reverted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `confirmed_month_apply_log_ym_idx` ON `confirmed_month_apply_log` (`year_month`,`applied_at`);
