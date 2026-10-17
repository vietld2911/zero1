CREATE TABLE `audit_logs` (
	`id` char(26) NOT NULL,
	`actor_id` char(26),
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(50) NOT NULL,
	`entity_id` varchar(100) NOT NULL,
	`branch_id` char(26),
	`before` json,
	`after` json,
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `branches` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`address` varchar(255),
	`phone` varchar(20),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `password_resets_id` PRIMARY KEY(`id`),
	CONSTRAINT `password_resets_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`code` varchar(64) NOT NULL,
	`app` varchar(10) NOT NULL,
	`description` varchar(255) NOT NULL,
	CONSTRAINT `permissions_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `refresh_tokens` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`family_id` char(26) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`user_agent` varchar(255),
	`ip` varchar(45),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `refresh_tokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `refresh_tokens_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_code` varchar(20) NOT NULL,
	`permission_code` varchar(64) NOT NULL,
	CONSTRAINT `role_permissions_role_code_permission_code_pk` PRIMARY KEY(`role_code`,`permission_code`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`code` varchar(20) NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` varchar(255),
	`rank` int NOT NULL,
	CONSTRAINT `roles_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` varchar(100) NOT NULL,
	`branch_id` varchar(26) NOT NULL DEFAULT '',
	`value` json NOT NULL,
	`updated_by` char(26),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `settings_key_branch_id_pk` PRIMARY KEY(`key`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `timekeeping_adjustments` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`entry_id` char(26),
	`work_date` date NOT NULL,
	`check_in_at` datetime(3) NOT NULL,
	`check_out_at` datetime(3) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`status` varchar(10) NOT NULL,
	`requested_by` char(26) NOT NULL,
	`reviewed_by` char(26),
	`reviewed_at` datetime(3),
	`review_note` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `timekeeping_adjustments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timekeeping_entries` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`branch_id` char(26),
	`work_date` date NOT NULL,
	`check_in_at` datetime(3) NOT NULL,
	`check_out_at` datetime(3),
	`check_in_source` varchar(10) NOT NULL,
	`check_out_source` varchar(10),
	`check_in_meta` json,
	`check_out_meta` json,
	`status` varchar(10) NOT NULL,
	`note` varchar(255),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `timekeeping_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_branches` (
	`user_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`is_primary` boolean NOT NULL DEFAULT false,
	CONSTRAINT `user_branches_user_id_branch_id_pk` PRIMARY KEY(`user_id`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(26) NOT NULL,
	`email` varchar(191) NOT NULL,
	`full_name` varchar(150) NOT NULL,
	`phone` varchar(20),
	`password_hash` varchar(255) NOT NULL,
	`role` varchar(20) NOT NULL,
	`manager_id` char(26),
	`status` varchar(10) NOT NULL DEFAULT 'ACTIVE',
	`must_change_password` boolean NOT NULL DEFAULT false,
	`last_login_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `password_resets_user_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_user_idx` ON `refresh_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `refresh_tokens_family_idx` ON `refresh_tokens` (`family_id`);--> statement-breakpoint
CREATE INDEX `timekeeping_adj_user_idx` ON `timekeeping_adjustments` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `timekeeping_adj_status_idx` ON `timekeeping_adjustments` (`status`);--> statement-breakpoint
CREATE INDEX `timekeeping_user_date_idx` ON `timekeeping_entries` (`user_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `timekeeping_branch_date_idx` ON `timekeeping_entries` (`branch_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `user_branches_branch_idx` ON `user_branches` (`branch_id`);--> statement-breakpoint
CREATE INDEX `users_manager_idx` ON `users` (`manager_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);