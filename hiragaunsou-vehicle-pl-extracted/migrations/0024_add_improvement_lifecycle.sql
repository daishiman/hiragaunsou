-- 改善要望の一括起票と、誤作成・重複・廃棄・完全削除の扱いを足す。
-- 既存の列は一切減らさない (既に届いている要望は、どの列も今のまま読める)。

-- まず、状態として認める値を広げる。
--
-- 0022 の CHECK は open / doing / done / dropped の4つしか許さない。ここへ
-- 「誤作成 (invalid)」「重複 (duplicate)」を足すが、SQLite は CHECK を後から
-- 変えられないため、表を作り直して中身をそっくり移す (これが唯一の方法)。
--
-- 先頭で外部キーの検査を後回しにするのは、古い表を落とす一瞬だけ
-- 画面の写し・診断情報の参照先が消えるため。移し終えた時点で辻褄が合う。
PRAGMA defer_foreign_keys=on;
--> statement-breakpoint
CREATE TABLE `improvement_request_new` (
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
	`github_issue_number` integer,
	`github_issue_url` text,
	`github_issued_at` integer,
	`github_issued_by_id` text,
	`github_issuing_at` integer,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_issued_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `ck_improvement_request_status` CHECK (`status` IN ('open', 'doing', 'done', 'dropped', 'invalid', 'duplicate'))
);
--> statement-breakpoint
INSERT INTO `improvement_request_new` (
	`id`, `reporter_id`, `reporter_name`, `submission_key`, `path`, `route_pattern`,
	`screen_label`, `body`, `viewport`, `user_agent`, `status`, `handled_by_id`,
	`handled_note`, `handled_at`, `created_at`, `updated_at`, `github_issue_number`,
	`github_issue_url`, `github_issued_at`, `github_issued_by_id`, `github_issuing_at`
)
SELECT
	`id`, `reporter_id`, `reporter_name`, `submission_key`, `path`, `route_pattern`,
	`screen_label`, `body`, `viewport`, `user_agent`, `status`, `handled_by_id`,
	`handled_note`, `handled_at`, `created_at`, `updated_at`, `github_issue_number`,
	`github_issue_url`, `github_issued_at`, `github_issued_by_id`, `github_issuing_at`
FROM `improvement_request`;
--> statement-breakpoint
DROP TABLE `improvement_request`;
--> statement-breakpoint
ALTER TABLE `improvement_request_new` RENAME TO `improvement_request`;
--> statement-breakpoint
-- 索引は表と一緒に落ちるので、同じ名前・同じ中身で張り直す。
CREATE INDEX `improvement_request_created_idx` ON `improvement_request` (`created_at`);
--> statement-breakpoint
CREATE INDEX `improvement_request_status_idx` ON `improvement_request` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `improvement_request_route_idx` ON `improvement_request` (`route_pattern`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_request_submission_idx` ON `improvement_request` (`reporter_id`,`submission_key`);
--> statement-breakpoint
-- 1つの要望に Issue は1つ。二重起票を止める最後の砦なので、作り直しでも必ず戻す。
CREATE UNIQUE INDEX `improvement_request_issue_idx` ON `improvement_request` (`github_issue_number`);
--> statement-breakpoint

-- Issue に載せた内容の指紋。次に押したときこれと同じなら GitHub へ何も投げない
-- (空の更新を送ると、Issue の履歴と通知だけが増えて中身は変わらない)。
ALTER TABLE `improvement_request` ADD `github_content_hash` text;
--> statement-breakpoint
-- Issue へ最後に送った時点の値 (状況・対応メモなど)。次に送るとき差分を出して
-- 「何が変わったか」をコメントに書くために持つ。指紋だけでは変わったことしか分からない。
ALTER TABLE `improvement_request` ADD `github_synced_fields` text;
--> statement-breakpoint
-- 最後に確かめた GitHub 側の状態。open / closed / missing (消された・見つからない)。
ALTER TABLE `improvement_request` ADD `github_issue_state` text;
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `github_synced_at` integer;
--> statement-breakpoint
-- 「重複」にしたときの親。どれと同じ話なのかを必ず指させる。
ALTER TABLE `improvement_request` ADD `duplicate_of_id` text REFERENCES `improvement_request`(`id`);
--> statement-breakpoint
-- 廃棄 (論理削除)。日時が入っていれば一覧の既定表示から外れる。戻せる。
ALTER TABLE `improvement_request` ADD `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `improvement_request` ADD `archived_by_id` text REFERENCES `user`(`id`);
--> statement-breakpoint
CREATE INDEX `improvement_request_archived_idx` ON `improvement_request` (`archived_at`);
--> statement-breakpoint
-- 状態を変えた記録と、完全削除した記録。
--
-- request_id に外部キーを張らない。張ると完全削除で監査の行まで一緒に消え、
-- 「いつ誰が何を消したか」が残らなくなる (消した記録が消えるのでは監査にならない)。
CREATE TABLE `improvement_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`actor_id` text,
	`actor_name` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`reason` text,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `improvement_audit_request_idx` ON `improvement_audit` (`request_id`, `at`);
--> statement-breakpoint
CREATE INDEX `improvement_audit_at_idx` ON `improvement_audit` (`at`);
