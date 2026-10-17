CREATE TABLE `notifications` (
	`id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`type` varchar(50) NOT NULL,
	`app` varchar(10) NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` varchar(500),
	`link` varchar(300),
	`dedupe_key` varchar(150),
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notifications_dedupe_uq` UNIQUE(`user_id`,`dedupe_key`)
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);