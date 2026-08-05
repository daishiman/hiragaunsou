ALTER TABLE `user` ADD `banned` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- 初期管理者のブートストラップ: 既にレコードがある場合のみ admin に昇格する。
-- (未作成の場合は初回ログイン時に auth.ts の BOOTSTRAP_ADMIN_EMAILS フックで admin になる)
UPDATE `user` SET `role` = 'admin' WHERE `email` = 'manjumoto.daishi@senpai-lab.com';
--> statement-breakpoint
UPDATE `user` SET `role` = 'admin' WHERE `email` = 'h_atsushi@hiragaunsou.co.jp';