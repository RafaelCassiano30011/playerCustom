CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_user_idx` ON `audit_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `bulk_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`report` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bulk_operations_user_idx` ON `bulk_operations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `collection_files` (
	`collection_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `file_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_files_file_idx` ON `collection_files` (`file_id`);--> statement-breakpoint
CREATE INDEX `collection_files_pos_idx` ON `collection_files` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_user_name_idx` ON `collections` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `collections_user_updated_idx` ON `collections` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `collections_updated_idx` ON `collections` (`updated_at`);--> statement-breakpoint
CREATE INDEX `collections_name_idx` ON `collections` (`name`);--> statement-breakpoint
CREATE INDEX `collections_created_idx` ON `collections` (`created_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`original_name` text NOT NULL,
	`storage_name` text NOT NULL,
	`format` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`r2_key` text NOT NULL,
	`sha256` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`metadata` text,
	`cover_key` text,
	`duration_seconds` real,
	`width` integer,
	`height` integer,
	`video_codec` text,
	`audio_codec` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_r2_key_idx` ON `files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `files_user_updated_idx` ON `files` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `files_user_status_idx` ON `files` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `files_user_name_idx` ON `files` (`user_id`,`original_name`);--> statement-breakpoint
CREATE INDEX `files_status_updated_idx` ON `files` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `files_status_name_idx` ON `files` (`status`,`original_name`);--> statement-breakpoint
CREATE INDEX `files_status_created_idx` ON `files` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `pending_deletions` (
	`r2_key` text PRIMARY KEY NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_deletions_created_idx` ON `pending_deletions` (`created_at`);--> statement-breakpoint
CREATE TABLE `playback_progress` (
	`file_id` text PRIMARY KEY NOT NULL,
	`position_seconds` real DEFAULT 0 NOT NULL,
	`duration_seconds` real DEFAULT 0 NOT NULL,
	`fraction` real DEFAULT 0 NOT NULL,
	`audio_track` text,
	`subtitle_track` text,
	`playback_rate` real,
	`completed` integer DEFAULT 0 NOT NULL,
	`opened_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_progress_updated_idx` ON `playback_progress` (`updated_at`);--> statement-breakpoint
CREATE INDEX `playback_progress_opened_idx` ON `playback_progress` (`opened_at`);--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refresh_tokens_hash_idx` ON `refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `upload_parts` (
	`session_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size_bytes` integer NOT NULL,
	PRIMARY KEY(`session_id`, `part_number`),
	FOREIGN KEY (`session_id`) REFERENCES `upload_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`multipart_id` text,
	`declared_size` integer NOT NULL,
	`status` text DEFAULT 'awaiting' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `upload_sessions_user_idx` ON `upload_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `upload_sessions_expiry_idx` ON `upload_sessions` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);