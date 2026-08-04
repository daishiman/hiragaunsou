CREATE TABLE `ai_provider_credential` (
	`provider` text PRIMARY KEY NOT NULL,
	`api_key_cipher` text NOT NULL,
	`api_key_iv` text NOT NULL,
	`api_key_last4` text NOT NULL,
	`model` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
