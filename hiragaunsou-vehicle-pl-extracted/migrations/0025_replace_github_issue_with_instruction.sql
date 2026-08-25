-- 改善要望を GitHub Issue へ出す仕組みをやめ、Claude Code へ渡す指示文に置き換える。
--
-- 使わなくなった列は残さずに落とす。GitHub 用の列は、外部サービスの認証情報を伴う
-- 仕組みの名残であり、残しておくと「まだ繋がっているのでは」と読まれる。
-- SQLite は列を安全に落とすのに表の作り直しが要るので、ここでも中身をそっくり移す。
--
-- 移さないもの: github_issue_number などに入っていた値。
-- 起票先が一度も設定されないまま方針が変わったため、本番にはこの列の値が無い。
-- 仮にあっても、Issue の番号は指示文に読み替えられない (別のものなので混ぜない)。

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
	`duplicate_of_id` text,
	`archived_at` integer,
	`archived_by_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`archived_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`duplicate_of_id`) REFERENCES `improvement_request`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT `ck_improvement_request_status` CHECK (`status` IN ('open', 'doing', 'done', 'dropped', 'invalid', 'duplicate'))
);
--> statement-breakpoint
INSERT INTO `improvement_request_new` (
	`id`, `reporter_id`, `reporter_name`, `submission_key`, `path`, `route_pattern`,
	`screen_label`, `body`, `viewport`, `user_agent`, `status`, `handled_by_id`,
	`handled_note`, `handled_at`, `duplicate_of_id`, `archived_at`, `archived_by_id`,
	`created_at`, `updated_at`
)
SELECT
	`id`, `reporter_id`, `reporter_name`, `submission_key`, `path`, `route_pattern`,
	`screen_label`, `body`, `viewport`, `user_agent`, `status`, `handled_by_id`,
	`handled_note`, `handled_at`, `duplicate_of_id`, `archived_at`, `archived_by_id`,
	`created_at`, `updated_at`
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
CREATE INDEX `improvement_request_archived_idx` ON `improvement_request` (`archived_at`);
--> statement-breakpoint
-- 並んで届いた再送も1件に収める最後の砦。作り直しでも必ず戻す。
CREATE UNIQUE INDEX `improvement_request_submission_idx` ON `improvement_request` (`reporter_id`,`submission_key`);
--> statement-breakpoint

-- 発行した指示文。
--
-- 主キーが request_id であること自体が「1つの要望に指示文は1つ」の保証になる。
-- 同時に2回押されても2行目は入らないので、二重発行はアプリのロジックではなく
-- DB の側で止まる。発行の権利 (publishing_at) も同じ行で取り合う。
--
-- 要望を完全削除すると、この行も一緒に消える (cascade)。指示文はこのアプリの中に
-- しか無いので、消してくれと言われたときに本当に消せる。
CREATE TABLE `improvement_instruction` (
	`request_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`hash` text,
	`state` text DEFAULT 'published' NOT NULL,
	`synced_fields` text,
	`published_at` integer,
	`published_by_id` text,
	`publishing_at` integer,
	`fetched_at` integer,
	`fetch_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `improvement_request`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`published_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT `ck_improvement_instruction_state` CHECK (`state` IN ('published', 'fetched', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `improvement_instruction_state_idx` ON `improvement_instruction` (`state`,`published_at`);
--> statement-breakpoint

-- 指示文を読むための鍵。
--
-- 平文は保存しない (token_hash だけ)。DB を読める人が鍵をそのまま使えてはいけない。
-- 範囲 (scope_ids) と期限 (expires_at) は必須。「全部をいつまでも読める鍵」を配ると、
-- 渡した先の管理がこちらの手を離れる。
CREATE TABLE `improvement_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`token_hash` text NOT NULL,
	`scope_ids` text DEFAULT '[]' NOT NULL,
	`created_by_id` text,
	`created_by_name` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	`last_used_at` integer,
	`use_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_access_token_hash_idx` ON `improvement_access_token` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `improvement_access_token_expires_idx` ON `improvement_access_token` (`expires_at`);
