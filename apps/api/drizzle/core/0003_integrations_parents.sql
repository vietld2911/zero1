CREATE TABLE `api_keys` (
	`id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`prefix` varchar(20) NOT NULL,
	`key_hash` varchar(64) NOT NULL,
	`permissions` json NOT NULL,
	`branch_ids` json NOT NULL,
	`created_by` char(26) NOT NULL,
	`last_used_at` datetime(3),
	`expires_at` datetime(3),
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_prefix_uq` UNIQUE(`prefix`)
);
--> statement-breakpoint
CREATE TABLE `integration_deliveries` (
	`id` char(26) NOT NULL,
	`target_id` char(26) NOT NULL,
	`event_id` varchar(40) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`payload` json NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'PENDING',
	`attempts` int NOT NULL DEFAULT 0,
	`next_attempt_at` datetime(3) NOT NULL,
	`last_status_code` int,
	`last_error` varchar(500),
	`delivered_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `integration_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `deliveries_target_event_uq` UNIQUE(`target_id`,`event_id`)
);
--> statement-breakpoint
CREATE TABLE `integration_targets` (
	`id` char(26) NOT NULL,
	`kind` varchar(10) NOT NULL,
	`name` varchar(100) NOT NULL,
	`url` varchar(500),
	`secret` varchar(100),
	`chat_id` varchar(50),
	`events` json NOT NULL,
	`branch_ids` json NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `integration_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `parent_accounts` (
	`id` char(26) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`full_name` varchar(150) NOT NULL,
	`password_hash` varchar(255),
	`status` varchar(10) NOT NULL DEFAULT 'PENDING',
	`activation_code_hash` varchar(64),
	`activation_expires_at` datetime(3),
	`activation_attempts` int NOT NULL DEFAULT 0,
	`last_login_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `parent_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `parent_accounts_phone_uq` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `parent_refresh_tokens` (
	`id` char(26) NOT NULL,
	`parent_id` char(26) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`family_id` char(26) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `parent_refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `parent_refresh_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `parent_students` (
	`parent_id` char(26) NOT NULL,
	`student_id` char(26) NOT NULL,
	CONSTRAINT `parent_students_parent_id_student_id_pk` PRIMARY KEY(`parent_id`,`student_id`)
);
--> statement-breakpoint
CREATE INDEX `deliveries_due_idx` ON `integration_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `deliveries_target_idx` ON `integration_deliveries` (`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `parent_refresh_family_idx` ON `parent_refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `parent_students_student_idx` ON `parent_students` (`student_id`);