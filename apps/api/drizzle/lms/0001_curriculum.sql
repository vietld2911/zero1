CREATE TABLE `levels` (
	`id` char(26) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` varchar(1000),
	`sessions_count` int NOT NULL,
	`session_minutes` int NOT NULL DEFAULT 90,
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `levels_id` PRIMARY KEY(`id`),
	CONSTRAINT `levels_subject_code_uq` UNIQUE(`subject_id`,`code`)
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`description` varchar(1000),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `subjects_id` PRIMARY KEY(`id`),
	CONSTRAINT `subjects_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `levels_subject_order_idx` ON `levels` (`subject_id`,`sort_order`);