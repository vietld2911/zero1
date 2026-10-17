CREATE TABLE `catalog_levels` (
	`level_id` char(26) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`subject_code` varchar(20) NOT NULL,
	`subject_name` varchar(150) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`sessions_count` int NOT NULL,
	`session_minutes` int NOT NULL,
	`sort_order` int NOT NULL,
	`is_active` boolean NOT NULL,
	`source_event_id` char(26) NOT NULL,
	`synced_at` datetime(3) NOT NULL,
	CONSTRAINT `catalog_levels_level_id` PRIMARY KEY(`level_id`)
);
--> statement-breakpoint
CREATE INDEX `catalog_levels_subject_idx` ON `catalog_levels` (`subject_id`,`sort_order`);