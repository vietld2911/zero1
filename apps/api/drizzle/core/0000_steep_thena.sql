CREATE TABLE `outbox_events` (
	`id` char(26) NOT NULL,
	`type` varchar(100) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`aggregate_id` char(26) NOT NULL,
	`branch_id` char(26),
	`actor_id` char(26),
	`data` json NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`published_at` datetime(3),
	`attempts` int NOT NULL DEFAULT 0,
	`available_at` datetime(3) NOT NULL,
	`last_error` text,
	CONSTRAINT `outbox_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processed_events` (
	`event_id` char(26) NOT NULL,
	`handler` varchar(120) NOT NULL,
	`processed_at` datetime(3) NOT NULL,
	CONSTRAINT `processed_events_event_id_handler_pk` PRIMARY KEY(`event_id`,`handler`)
);
--> statement-breakpoint
CREATE INDEX `outbox_pending_idx` ON `outbox_events` (`published_at`,`available_at`);